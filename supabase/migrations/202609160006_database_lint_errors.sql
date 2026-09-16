begin;

-- pgcrypto is installed in Supabase's extensions schema. The former
-- exception fallback referenced public.digest(), which does not exist and
-- made the database linter reject the function body.
create or replace function public.ai_sha256_hex(value text)
returns text
language sql
immutable
strict
parallel safe
set search_path = public
as $$
  select encode(extensions.digest(value, 'sha256'), 'hex');
$$;
revoke all on function public.ai_sha256_hex(text) from public, anon;
grant execute on function public.ai_sha256_hex(text) to authenticated, service_role;

-- Avoid the collision between the allocation record variable and the SQL
-- alias used while inserting the selected request items.
create or replace function public.customer_shipment_request_create_prepared(p_items jsonb,p_address jsonb,p_notes text default null)
returns public.customer_shipment_requests language plpgsql security definer set search_path=public as $$
declare client uuid;org uuid;item jsonb;allocation public.inventory_allocations;qty numeric;prepared numeric;requested numeric;received boolean;request public.customer_shipment_requests;active_request public.customer_shipment_requests;requested_ids uuid[];requested_snapshot jsonb;existing_snapshot jsonb;item_count integer;distinct_count integer;
begin
 client:=public.current_customer_client();if client is null then raise exception 'forbidden';end if;
 if jsonb_typeof(p_items)<>'array' or jsonb_array_length(p_items)=0 then raise exception 'no_items_selected';end if;
 perform pg_advisory_xact_lock(hashtextextended(client::text,220005));
 select organization_id into org from public.clients where id=client;
 select r.* into active_request from public.customer_shipment_requests r left join public.shipments sh on sh.id=r.converted_shipment_id
 where r.client_id=client and ((r.status='requested' and r.converted_shipment_id is null) or (r.status='converted' and sh.status not in('posted','delivered','cancelled')))
 order by r.requested_at desc limit 1 for update of r;
 select count(*),count(distinct (value->>'allocation_id')::uuid),coalesce(array_agg(distinct (value->>'allocation_id')::uuid order by (value->>'allocation_id')::uuid),'{}'::uuid[]),jsonb_agg(jsonb_build_object('allocation_id',(value->>'allocation_id')::uuid,'quantity_ml',(value->>'quantity_ml')::numeric) order by (value->>'allocation_id')::uuid)
 into item_count,distinct_count,requested_ids,requested_snapshot from jsonb_array_elements(p_items);
 if item_count<>distinct_count then raise exception 'duplicate_allocation';end if;
 if active_request.id is not null then
  select jsonb_agg(jsonb_build_object('allocation_id',allocation_id,'quantity_ml',quantity_ml) order by allocation_id) into existing_snapshot from public.customer_shipment_request_items where request_id=active_request.id;
  if existing_snapshot=requested_snapshot then return active_request;end if;
  raise exception 'active_shipment_exists';
 end if;
 if coalesce(btrim(p_address->>'postal_code'),'')='' or coalesce(btrim(p_address->>'address_line'),'')='' or coalesce(btrim(p_address->>'city'),'')='' or coalesce(btrim(p_address->>'state'),'')='' then raise exception 'incomplete_address';end if;
 for item in select * from jsonb_array_elements(p_items) loop
  select * into allocation from public.inventory_allocations ia where ia.id=(item->>'allocation_id')::uuid and ia.client_id=client and ia.status='reserved' for update;
  qty:=(item->>'quantity_ml')::numeric;if allocation.id is null or qty<=0 then raise exception 'invalid_or_unavailable_custody';end if;
  select coalesce(sum(bi.quantity_ml),0) into prepared from public.preparation_batch_items bi join public.preparation_batches b on b.id=bi.batch_id where bi.allocation_id=allocation.id and b.status='confirmed';
  select coalesce(sum(ri.quantity_ml),0) into requested from public.customer_shipment_request_items ri join public.customer_shipment_requests r on r.id=ri.request_id left join public.shipments sh on sh.id=r.converted_shipment_id where ri.allocation_id=allocation.id and ((r.status='requested' and r.converted_shipment_id is null) or (r.status='converted' and sh.id is not null and sh.status not in('posted','delivered','cancelled')));
  select shipping_availability_confirmed_at is not null into received from public.sales where id=allocation.sale_id;
  if not coalesce(received,false) or qty>least(allocation.quantity_ml,prepared-requested) then raise exception 'shipping_availability_pending';end if;
 end loop;
 insert into public.customer_shipment_requests(organization_id,client_id,address_snapshot,notes,created_by_auth_user_id) values(org,client,p_address,nullif(btrim(p_notes),''),auth.uid()) returning * into request;
 insert into public.customer_shipment_request_items(request_id,allocation_id,perfume_id,quantity_ml)
 select request.id,ia.id,ia.perfume_id,(entry.value->>'quantity_ml')::numeric
 from jsonb_array_elements(p_items) entry(value)
 join public.inventory_allocations ia on ia.id=(entry.value->>'allocation_id')::uuid;
 insert into public.audit_logs(organization_id,actor_id,action,entity_type,entity_id,metadata) values(org,auth.uid(),'customer_shipment_requested','customer_shipment_request',request.id::text,jsonb_build_object('allocation_ids',requested_ids,'item_count',cardinality(requested_ids)));
 return request;
end;$$;
revoke all on function public.customer_shipment_request_create_prepared(jsonb,jsonb,text) from public,anon;
grant execute on function public.customer_shipment_request_create_prepared(jsonb,jsonb,text) to authenticated;

-- Volatility declarations now match the expressions used by each helper.
alter function public.superfrete_safe_timestamptz(text) stable;
alter function public.davi_excel_filter_matches(jsonb,text,numeric,date,text) stable;

commit;
