begin;

-- Perfumes é também o catálogo comercial. Novos registros podem existir sem
-- estoque e sem identidade física. Códigos legados já emitidos são mantidos.
alter table public.perfumes alter column operational_code drop not null;

create or replace function public.perfume_operational_code_assign()
returns trigger language plpgsql security definer set search_path=public as $$
begin
  if tg_op='INSERT' and new.operational_code is not null then raise exception 'operational_code_generated_by_database'; end if;
  if tg_op='UPDATE' and new.operational_code is distinct from old.operational_code then
    if old.operational_code is not null or coalesce(current_setting('ruah.operational_code_assignment',true),'')<>'on' then
      raise exception 'operational_code_immutable';
    end if;
  end if;
  return new;
end;$$;

create or replace function public.ensure_perfume_operational_code(p_perfume_id uuid)
returns text language plpgsql security definer set search_path=public as $$
declare p public.perfumes;seq integer;
begin
  select * into p from public.perfumes where id=p_perfume_id for update;
  if p.id is null then raise exception 'perfume_not_found';end if;
  if p.operational_code is not null then return p.operational_code;end if;
  insert into public.perfume_operational_sequences(organization_id,last_value) values(p.organization_id,1)
  on conflict(organization_id) do update set last_value=public.perfume_operational_sequences.last_value+1 returning last_value into seq;
  perform set_config('ruah.operational_code_assignment','on',true);
  update public.perfumes set operational_code='RUAH-P'||lpad(seq::text,6,'0') where id=p.id returning operational_code into p.operational_code;
  perform set_config('ruah.operational_code_assignment','off',true);
  return p.operational_code;
end;$$;
revoke all on function public.ensure_perfume_operational_code(uuid) from public,anon,authenticated;

-- A mera criação de uma linha vazia não comprova presença física. A identidade
-- nasce exclusivamente dentro de inventory_receive_perfume, na mesma transação
-- que grava o movimento positivo. Remova também o trigger caso uma versão local
-- anterior desta migration tenha sido executada em ambiente descartável.
drop trigger if exists inventory_item_assign_perfume_code on public.inventory_items;
drop function if exists public.inventory_item_assign_perfume_code();

-- Uma confirmação humana representa uma entrada real. A chave fecha retries e
-- duplo clique usando o ledger/auditoria existentes, sem tabela paralela.
create function public.inventory_receive_perfume(
  p_organization_id uuid,p_perfume_id uuid,p_received_ml numeric,p_minimum_ml numeric,
  p_reference_date date,p_notes text,p_idempotency_key uuid
) returns public.inventory_items language plpgsql security definer set search_path=public as $$
declare item public.inventory_items;prior public.audit_logs;code text;
begin
  if not public.has_org_permission(p_organization_id,'inventory.adjust') then raise exception 'inventory_write_forbidden';end if;
  if p_received_ml is null or p_received_ml<=0 or p_minimum_ml is null or p_minimum_ml<0 or p_reference_date is null or p_idempotency_key is null then raise exception 'invalid_inventory_receipt';end if;
  if not exists(select 1 from public.perfumes where id=p_perfume_id and organization_id=p_organization_id) then raise exception 'perfume_not_found';end if;
  perform pg_advisory_xact_lock(hashtextextended(p_idempotency_key::text,230005));
  select * into prior from public.audit_logs where organization_id=p_organization_id and action='inventory_physical_receipt' and metadata->>'idempotency_key'=p_idempotency_key::text order by created_at limit 1;
  if prior.id is not null then
    if prior.metadata->>'perfume_id'<>p_perfume_id::text
      or (prior.metadata->>'received_ml')::numeric<>p_received_ml
      or (prior.metadata->>'minimum_ml')::numeric<>p_minimum_ml
      or (prior.metadata->>'reference_date')::date<>p_reference_date
      or coalesce(prior.metadata->>'notes','')<>coalesce(p_notes,'')
    then raise exception 'idempotency_key_reused_with_different_payload';end if;
    select * into item from public.inventory_items where id=prior.entity_id::uuid and organization_id=p_organization_id;
    if item.id is null then raise exception 'idempotent_inventory_receipt_inconsistent';end if;
    return item;
  end if;

  insert into public.inventory_items(organization_id,perfume_id,reference_date,available_ml,physical_ml,minimum_ml,notes,created_by)
  values(p_organization_id,p_perfume_id,p_reference_date,0,0,p_minimum_ml,p_notes,auth.uid())
  on conflict(organization_id,perfume_id) do nothing returning * into item;
  if item.id is null then select * into item from public.inventory_items where organization_id=p_organization_id and perfume_id=p_perfume_id for update;end if;
  code:=public.ensure_perfume_operational_code(p_perfume_id);
  perform public.inventory_apply(item.id,p_received_ml,'entry','Recebimento físico do perfume',p_notes,null);
  update public.inventory_items set minimum_ml=p_minimum_ml,reference_date=greatest(reference_date,p_reference_date),updated_at=now() where id=item.id returning * into item;
  insert into public.audit_logs(organization_id,actor_id,action,entity_type,entity_id,metadata)
  values(p_organization_id,auth.uid(),'inventory_physical_receipt','inventory_item',item.id::text,jsonb_build_object('idempotency_key',p_idempotency_key,'perfume_id',p_perfume_id,'received_ml',p_received_ml,'minimum_ml',p_minimum_ml,'reference_date',p_reference_date,'notes',p_notes,'operational_code',code));
  return item;
end;$$;
revoke all on function public.inventory_receive_perfume(uuid,uuid,numeric,numeric,date,text,uuid) from public,anon;
grant execute on function public.inventory_receive_perfume(uuid,uuid,numeric,numeric,date,text,uuid) to authenticated;

-- A rota de impressão não confia em nome/marca vindos da URL. Só devolve a
-- identidade canônica quando há um recebimento físico auditado para o item.
create function public.perfume_received_label(p_operational_code text)
returns table(perfume_name text,brand_house text,operational_code text)
language sql stable security definer set search_path=public as $$
  select p.full_name_raw,p.brand_house,p.operational_code
  from public.perfumes p
  join public.inventory_items i on i.organization_id=p.organization_id and i.perfume_id=p.id
  where p.organization_id in(select public.current_user_org_ids())
    and upper(p.operational_code)=upper(btrim(coalesce(p_operational_code,'')))
    and exists(
      select 1 from public.audit_logs a
      where a.organization_id=p.organization_id and a.action='inventory_physical_receipt'
        and a.entity_type='inventory_item' and a.entity_id=i.id::text
    );
$$;
revoke all on function public.perfume_received_label(text) from public,anon;
grant execute on function public.perfume_received_label(text) to authenticated;

-- A preparação continua usando allocations e batches canônicos. O tipo da
-- venda é apenas exposto para a UI separar SPLIT de APC sem duplicar estado.
drop function public.preparation_candidates(uuid);
create function public.preparation_candidates(p_perfume_id uuid)
returns table(allocation_id uuid,client_name text,sale_type text,quantity_ml numeric,prepared_ml numeric,remaining_ml numeric,bottle_tracking_status text)
language sql stable security definer set search_path=public as $$
  select a.id,c.name,s.sale_type,a.quantity_ml,
    coalesce(sum(bi.quantity_ml) filter(where b.status='confirmed'),0),
    a.original_quantity_ml-coalesce(sum(bi.quantity_ml) filter(where b.status='confirmed'),0),
    i.bottle_tracking_status
  from public.inventory_allocations a
  join public.clients c on c.id=a.client_id
  join public.sales s on s.id=a.sale_id
  join public.inventory_items i on i.id=a.inventory_item_id
  left join public.preparation_batch_items bi on bi.allocation_id=a.id
  left join public.preparation_batches b on b.id=bi.batch_id
  where a.perfume_id=p_perfume_id
    and a.organization_id in(select public.current_user_org_ids())
    and a.status='reserved' and s.deleted_at is null
  group by a.id,c.name,s.sale_type,i.bottle_tracking_status
  having a.original_quantity_ml-coalesce(sum(bi.quantity_ml) filter(where b.status='confirmed'),0)>0
  order by case when s.sale_type='SPLIT' then 0 else 1 end,c.name;
$$;
revoke all on function public.preparation_candidates(uuid) from public,anon;
grant execute on function public.preparation_candidates(uuid) to authenticated;

commit;
