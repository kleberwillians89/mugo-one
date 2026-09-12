begin;

-- Reforça o nascimento do item para novas vendas e repara vendas válidas que
-- tenham sido confirmadas durante a janela entre o backfill e a publicação do
-- frontend novo. A operação é idempotente e nunca duplica venda.
create or replace function public.ensure_validated_sale_inventory_item()
returns trigger language plpgsql security definer set search_path=public as $$
declare item_id uuid;
begin
  if new.deleted_at is not null or new.payment_status in ('unknown','cancelled')
     or new.data_quality_status is distinct from 'verified'
     or not coalesce(new.inventory_allocation_eligible,false)
     or new.sale_date is null or new.perfume_id is null
     or new.volume_ml is null or new.volume_ml<=0 then return new; end if;

  insert into public.inventory_items(
    organization_id,perfume_id,reference_date,available_ml,physical_ml,
    minimum_ml,status,notes,reconciliation_status,bootstrap_pending_verification,created_by
  ) values(
    new.organization_id,new.perfume_id,new.sale_date,0,0,0,'active',
    'Criado automaticamente por venda validada.','reconciled',false,new.created_by
  ) on conflict(organization_id,perfume_id) do nothing returning id into item_id;

  if item_id is null then
    select id into item_id from public.inventory_items
    where organization_id=new.organization_id and perfume_id=new.perfume_id;
  end if;
  update public.sales set inventory_item_id=item_id
  where id=new.id and inventory_item_id is distinct from item_id;
  return new;
end;
$$;

drop trigger if exists validated_sale_inventory_birth on public.sales;
create trigger validated_sale_inventory_birth
after insert or update of perfume_id,volume_ml,payment_status,data_quality_status,
  inventory_allocation_eligible,deleted_at
on public.sales for each row execute function public.ensure_validated_sale_inventory_item();

-- Todo perfume de venda operacional desde 04/09 precisa aparecer no Estoque,
-- inclusive quando o frasco foi totalmente vendido e a sobra é zero.
insert into public.inventory_items(
  organization_id,perfume_id,reference_date,available_ml,physical_ml,
  minimum_ml,status,notes,reconciliation_status,bootstrap_pending_verification,created_by
)
select s.organization_id,s.perfume_id,min(s.sale_date),0,0,0,'active',
  'Reparado automaticamente a partir das vendas válidas desde 04/09/2026.',
  'reconciled',false,min(s.created_by::text)::uuid
from public.sales s
where s.sale_date>=date '2026-09-04' and s.deleted_at is null
  and s.payment_status not in('unknown','cancelled')
  and s.data_quality_status='verified'
  and coalesce(s.inventory_allocation_eligible,false)
  and s.perfume_id is not null and s.volume_ml>0
group by s.organization_id,s.perfume_id
on conflict(organization_id,perfume_id) do nothing;

update public.sales s set inventory_item_id=i.id,updated_at=now()
from public.inventory_items i
where s.organization_id=i.organization_id and s.perfume_id=i.perfume_id
  and s.sale_date>=date '2026-09-04' and s.deleted_at is null
  and s.payment_status not in('unknown','cancelled')
  and s.data_quality_status='verified'
  and coalesce(s.inventory_allocation_eligible,false) and s.volume_ml>0
  and s.inventory_item_id is distinct from i.id;

do $$
declare batch record;item public.inventory_items;before_ml numeric;remainder numeric;source text;
begin
  for batch in
    select b.* from public.ai_sales_batches b
    where b.sale_date>=date '2026-09-04' and b.perfume_id is not null
      and exists(select 1 from public.sales s where s.organization_id=b.organization_id
        and s.source='ai_sales_batch' and s.deleted_at is null
        and s.import_signature=public.ai_sha256_hex(b.fingerprint||'|0'))
      and not exists(select 1 from public.sale_inventory_births x
        where x.organization_id=b.organization_id and x.source_key like '%'||b.fingerprint||'%')
    order by b.created_at,b.id
  loop
    remainder:=greatest(0,coalesce(
      replace(substring(batch.source_text from '(?i)Frasco original\s+(?:com|de)\s*([0-9]+(?:[.,][0-9]+)?)\s*ml'),',','.')::numeric
      -batch.total_ml,0));
    source:='repair-2026-09-12|'||batch.id::text||'|'||batch.fingerprint;
    select * into item from public.inventory_items where organization_id=batch.organization_id
      and perfume_id=batch.perfume_id for update;
    if item.id is null then raise exception 'repair_inventory_item_missing:%',batch.perfume_id; end if;
    before_ml:=item.available_ml;
    if remainder>0 then
      update public.inventory_items set available_ml=available_ml+remainder,
        physical_ml=physical_ml+remainder,updated_at=now()
      where id=item.id returning * into item;
      insert into public.inventory_movements(
        organization_id,inventory_item_id,perfume_id,movement_type,quantity_ml,
        balance_before,balance_after,reason,notes,created_by,origin
      ) values(batch.organization_id,item.id,batch.perfume_id,'opening',remainder,
        before_ml,item.available_ml,'Sobra de venda validada reparada automaticamente',
        'Reparo seguro do lote '||batch.id::text,batch.created_by,'validated_sale_repair');
    end if;
    insert into public.sale_inventory_births(
      organization_id,source_key,perfume_id,inventory_item_id,bottle_identifier,available_ml,created_by
    ) values(batch.organization_id,source,batch.perfume_id,item.id,
      case when batch.bottle_number is null then null else 'FRASCO '||batch.bottle_number end,
      remainder,batch.created_by);
    insert into public.audit_logs(organization_id,actor_id,action,entity_type,entity_id,metadata)
    values(batch.organization_id,batch.created_by,'missing_sale_inventory_repaired','inventory_item',item.id::text,
      jsonb_build_object('batch_id',batch.id,'perfume_id',batch.perfume_id,
        'sold_ml',batch.total_ml,'available_ml',remainder,'cutoff','2026-09-04'));
  end loop;
end;
$$;

notify pgrst,'reload schema';
commit;
