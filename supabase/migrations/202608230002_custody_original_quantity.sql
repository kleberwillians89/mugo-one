begin;

create or replace function public.confirm_legacy_product_custody(
  p_sale_id uuid,
  p_storage_location text default null,
  p_verification_note text default null
) returns public.inventory_allocations
language plpgsql
security definer
set search_path=public
as $$
declare
  v_sale public.sales;
  v_allocation public.inventory_allocations;
begin
  select * into v_sale
  from public.sales
  where id=p_sale_id and deleted_at is null
  for update;

  if v_sale.id is null or not public.has_org_role(v_sale.organization_id,array['admin','manager','operator']::public.member_role[])
    then raise exception 'forbidden'; end if;
  if v_sale.client_id is null or v_sale.perfume_id is null or v_sale.volume_ml is null or v_sale.volume_ml<=0
    then raise exception 'sale_missing_operational_fields'; end if;
  if v_sale.shipped_at is not null then raise exception 'sale_already_shipped'; end if;

  select * into v_allocation
  from public.inventory_allocations
  where sale_id=v_sale.id and status in('reserved','shipping','shipped')
  for update;

  if v_allocation.id is not null then raise exception 'product_already_confirmed_for_shipping'; end if;

  insert into public.inventory_allocations(
    organization_id,inventory_item_id,client_id,sale_id,perfume_id,quantity_ml,original_quantity_ml,status,allocated_at,
    allocation_source,stock_managed,verified_at,verified_by,verification_note,storage_location,created_by
  ) values(
    v_sale.organization_id,null,v_sale.client_id,v_sale.id,v_sale.perfume_id,v_sale.volume_ml,v_sale.volume_ml,'reserved',now(),
    'legacy_manual_verified',false,now(),auth.uid(),coalesce(nullif(btrim(p_verification_note),''),'Produto conferido manualmente para envio.'),nullif(btrim(p_storage_location),''),auth.uid()
  ) returning * into v_allocation;

  insert into public.audit_logs(organization_id,actor_id,action,entity_type,entity_id,metadata)
  values(v_sale.organization_id,auth.uid(),'legacy_custody_confirmed','inventory_allocation',v_allocation.id::text,
    jsonb_build_object('sale_id',v_sale.id,'client_id',v_sale.client_id,'quantity_ml',v_sale.volume_ml,
      'original_quantity_ml',v_sale.volume_ml,'storage_location',v_allocation.storage_location,'stock_managed',false));

  return v_allocation;
end;
$$;

grant execute on function public.confirm_legacy_product_custody(uuid,text,text) to authenticated;

commit;
