-- Ponte manual entre vendas historicas e a operacao logistica.
-- Itens confirmados aqui nunca integram nem movimentam o estoque fisico gerenciado.

alter table public.inventory_allocations
  alter column inventory_item_id drop not null,
  add column if not exists allocation_source text not null default 'operational_stock',
  add column if not exists stock_managed boolean not null default true,
  add column if not exists verified_at timestamptz,
  add column if not exists verified_by uuid references public.profiles(id),
  add column if not exists verification_note text,
  add column if not exists storage_location text;

alter table public.inventory_allocations
  add constraint inventory_allocations_source_check
    check(allocation_source in('operational_stock','legacy_manual_verified')) not valid,
  add constraint inventory_allocations_stock_link_check
    check((stock_managed and inventory_item_id is not null and allocation_source='operational_stock')
      or (not stock_managed and inventory_item_id is null and allocation_source='legacy_manual_verified')) not valid;
alter table public.inventory_allocations validate constraint inventory_allocations_source_check;
alter table public.inventory_allocations validate constraint inventory_allocations_stock_link_check;

alter table public.shipment_items
  add column if not exists separated_at timestamptz,
  add column if not exists separated_by uuid references public.profiles(id),
  add column if not exists checked_at timestamptz,
  add column if not exists checked_by uuid references public.profiles(id),
  add column if not exists divergence_note text;

create or replace function public.sync_sale_inventory_allocation()
returns trigger language plpgsql security definer set search_path=public as $$
declare v_item public.inventory_items; v_allocation public.inventory_allocations; v_delta numeric;
begin
  -- Uma confirmacao humana e independente do estoque operacional e nunca e sincronizada pelo trigger da venda.
  if exists(select 1 from public.inventory_allocations where sale_id=new.id and allocation_source='legacy_manual_verified' and status in('reserved','shipping','shipped')) then
    return new;
  end if;
  select * into v_allocation from public.inventory_allocations
    where sale_id=new.id and allocation_source='operational_stock' and status in('reserved','shipping','shipped') for update;
  if new.deleted_at is not null or new.payment_status<>'paid' or not new.inventory_allocation_eligible or new.perfume_id is null
     or new.volume_ml is null or new.volume_ml<=0 then
    if v_allocation.id is not null and v_allocation.status='reserved' then
      select * into v_item from public.inventory_items where id=v_allocation.inventory_item_id for update;
      update public.inventory_items set available_ml=available_ml+v_allocation.quantity_ml,updated_at=now() where id=v_item.id;
      update public.inventory_allocations set status='released',released_at=now(),updated_at=now() where id=v_allocation.id;
    elsif v_allocation.id is not null and v_allocation.status in('shipping','shipped') then
      raise exception 'sale_has_active_shipment_allocation';
    end if;
    return new;
  end if;
  select * into v_item from public.inventory_items where organization_id=new.organization_id and perfume_id=new.perfume_id and status='active' for update;
  if not found or new.sale_date<v_item.reference_date then return new; end if;
  if v_allocation.id is null then
    if v_item.available_ml<new.volume_ml then raise exception 'insufficient_available_inventory'; end if;
    update public.inventory_items set available_ml=available_ml-new.volume_ml,updated_at=now() where id=v_item.id;
    insert into public.inventory_allocations(organization_id,inventory_item_id,client_id,sale_id,perfume_id,quantity_ml,status,allocated_at,allocation_source,stock_managed,created_by)
    values(new.organization_id,v_item.id,new.client_id,new.id,new.perfume_id,new.volume_ml,'reserved',now(),'operational_stock',true,auth.uid());
  elsif v_allocation.status='reserved' then
    if v_allocation.inventory_item_id<>v_item.id then raise exception 'allocation_perfume_change_requires_release'; end if;
    v_delta:=new.volume_ml-v_allocation.quantity_ml;
    if v_delta>v_item.available_ml then raise exception 'insufficient_available_inventory'; end if;
    update public.inventory_items set available_ml=available_ml-v_delta,updated_at=now() where id=v_item.id;
    update public.inventory_allocations set client_id=new.client_id,quantity_ml=new.volume_ml,updated_at=now() where id=v_allocation.id;
  end if;
  return new;
end;$$;

create or replace function public.confirm_legacy_product_custody(
  p_sale_id uuid,p_storage_location text default null,p_verification_note text default null
) returns public.inventory_allocations
language plpgsql security definer set search_path=public as $$
declare v_sale public.sales; v_allocation public.inventory_allocations;
begin
  select * into v_sale from public.sales where id=p_sale_id and deleted_at is null for update;
  if v_sale.id is null or not public.has_org_role(v_sale.organization_id,array['admin','manager','operator']::public.member_role[])
    then raise exception 'forbidden'; end if;
  if v_sale.client_id is null or v_sale.perfume_id is null or v_sale.volume_ml is null or v_sale.volume_ml<=0
    then raise exception 'sale_missing_operational_fields'; end if;
  if v_sale.shipped_at is not null then raise exception 'sale_already_shipped'; end if;
  select * into v_allocation from public.inventory_allocations
    where sale_id=v_sale.id and status in('reserved','shipping','shipped') for update;
  if v_allocation.id is not null then raise exception 'product_already_confirmed_for_shipping'; end if;
  insert into public.inventory_allocations(
    organization_id,inventory_item_id,client_id,sale_id,perfume_id,quantity_ml,status,allocated_at,
    allocation_source,stock_managed,verified_at,verified_by,verification_note,storage_location,created_by
  ) values(
    v_sale.organization_id,null,v_sale.client_id,v_sale.id,v_sale.perfume_id,v_sale.volume_ml,'reserved',now(),
    'legacy_manual_verified',false,now(),auth.uid(),coalesce(nullif(btrim(p_verification_note),''),'Produto conferido manualmente para envio.'),nullif(btrim(p_storage_location),''),auth.uid()
  ) returning * into v_allocation;
  insert into public.audit_logs(organization_id,actor_id,action,entity_type,entity_id,metadata)
  values(v_sale.organization_id,auth.uid(),'legacy_custody_confirmed','inventory_allocation',v_allocation.id::text,
    jsonb_build_object('sale_id',v_sale.id,'client_id',v_sale.client_id,'quantity_ml',v_sale.volume_ml,'storage_location',v_allocation.storage_location,'stock_managed',false));
  return v_allocation;
end;$$;

create or replace function public.release_legacy_product_custody(p_allocation_id uuid)
returns public.inventory_allocations language plpgsql security definer set search_path=public as $$
declare v public.inventory_allocations;
begin
  select * into v from public.inventory_allocations where id=p_allocation_id for update;
  if v.id is null or not public.has_org_role(v.organization_id,array['admin','manager','operator']::public.member_role[])
    then raise exception 'forbidden'; end if;
  if v.allocation_source<>'legacy_manual_verified' or v.stock_managed or v.status<>'reserved' or v.shipment_id is not null
    then raise exception 'custody_confirmation_cannot_be_removed'; end if;
  update public.inventory_allocations set status='released',released_at=now(),updated_at=now() where id=v.id returning * into v;
  insert into public.audit_logs(organization_id,actor_id,action,entity_type,entity_id,metadata)
  values(v.organization_id,auth.uid(),'legacy_custody_released','inventory_allocation',v.id::text,jsonb_build_object('sale_id',v.sale_id,'stock_managed',false));
  return v;
end;$$;

create or replace function public.post_shipment(p_shipment_id uuid)
returns void language plpgsql security definer set search_path=public as $$
declare v public.shipments; r record;
begin
  select * into v from public.shipments where id=p_shipment_id for update;
  if v.id is null or not public.has_org_role(v.organization_id,array['admin','manager']::public.member_role[]) then raise exception 'forbidden'; end if;
  if v.status in('posted','delivered') then return; end if;
  if v.status not in('label_released','customer_approved') then raise exception 'shipment_not_ready_to_post'; end if;
  for r in select a.* from public.inventory_allocations a where a.shipment_id=v.id and a.status='shipping' for update loop
    if r.stock_managed then
      perform 1 from public.inventory_items where id=r.inventory_item_id and physical_ml>=r.quantity_ml for update;
      if not found then raise exception 'insufficient_physical_inventory'; end if;
      update public.inventory_items set physical_ml=physical_ml-r.quantity_ml,updated_at=now() where id=r.inventory_item_id;
    end if;
    update public.inventory_allocations set status='shipped',shipped_at=now(),updated_at=now() where id=r.id;
  end loop;
  update public.shipments set status='posted',posted_at=now(),updated_at=now() where id=v.id;
  insert into public.shipment_events(organization_id,shipment_id,event_type,from_status,to_status,actor_id)
    values(v.organization_id,v.id,'shipment_posted',v.status,'posted',auth.uid());
end;$$;

grant execute on function public.confirm_legacy_product_custody(uuid,text,text) to authenticated;
grant execute on function public.release_legacy_product_custody(uuid) to authenticated;

create or replace function public.client_waiting_products_v2(p_client_id uuid)
returns table(allocation_id uuid,sale_id uuid,sale_date date,perfume text,sale_type text,
  quantity_ml numeric,amount numeric,payment_status public.payment_status,allocated_at timestamptz,days_waiting integer,
  allocation_source text,stock_managed boolean,verified_at timestamptz,verified_by uuid,storage_location text)
language sql stable security invoker set search_path=public as $$
  select a.id,s.id,s.sale_date,p.full_name_raw,s.sale_type,a.quantity_ml,s.amount,s.payment_status,
    a.allocated_at,greatest(0,(current_date-coalesce(a.allocated_at::date,s.sale_date)))::integer,
    a.allocation_source,a.stock_managed,a.verified_at,a.verified_by,a.storage_location
  from public.inventory_allocations a join public.sales s on s.id=a.sale_id join public.perfumes p on p.id=a.perfume_id
  where a.client_id=p_client_id and a.status='reserved'
    and a.organization_id in(select public.current_user_org_ids()) order by s.sale_date,a.created_at;
$$;
grant execute on function public.client_waiting_products_v2(uuid) to authenticated;

create or replace function public.update_shipment_item_check(
  p_shipment_id uuid,p_allocation_id uuid,p_separated boolean,p_checked boolean,p_divergence_note text default null
) returns public.shipment_items language plpgsql security definer set search_path=public as $$
declare v public.shipment_items;
begin
  select si.* into v from public.shipment_items si join public.shipments s on s.id=si.shipment_id
    where si.shipment_id=p_shipment_id and si.allocation_id=p_allocation_id and si.removed_at is null
      and public.has_org_role(s.organization_id,array['admin','manager','operator']::public.member_role[]) for update;
  if v.id is null then raise exception 'shipment_item_not_found'; end if;
  update public.shipment_items set
    separated_at=case when p_separated then coalesce(separated_at,now()) else null end,
    separated_by=case when p_separated then coalesce(separated_by,auth.uid()) else null end,
    checked_at=case when p_checked then coalesce(checked_at,now()) else null end,
    checked_by=case when p_checked then coalesce(checked_by,auth.uid()) else null end,
    divergence_note=nullif(btrim(p_divergence_note),'')
  where id=v.id returning * into v;
  return v;
end;$$;
grant execute on function public.update_shipment_item_check(uuid,uuid,boolean,boolean,text) to authenticated;
