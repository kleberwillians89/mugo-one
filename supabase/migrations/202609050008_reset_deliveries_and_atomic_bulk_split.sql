begin;

-- One-time cleanup approved after the 2026-09-05 commercial reset. The IDs
-- below were individually inspected and backed up before this migration:
-- all four shipments were created on/after 2026-09-04, none was posted or
-- delivered, and none had an order, label or tracking code.
create temporary table reset_delivery_targets on commit drop as
select id,organization_id
from public.shipments
where id = any(array[
  '43376ed4-b66f-4791-a8ff-999e6bfc333f'::uuid,
  '73afe7a8-5dee-4fdc-a106-95e28935cad6'::uuid,
  'a8a29b95-dbf5-415f-83d5-3b6ab6312685'::uuid,
  'f0f109d6-aa96-4fa7-997c-d37c5b82dd4d'::uuid
]);

do $$
begin
  if exists(
    select 1 from public.shipments s join reset_delivery_targets t on t.id=s.id
    where s.created_at<'2026-09-04T00:00:00Z'::timestamptz
       or s.status in ('posted','delivered')
       or s.posted_at is not null or s.delivered_at is not null
       or s.superfrete_order_id is not null or s.tracking_code is not null
       or s.label_generated_at is not null or s.label_pdf_url is not null or s.print_url is not null
  ) then raise exception 'unsafe_delivery_reset_target'; end if;
  if exists(
    select 1 from public.customer_support_tickets ticket
    join reset_delivery_targets t on t.id=ticket.shipment_id
  ) then raise exception 'delivery_reset_target_has_support_ticket'; end if;
  if exists(
    select 1 from public.customer_shipment_requests request
    join reset_delivery_targets t on t.id=request.converted_shipment_id
  ) then raise exception 'delivery_reset_target_has_customer_request'; end if;
end;$$;

-- Restore only the operational shipment link. Quantity, stock ownership,
-- sale, client, perfume and allocation identity remain untouched.
update public.inventory_allocations allocation
set shipment_id=null,
    status=case when allocation.status='shipping' then 'reserved'::public.inventory_allocation_status else allocation.status end,
    updated_at=now()
where allocation.shipment_id in(select id from reset_delivery_targets);

delete from public.integration_runs run
where run.entity_type='shipment' and run.entity_id in(select id from reset_delivery_targets);

update public.shipments shipment set selected_quote_id=null
where shipment.id in(select id from reset_delivery_targets);

-- shipment_items, shipment_events and shipment_quotes are ON DELETE CASCADE.
delete from public.shipments shipment
where shipment.id in(select id from reset_delivery_targets);

insert into public.audit_logs(organization_id,actor_id,action,entity_type,entity_id,metadata)
select organization_id,null,'reset_discarded_operational_shipments','shipment',null,
  jsonb_build_object('shipment_ids',jsonb_agg(id order by id),'count',count(*),'source','approved_reset_2026_09_05')
from reset_delivery_targets group by organization_id;

-- Atomic selected-row completion. Bulk undo is intentionally forbidden;
-- an operator can still undo one sale through set_sale_split_status.
create or replace function public.set_sale_split_status_bulk(p_sale_ids uuid[],p_status text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare uid uuid:=auth.uid(); requested_count integer; locked_count integer;
  changed_ids uuid[]:=array[]::uuid[]; changed_at timestamptz:=now();
begin
  if uid is null then raise exception 'authentication_required'; end if;
  if p_status<>'split' then raise exception 'bulk_split_undo_not_allowed'; end if;
  if p_sale_ids is null or array_length(p_sale_ids,1) is null then raise exception 'no_sales_selected'; end if;
  select count(distinct id) into requested_count from unnest(p_sale_ids) selected(id);

  perform 1 from public.sales sale
  where sale.id=any(p_sale_ids)
    and sale.organization_id in(select public.current_user_org_ids())
    and public.has_org_permission(sale.organization_id,'sales.edit')
    and sale.deleted_at is null and sale.sale_type='SPLIT'
  for update;
  get diagnostics locked_count = row_count;
  if locked_count<>requested_count then raise exception 'bulk_split_selection_not_eligible'; end if;

  with changed as(
    update public.sales sale set split_status='split',split_completed_at=current_date,
      split_completed_by=uid,updated_at=changed_at
    where sale.id=any(p_sale_ids) and sale.sale_type='SPLIT'
      and sale.deleted_at is null and sale.split_completed_at is null
    returning sale.id,sale.organization_id
  ) select coalesce(array_agg(id order by id),'{}'::uuid[]) into changed_ids from changed;

  insert into public.sale_split_status_audit(organization_id,sale_id,actor_id,previous_status,new_status,changed_at)
  select sale.organization_id,sale.id,uid,'not_split','split',changed_at
  from public.sales sale where sale.id=any(changed_ids);
  insert into public.audit_logs(organization_id,actor_id,action,entity_type,entity_id,metadata)
  select sale.organization_id,uid,'bulk_split_completed','sales',null,
    jsonb_build_object('count',count(*),'sale_ids',jsonb_agg(sale.id order by sale.id),'completed_at',changed_at)
  from public.sales sale where sale.id=any(changed_ids) group by sale.organization_id;
  return jsonb_build_object('updated',to_jsonb(changed_ids),'updated_count',cardinality(changed_ids),'completed_at',changed_at);
end;$$;
revoke all on function public.set_sale_split_status_bulk(uuid[],text) from public,anon;
grant execute on function public.set_sale_split_status_bulk(uuid[],text) to authenticated;

-- Completes every still-eligible SPLIT matching the current screen filters,
-- including rows outside the rendered viewport. One function call is one
-- database transaction: a backend error rolls the whole action back.
create or replace function public.complete_sale_splits_for_filter(p_filters jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path=public as $$
declare uid uuid:=auth.uid(); changed_ids uuid[]:=array[]::uuid[]; changed_at timestamptz:=now();
begin
  if uid is null then raise exception 'authentication_required'; end if;
  with eligible as(
    select sale.id
    from public.sales sale
    join public.clients client on client.id=sale.client_id
    left join public.perfumes perfume on perfume.id=sale.perfume_id
    where sale.organization_id in(select public.current_user_org_ids())
      and public.has_org_permission(sale.organization_id,'sales.edit')
      and sale.sale_type='SPLIT' and sale.deleted_at is null
      and sale.split_status='not_split' and sale.split_completed_at is null
      and (nullif(p_filters->>'search','') is null or client.name ilike '%'||(p_filters->>'search')||'%' or perfume.full_name_raw ilike '%'||(p_filters->>'search')||'%')
      and (nullif(p_filters->>'client','') is null or client.name ilike '%'||(p_filters->>'client')||'%')
      and (nullif(p_filters->>'perfume','') is null or perfume.full_name_raw ilike '%'||(p_filters->>'perfume')||'%')
      and (nullif(p_filters->>'brand','') is null or perfume.brand_house ilike '%'||(p_filters->>'brand')||'%')
      and (nullif(p_filters->>'purchase_date','') is null or sale.sale_date=(p_filters->>'purchase_date')::date)
      and (nullif(p_filters->>'bottle','') is null or sale.bottle_identifier ilike '%'||(p_filters->>'bottle')||'%')
    order by sale.id for update of sale
  ), changed as(
    update public.sales sale set split_status='split',split_completed_at=current_date,
      split_completed_by=uid,updated_at=changed_at
    from eligible where sale.id=eligible.id
      and sale.sale_type='SPLIT' and sale.split_completed_at is null
    returning sale.id,sale.organization_id
  ) select coalesce(array_agg(id order by id),'{}'::uuid[]) into changed_ids from changed;

  insert into public.sale_split_status_audit(organization_id,sale_id,actor_id,previous_status,new_status,changed_at)
  select sale.organization_id,sale.id,uid,'not_split','split',changed_at
  from public.sales sale where sale.id=any(changed_ids);
  insert into public.audit_logs(organization_id,actor_id,action,entity_type,entity_id,metadata)
  select sale.organization_id,uid,'bulk_split_completed','sales',null,
    jsonb_build_object('count',count(*),'sale_ids',jsonb_agg(sale.id order by sale.id),'completed_at',changed_at,'filters',p_filters)
  from public.sales sale where sale.id=any(changed_ids) group by sale.organization_id;
  return jsonb_build_object('updated',to_jsonb(changed_ids),'updated_count',cardinality(changed_ids),'completed_at',changed_at);
end;$$;
revoke all on function public.complete_sale_splits_for_filter(jsonb) from public,anon;
grant execute on function public.complete_sale_splits_for_filter(jsonb) to authenticated;

commit;
