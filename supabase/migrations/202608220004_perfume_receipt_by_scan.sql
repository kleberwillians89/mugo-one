begin;

-- O RUAH-P identifica o perfume. O bip apenas monta uma fotografia das
-- vendas pagas/reservadas que ainda aguardam a chegada física.
create function public.perfume_receipt_preview(p_operational_code text)
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare p public.perfumes; rows jsonb;
begin
  select * into p from public.perfumes
  where upper(operational_code)=upper(btrim(coalesce(p_operational_code,'')))
    and organization_id in(select public.current_user_org_ids());
  if p.id is null then return null; end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'sale_id',s.id,'client_name',c.name,'quantity_ml',a.quantity_ml,'sale_date',s.sale_date
  ) order by s.sale_date,s.created_at,s.id),'[]'::jsonb) into rows
  from public.sales s
  join public.clients c on c.id=s.client_id and c.organization_id=s.organization_id
  join public.inventory_allocations a on a.sale_id=s.id and a.organization_id=s.organization_id
    and a.perfume_id=s.perfume_id and a.status='reserved'
  where s.organization_id=p.organization_id and s.perfume_id=p.id
    and s.deleted_at is null and s.payment_status='paid' and s.shipped_at is null
    and s.shipping_availability_confirmed_at is null;

  return jsonb_build_object(
    'perfume_id',p.id,'perfume_name',p.full_name_raw,'brand_house',p.brand_house,
    'operational_code',p.operational_code,'sales',rows
  );
end;$$;
revoke all on function public.perfume_receipt_preview(text) from public,anon;
grant execute on function public.perfume_receipt_preview(text) to authenticated;

-- Confirma somente o snapshot exibido. Novas vendas não entram por
-- acidente; cada id é novamente validado e travado na mesma transação.
create function public.perfume_receipt_confirm(p_operational_code text,p_sale_ids uuid[])
returns jsonb language plpgsql security definer set search_path=public as $$
declare p public.perfumes; normalized uuid[]; expected integer; valid integer; changed integer; total numeric;
begin
  select * into p from public.perfumes
  where upper(operational_code)=upper(btrim(coalesce(p_operational_code,'')))
    and organization_id in(select public.current_user_org_ids());
  if p.id is null then raise exception 'perfume_not_found'; end if;
  if not public.has_org_permission(p.organization_id,'inventory.adjust') then raise exception 'forbidden'; end if;

  select coalesce(array_agg(distinct sale_id),'{}'::uuid[]) into normalized
  from unnest(coalesce(p_sale_ids,'{}'::uuid[])) as ids(sale_id);
  expected:=cardinality(normalized);
  if expected=0 then raise exception 'receipt_sales_required'; end if;

  perform s.id from public.sales s where s.id=any(normalized) order by s.id for update;
  select count(*),coalesce(sum(a.quantity_ml),0) into valid,total
  from public.sales s
  join public.inventory_allocations a on a.sale_id=s.id and a.organization_id=s.organization_id
    and a.perfume_id=s.perfume_id and a.status='reserved'
  where s.id=any(normalized) and s.organization_id=p.organization_id and s.perfume_id=p.id
    and s.deleted_at is null and s.payment_status='paid' and s.shipped_at is null;
  if valid<>expected then raise exception 'receipt_snapshot_changed'; end if;

  update public.sales set
    shipping_availability_confirmed_at=coalesce(shipping_availability_confirmed_at,now()),
    shipping_availability_confirmed_by=coalesce(shipping_availability_confirmed_by,auth.uid()),
    updated_at=case when shipping_availability_confirmed_at is null then now() else updated_at end
  where id=any(normalized) and shipping_availability_confirmed_at is null;
  get diagnostics changed=row_count;

  if changed>0 then
    insert into public.audit_logs(organization_id,actor_id,action,entity_type,entity_id,metadata)
    values(p.organization_id,auth.uid(),'perfume_receipt_confirmed','perfume',p.id::text,
      jsonb_build_object('perfume_id',p.id,'operational_code',p.operational_code,'sale_ids',to_jsonb(normalized),'sale_count',expected,'total_ml',total));
  end if;

  return jsonb_build_object('ok',true,'already_confirmed',changed=0,'sale_count',expected,'confirmed_count',changed,'total_ml',total,'perfume_id',p.id,'operational_code',p.operational_code);
end;$$;
revoke all on function public.perfume_receipt_confirm(text,uuid[]) from public,anon;
grant execute on function public.perfume_receipt_confirm(text,uuid[]) to authenticated;

-- Minha RUAH: previsão comercial nunca substitui recebimento físico. A
-- quantidade só é solicitável depois de recebida E preparada.
drop function public.customer_custody();
create function public.customer_custody() returns table(allocation_id uuid,perfume_id uuid,perfume_name text,quantity_ml numeric,sale_date date,allocation_status text,requested boolean,request_id uuid,shipping_availability_text text,shipping_availability_kind text,shipping_available_date date,shipping_lead_business_days integer,shipping_availability_confirmed_at timestamptz,shipping_requestable boolean,requestable_quantity_ml numeric,prepared_quantity_ml numeric)
language sql stable security definer set search_path=public as $$
 select a.id,a.perfume_id,p.full_name_raw,a.quantity_ml,s.sale_date,a.status::text,(req_current.request_id is not null),req_current.request_id,s.shipping_availability_text,s.shipping_availability_kind,s.shipping_available_date,s.shipping_lead_business_days,s.shipping_availability_confirmed_at,
   greatest(least(a.quantity_ml,coalesce(prep.prepared_ml,0)-coalesce(req.requested_ml,0)),0)>0 and s.shipping_availability_confirmed_at is not null,
   case when s.shipping_availability_confirmed_at is not null then greatest(least(a.quantity_ml,coalesce(prep.prepared_ml,0)-coalesce(req.requested_ml,0)),0) else 0 end,
   coalesce(prep.prepared_ml,0)
 from public.inventory_allocations a join public.perfumes p on p.id=a.perfume_id join public.sales s on s.id=a.sale_id
 left join lateral(select sum(bi.quantity_ml) prepared_ml from public.preparation_batch_items bi join public.preparation_batches b on b.id=bi.batch_id where bi.allocation_id=a.id and b.status='confirmed') prep on true
 left join lateral(select sum(ri.quantity_ml) requested_ml from public.customer_shipment_request_items ri join public.customer_shipment_requests r on r.id=ri.request_id left join public.shipments sh on sh.id=r.converted_shipment_id where ri.allocation_id=a.id and ((r.status='requested' and r.converted_shipment_id is null) or (r.status='converted' and sh.id is not null and sh.status not in('posted','delivered','cancelled')))) req on true
 left join lateral(select r.id request_id from public.customer_shipment_request_items ri join public.customer_shipment_requests r on r.id=ri.request_id left join public.shipments sh on sh.id=r.converted_shipment_id where ri.allocation_id=a.id and ((r.status='requested' and r.converted_shipment_id is null) or (r.status='converted' and sh.id is not null and sh.status not in('posted','delivered','cancelled'))) order by r.requested_at desc,r.id desc limit 1) req_current on true
 where a.client_id=public.current_customer_client() and a.status in('reserved','shipping') order by p.full_name_raw,s.sale_date;
$$;
revoke all on function public.customer_custody() from public,anon;grant execute on function public.customer_custody() to authenticated;

create or replace function public.customer_shipment_request_create_prepared(p_items jsonb,p_address jsonb,p_notes text default null)
returns public.customer_shipment_requests language plpgsql security definer set search_path=public as $$
declare client uuid;org uuid;item jsonb;a public.inventory_allocations;qty numeric;prepared numeric;requested numeric;received boolean;request public.customer_shipment_requests;
begin
 client:=public.current_customer_client();if client is null then raise exception 'forbidden';end if;if jsonb_typeof(p_items)<>'array' or jsonb_array_length(p_items)=0 then raise exception 'no_items_selected';end if;
 select organization_id into org from public.clients where id=client;
 if coalesce(btrim(p_address->>'postal_code'),'')='' or coalesce(btrim(p_address->>'address_line'),'')='' or coalesce(btrim(p_address->>'city'),'')='' or coalesce(btrim(p_address->>'state'),'')='' then raise exception 'incomplete_address';end if;
 for item in select * from jsonb_array_elements(p_items) loop
  select * into a from public.inventory_allocations where id=(item->>'allocation_id')::uuid and client_id=client and status='reserved' for update;qty:=(item->>'quantity_ml')::numeric;if a.id is null or qty<=0 then raise exception 'invalid_or_unavailable_custody';end if;
  select coalesce(sum(bi.quantity_ml),0) into prepared from public.preparation_batch_items bi join public.preparation_batches b on b.id=bi.batch_id where bi.allocation_id=a.id and b.status='confirmed';
  select coalesce(sum(ri.quantity_ml),0) into requested from public.customer_shipment_request_items ri join public.customer_shipment_requests r on r.id=ri.request_id left join public.shipments sh on sh.id=r.converted_shipment_id where ri.allocation_id=a.id and ((r.status='requested' and r.converted_shipment_id is null) or (r.status='converted' and sh.id is not null and sh.status not in('posted','delivered','cancelled')));
  select shipping_availability_confirmed_at is not null into received from public.sales where id=a.sale_id;
  if not coalesce(received,false) or qty>least(a.quantity_ml,prepared-requested) then raise exception 'shipping_availability_pending';end if;
 end loop;
 insert into public.customer_shipment_requests(organization_id,client_id,address_snapshot,notes,created_by_auth_user_id) values(org,client,p_address,nullif(btrim(p_notes),''),auth.uid()) returning * into request;
 insert into public.customer_shipment_request_items(request_id,allocation_id,perfume_id,quantity_ml) select request.id,a.id,a.perfume_id,(item->>'quantity_ml')::numeric from jsonb_array_elements(p_items) item join public.inventory_allocations a on a.id=(item->>'allocation_id')::uuid;
 return request;
end;$$;
revoke all on function public.customer_shipment_request_create_prepared(jsonb,jsonb,text) from public,anon;grant execute on function public.customer_shipment_request_create_prepared(jsonb,jsonb,text) to authenticated;

commit;
