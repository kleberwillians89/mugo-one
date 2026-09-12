begin;

-- Inicializa o estoque operacional com as vendas válidas já cadastradas a
-- partir de 04/09/2026. O item nasce para todo perfume; saldo positivo só é
-- creditado quando o lote ativo informa a capacidade original e ela excede
-- a soma vendida. A assinatura do lote garante que importações antigas ou
-- substituídas não contaminem o backfill.
insert into public.inventory_items(
  organization_id,perfume_id,reference_date,available_ml,physical_ml,
  minimum_ml,status,notes,reconciliation_status,bootstrap_pending_verification,created_by
)
select s.organization_id,s.perfume_id,min(s.sale_date),0,0,
  0,'active','Criado pelo backfill das vendas válidas desde 04/09/2026.',
  'reconciled',false,null
from public.sales s
where s.sale_date>=date '2026-09-04'
  and s.deleted_at is null
  and s.payment_status not in('unknown','cancelled')
  and s.data_quality_status='verified'
  and coalesce(s.inventory_allocation_eligible,false)
  and s.perfume_id is not null
  and s.volume_ml>0
group by s.organization_id,s.perfume_id
on conflict(organization_id,perfume_id) do nothing;

-- Toda venda válida do recorte passa a apontar para seu item canônico.
update public.sales s set inventory_item_id=i.id,updated_at=now()
from public.inventory_items i
where s.organization_id=i.organization_id
  and s.perfume_id=i.perfume_id
  and s.sale_date>=date '2026-09-04'
  and s.deleted_at is null
  and s.payment_status not in('unknown','cancelled')
  and s.data_quality_status='verified'
  and coalesce(s.inventory_allocation_eligible,false)
  and s.volume_ml>0
  and s.inventory_item_id is distinct from i.id;

do $$
declare batch record;item public.inventory_items;before_ml numeric;source_key text;
begin
  for batch in
    select b.*,
      greatest(0,
        replace(substring(b.source_text from '(?i)Frasco original\s+(?:com|de)\s*([0-9]+(?:[.,][0-9]+)?)\s*ml'),',','.')::numeric
        - b.total_ml
      ) as remainder_ml
    from public.ai_sales_batches b
    where b.sale_date>=date '2026-09-04'
      and b.perfume_id is not null
      and substring(b.source_text from '(?i)Frasco original\s+(?:com|de)\s*([0-9]+(?:[.,][0-9]+)?)\s*ml') is not null
      and exists(
        select 1 from public.sales s
        where s.organization_id=b.organization_id
          and s.source='ai_sales_batch'
          and s.deleted_at is null
          and s.sale_date>=date '2026-09-04'
          and s.import_signature=public.ai_sha256_hex(b.fingerprint||'|0')
      )
    order by b.created_at,b.id
  loop
    source_key:='backfill-2026-09-04|'||batch.fingerprint||'|'||batch.perfume_id::text||'|'||coalesce(batch.bottle_number::text,'');
    if exists(select 1 from public.sale_inventory_births x
      where x.organization_id=batch.organization_id and x.source_key=source_key) then
      continue;
    end if;

    select * into item from public.inventory_items
      where organization_id=batch.organization_id and perfume_id=batch.perfume_id for update;
    if item.id is null then raise exception 'backfill_inventory_item_missing:%',batch.perfume_id;end if;
    before_ml:=item.available_ml;

    if batch.remainder_ml>0 then
      update public.inventory_items set
        available_ml=available_ml+batch.remainder_ml,
        physical_ml=physical_ml+batch.remainder_ml,
        updated_at=now()
      where id=item.id returning * into item;
      insert into public.inventory_movements(
        organization_id,inventory_item_id,perfume_id,movement_type,quantity_ml,
        balance_before,balance_after,reason,notes,created_by,origin
      ) values(
        batch.organization_id,item.id,batch.perfume_id,'opening',batch.remainder_ml,
        before_ml,item.available_ml,'Sobra das vendas cadastradas desde 04/09/2026',
        'Backfill do lote validado · '||coalesce('FRASCO '||batch.bottle_number,'sem frasco informado'),
        batch.created_by,'validated_sale_backfill'
      );
    end if;

    insert into public.sale_inventory_births(
      organization_id,source_key,perfume_id,inventory_item_id,bottle_identifier,available_ml,created_by
    ) values(
      batch.organization_id,source_key,batch.perfume_id,item.id,
      case when batch.bottle_number is null then null else 'FRASCO '||batch.bottle_number end,
      batch.remainder_ml,batch.created_by
    );
    insert into public.audit_logs(organization_id,actor_id,action,entity_type,entity_id,metadata)
    values(batch.organization_id,batch.created_by,'inventory_backfilled_from_validated_sales','inventory_item',item.id::text,
      jsonb_build_object('cutoff','2026-09-04','batch_id',batch.id,'fingerprint',left(batch.fingerprint,16),
        'bottle_number',batch.bottle_number,'sold_ml',batch.total_ml,'available_ml',batch.remainder_ml));
  end loop;
end;
$$;

notify pgrst,'reload schema';
commit;
