begin;

-- A solicitação é uma fotografia explícita. Uma trava por cliente fecha a
-- corrida entre dois cliques/abas sem confiar em estado calculado no browser.
create or replace function public.customer_shipment_request_create_prepared(p_items jsonb,p_address jsonb,p_notes text default null)
returns public.customer_shipment_requests language plpgsql security definer set search_path=public as $$
declare client uuid;org uuid;item jsonb;a public.inventory_allocations;qty numeric;prepared numeric;requested numeric;received boolean;request public.customer_shipment_requests;active_request public.customer_shipment_requests;requested_ids uuid[];requested_snapshot jsonb;existing_snapshot jsonb;item_count integer;distinct_count integer;
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
  select * into a from public.inventory_allocations where id=(item->>'allocation_id')::uuid and client_id=client and status='reserved' for update;
  qty:=(item->>'quantity_ml')::numeric;if a.id is null or qty<=0 then raise exception 'invalid_or_unavailable_custody';end if;
  select coalesce(sum(bi.quantity_ml),0) into prepared from public.preparation_batch_items bi join public.preparation_batches b on b.id=bi.batch_id where bi.allocation_id=a.id and b.status='confirmed';
  select coalesce(sum(ri.quantity_ml),0) into requested from public.customer_shipment_request_items ri join public.customer_shipment_requests r on r.id=ri.request_id left join public.shipments sh on sh.id=r.converted_shipment_id where ri.allocation_id=a.id and ((r.status='requested' and r.converted_shipment_id is null) or (r.status='converted' and sh.id is not null and sh.status not in('posted','delivered','cancelled')));
  select shipping_availability_confirmed_at is not null into received from public.sales where id=a.sale_id;
  if not coalesce(received,false) or qty>least(a.quantity_ml,prepared-requested) then raise exception 'shipping_availability_pending';end if;
 end loop;
 insert into public.customer_shipment_requests(organization_id,client_id,address_snapshot,notes,created_by_auth_user_id) values(org,client,p_address,nullif(btrim(p_notes),''),auth.uid()) returning * into request;
 insert into public.customer_shipment_request_items(request_id,allocation_id,perfume_id,quantity_ml)
 select request.id,a.id,a.perfume_id,(item->>'quantity_ml')::numeric from jsonb_array_elements(p_items) item join public.inventory_allocations a on a.id=(item->>'allocation_id')::uuid;
 insert into public.audit_logs(organization_id,actor_id,action,entity_type,entity_id,metadata) values(org,auth.uid(),'customer_shipment_requested','customer_shipment_request',request.id::text,jsonb_build_object('allocation_ids',requested_ids,'item_count',cardinality(requested_ids)));
 return request;
end;$$;
revoke all on function public.customer_shipment_request_create_prepared(jsonb,jsonb,text) from public,anon;
grant execute on function public.customer_shipment_request_create_prepared(jsonb,jsonb,text) to authenticated;

-- Leitura única, paginada e tenant-scoped para a grade comercial. Crédito e
-- logística são derivados/read-only; nenhuma tabela paralela é criada.
create function public.davi_excel_list(p_filters jsonb default '{}'::jsonb,p_page integer default 0,p_page_size integer default 100,p_sort text default 'sale_date_desc')
returns jsonb language sql stable security definer set search_path=public as $$
with base as (
 select s.id,s.sale_date,c.name client_name,p.full_name_raw perfume_name,s.sale_type,s.volume_ml,s.amount,s.payment_status::text,s.payment_method,s.paid_at,s.credit_reference_amount,s.notes,coalesce(s.import_signature,'') search_reference,
 coalesce(ship.posted_at,s.shipped_at) shipped_at,
 case
  when s.payment_status='cancelled' then 'CANCELADO'
  when coalesce(ship.posted_at,s.shipped_at) is not null then 'ENVIADO'
  when active_client.request_id is not null and own_request.request_id is null then 'PRÓXIMO ENVIO'
  when own_request.request_id is not null then 'ENVIO EM ANDAMENTO'
  when s.shipping_availability_confirmed_at is null then 'AGUARDANDO PERFUME'
  when coalesce(prep.prepared_ml,0)<coalesce(a.quantity_ml,s.volume_ml,0) then 'AGUARDANDO PREPARAÇÃO'
  else 'PRONTO PARA ENVIO' end operational_status,
 case when coalesce(ship.posted_at,s.shipped_at) is not null then 'ENVIADO' when s.payment_status='cancelled' then 'CANCELADO' when s.shipping_available_date is not null and s.shipping_availability_confirmed_at is null then to_char(s.shipping_available_date,'DD/MM/YYYY') else null end shipping_deadline_display
 from public.sales s join public.clients c on c.id=s.client_id and c.organization_id=s.organization_id left join public.perfumes p on p.id=s.perfume_id
 left join public.inventory_allocations a on a.sale_id=s.id
 left join lateral(select sum(bi.quantity_ml) prepared_ml from public.preparation_batch_items bi join public.preparation_batches b on b.id=bi.batch_id and b.status='confirmed' where bi.allocation_id=a.id) prep on true
 left join lateral(select sh.posted_at from public.shipment_items si join public.shipments sh on sh.id=si.shipment_id where si.sale_id=s.id and si.removed_at is null order by sh.created_at desc limit 1) ship on true
 left join lateral(select r.id request_id from public.customer_shipment_request_items ri join public.customer_shipment_requests r on r.id=ri.request_id left join public.shipments sh on sh.id=r.converted_shipment_id where ri.allocation_id=a.id and ((r.status='requested' and r.converted_shipment_id is null) or(r.status='converted' and sh.status not in('posted','delivered','cancelled'))) limit 1) own_request on true
 left join lateral(select r.id request_id from public.customer_shipment_requests r left join public.shipments sh on sh.id=r.converted_shipment_id where r.client_id=s.client_id and ((r.status='requested' and r.converted_shipment_id is null) or(r.status='converted' and sh.status not in('posted','delivered','cancelled'))) limit 1) active_client on true
 where s.organization_id in(select public.current_user_org_ids()) and public.has_org_permission(s.organization_id,'sales.view') and s.deleted_at is null
), filtered as (
 select * from base where
  (coalesce(p_filters->>'search','')='' or client_name ilike '%'||(p_filters->>'search')||'%' or perfume_name ilike '%'||(p_filters->>'search')||'%' or notes ilike '%'||(p_filters->>'search')||'%' or search_reference ilike '%'||(p_filters->>'search')||'%') and
  (coalesce(p_filters->>'client','')='' or client_name ilike '%'||(p_filters->>'client')||'%') and
  (coalesce(p_filters->>'perfume','')='' or perfume_name ilike '%'||(p_filters->>'perfume')||'%') and
  (coalesce(p_filters->>'type','')='' or sale_type=p_filters->>'type') and
  (coalesce(p_filters->>'payment','')='' or payment_status=p_filters->>'payment') and
  (coalesce(p_filters->>'method','')='' or payment_method ilike '%'||(p_filters->>'method')||'%') and
  (coalesce(p_filters->>'operational_status','')='' or operational_status=p_filters->>'operational_status') and
  (coalesce(p_filters->>'sale_from','')='' or sale_date>=(p_filters->>'sale_from')::date) and
  (coalesce(p_filters->>'sale_to','')='' or sale_date<=(p_filters->>'sale_to')::date) and
  (coalesce(p_filters->>'shipped_from','')='' or shipped_at::date>=(p_filters->>'shipped_from')::date) and
  (coalesce(p_filters->>'shipped_to','')='' or shipped_at::date<=(p_filters->>'shipped_to')::date) and
  (coalesce(p_filters->>'credit','')='' or (p_filters->>'credit'='with' and coalesce(credit_reference_amount,0)>0) or (p_filters->>'credit'='without' and coalesce(credit_reference_amount,0)=0))
), counted as(select *,count(*) over() total_count from filtered), ordered as (
 select * from counted order by
  case when p_sort='client_asc' then client_name end asc,case when p_sort='client_desc' then client_name end desc,
  case when p_sort='sale_date_asc' then sale_date end asc,case when p_sort='sale_date_desc' then sale_date end desc,
  case when p_sort='deadline_asc' then shipping_deadline_display end asc,case when p_sort='deadline_desc' then shipping_deadline_display end desc,
  case when p_sort='shipped_at_asc' then shipped_at end asc,case when p_sort='shipped_at_desc' then shipped_at end desc,
  case when p_sort='type_asc' then sale_type end asc,case when p_sort='type_desc' then sale_type end desc,
  case when p_sort='volume_asc' then volume_ml end asc,case when p_sort='volume_desc' then volume_ml end desc,
  case when p_sort='perfume_asc' then perfume_name end asc,case when p_sort='perfume_desc' then perfume_name end desc,
  case when p_sort='amount_asc' then amount end asc,case when p_sort='amount_desc' then amount end desc,
  case when p_sort='payment_asc' then payment_status end asc,case when p_sort='payment_desc' then payment_status end desc,
  case when p_sort='paid_at_asc' then paid_at end asc,case when p_sort='paid_at_desc' then paid_at end desc,id desc
 limit least(greatest(p_page_size,1),500) offset greatest(p_page,0)*least(greatest(p_page_size,1),500)
)
select jsonb_build_object('rows',coalesce(jsonb_agg(to_jsonb(ordered)-'total_count'-'search_reference'),'[]'::jsonb),'total',coalesce(max(total_count),0)) from ordered;
$$;
revoke all on function public.davi_excel_list(jsonb,integer,integer,text) from public,anon;
grant execute on function public.davi_excel_list(jsonb,integer,integer,text) to authenticated;

create function public.davi_excel_update(p_sale_id uuid,p_patch jsonb)
returns jsonb language plpgsql security definer set search_path=public as $$
declare s public.sales;allowed text[]:=array['sale_date','sale_type','amount','payment_status','payment_method','paid_at','notes'];key text;
begin
 select * into s from public.sales where id=p_sale_id and organization_id in(select public.current_user_org_ids()) and deleted_at is null for update;
 if s.id is null then raise exception 'sale_not_found';end if;
 if not public.has_org_permission(s.organization_id,'sales.edit') then raise exception 'forbidden';end if;
 for key in select jsonb_object_keys(p_patch) loop if not(key=any(allowed)) then raise exception 'field_not_editable';end if;end loop;
 update public.sales set sale_date=case when p_patch?'sale_date' then (p_patch->>'sale_date')::date else sale_date end,sale_type=case when p_patch?'sale_type' then nullif(btrim(p_patch->>'sale_type'),'') else sale_type end,amount=case when p_patch?'amount' then (p_patch->>'amount')::numeric else amount end,payment_status=case when p_patch?'payment_status' then (p_patch->>'payment_status')::public.payment_status else payment_status end,payment_method=case when p_patch?'payment_method' then nullif(btrim(p_patch->>'payment_method'),'') else payment_method end,paid_at=case when p_patch?'paid_at' then nullif(p_patch->>'paid_at','')::date else paid_at end,notes=case when p_patch?'notes' then nullif(btrim(p_patch->>'notes'),'') else notes end,updated_at=now() where id=s.id returning * into s;
 return jsonb_build_object('id',s.id,'saved',true);
end;$$;
revoke all on function public.davi_excel_update(uuid,jsonb) from public,anon;
grant execute on function public.davi_excel_update(uuid,jsonb) to authenticated;

commit;
