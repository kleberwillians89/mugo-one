begin;

-- O recebimento físico também reconcilia vendas elegíveis que nasceram antes
-- do inventory_item. A alocação consome apenas disponível, nunca physical_ml.
create or replace function public.inventory_receive_perfume(
 p_organization_id uuid,p_perfume_id uuid,p_received_ml numeric,p_minimum_ml numeric,
 p_reference_date date,p_notes text,p_idempotency_key uuid
) returns public.inventory_items language plpgsql security definer set search_path=public as $$
declare item public.inventory_items;prior public.audit_logs;code text;s public.sales;
begin
 if not public.has_org_permission(p_organization_id,'inventory.adjust') then raise exception 'inventory_write_forbidden';end if;
 if p_received_ml is null or p_received_ml<=0 or p_minimum_ml is null or p_minimum_ml<0 or p_reference_date is null or p_idempotency_key is null then raise exception 'invalid_inventory_receipt';end if;
 if not exists(select 1 from public.perfumes where id=p_perfume_id and organization_id=p_organization_id) then raise exception 'perfume_not_found';end if;
 perform pg_advisory_xact_lock(hashtextextended(p_idempotency_key::text,230010));
 select * into prior from public.audit_logs where organization_id=p_organization_id and action='inventory_physical_receipt' and metadata->>'idempotency_key'=p_idempotency_key::text order by created_at limit 1;
 if prior.id is not null then
  if prior.metadata->>'perfume_id'<>p_perfume_id::text or(prior.metadata->>'received_ml')::numeric<>p_received_ml or(prior.metadata->>'minimum_ml')::numeric<>p_minimum_ml or(prior.metadata->>'reference_date')::date<>p_reference_date or coalesce(prior.metadata->>'notes','')<>coalesce(p_notes,'') then raise exception 'idempotency_key_reused_with_different_payload';end if;
  select * into item from public.inventory_items where id=prior.entity_id::uuid and organization_id=p_organization_id;
  if item.id is null then raise exception 'idempotent_inventory_receipt_inconsistent';end if;return item;
 end if;
 insert into public.inventory_items(organization_id,perfume_id,reference_date,available_ml,physical_ml,minimum_ml,notes,created_by)
 values(p_organization_id,p_perfume_id,p_reference_date,0,0,p_minimum_ml,p_notes,auth.uid()) on conflict(organization_id,perfume_id) do nothing returning * into item;
 if item.id is null then select * into item from public.inventory_items where organization_id=p_organization_id and perfume_id=p_perfume_id for update;end if;
 code:=public.ensure_perfume_operational_code(p_perfume_id);
 perform public.inventory_apply(item.id,p_received_ml,'entry','Recebimento físico do perfume',p_notes,null);
 update public.inventory_items set minimum_ml=p_minimum_ml,reference_date=greatest(reference_date,p_reference_date),updated_at=now() where id=item.id returning * into item;
 for s in select sale.* from public.sales sale where sale.organization_id=p_organization_id and sale.perfume_id=p_perfume_id and sale.deleted_at is null and sale.payment_status='paid' and sale.inventory_allocation_eligible and sale.volume_ml>0 and not exists(select 1 from public.inventory_allocations a where a.sale_id=sale.id and a.status in('reserved','shipping','shipped')) order by sale.sale_date,sale.created_at,sale.id for update loop
  select i.* into item from public.inventory_items i where i.id=item.id for update;
  if item.available_ml>=s.volume_ml then
   update public.inventory_items set available_ml=available_ml-s.volume_ml,updated_at=now() where id=item.id returning * into item;
   insert into public.inventory_allocations(organization_id,inventory_item_id,client_id,sale_id,perfume_id,quantity_ml,original_quantity_ml,status,allocated_at,allocation_source,stock_managed,created_by)
   values(p_organization_id,item.id,s.client_id,s.id,p_perfume_id,s.volume_ml,s.volume_ml,'reserved',now(),'operational_stock',true,auth.uid());
  end if;
 end loop;
 insert into public.audit_logs(organization_id,actor_id,action,entity_type,entity_id,metadata)
 values(p_organization_id,auth.uid(),'inventory_physical_receipt','inventory_item',item.id::text,jsonb_build_object('idempotency_key',p_idempotency_key,'perfume_id',p_perfume_id,'received_ml',p_received_ml,'minimum_ml',p_minimum_ml,'reference_date',p_reference_date,'notes',p_notes,'operational_code',code));
 return item;
end;$$;
revoke all on function public.inventory_receive_perfume(uuid,uuid,numeric,numeric,date,text,uuid) from public,anon;
grant execute on function public.inventory_receive_perfume(uuid,uuid,numeric,numeric,date,text,uuid) to authenticated;

create function public.inventory_preparation_totals()
returns table(perfume_id uuid,preparing_ml numeric) language sql stable security definer set search_path=public as $$
 select b.perfume_id,coalesce(sum(bi.quantity_ml) filter(where s.sale_type='SPLIT'),0)
 from public.preparation_batches b join public.preparation_batch_items bi on bi.batch_id=b.id join public.inventory_allocations a on a.id=bi.allocation_id join public.sales s on s.id=a.sale_id
 where b.organization_id in(select public.current_user_org_ids()) and b.status in('awaiting_scan','identified') group by b.perfume_id;
$$;
revoke all on function public.inventory_preparation_totals() from public,anon;
grant execute on function public.inventory_preparation_totals() to authenticated;

create function public.inventory_station_confirm_preparation(p_operational_code text,p_items jsonb,p_idempotency_key uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare p public.perfumes;prior public.audit_logs;batch uuid;identified jsonb;confirmed jsonb;
begin
 if p_idempotency_key is null or jsonb_typeof(p_items)<>'array' or jsonb_array_length(p_items)=0 then raise exception 'preparation_items_required';end if;
 select * into p from public.perfumes where upper(operational_code)=upper(btrim(p_operational_code)) and organization_id in(select public.current_user_org_ids());
 if p.id is null then raise exception 'code_not_found';end if;
 if not public.has_org_permission(p.organization_id,'inventory.adjust') then raise exception 'forbidden';end if;
 if not exists(select 1 from public.inventory_items i join public.audit_logs a on a.organization_id=i.organization_id and a.entity_type='inventory_item' and a.entity_id=i.id::text and a.action='inventory_physical_receipt' where i.perfume_id=p.id and i.organization_id=p.organization_id) then raise exception 'perfume_not_received';end if;
 perform pg_advisory_xact_lock(hashtextextended(p_idempotency_key::text,230010));
 select * into prior from public.audit_logs where organization_id=p.organization_id and action='inventory_station_preparation_confirmed' and metadata->>'idempotency_key'=p_idempotency_key::text order by created_at limit 1;
 if prior.id is not null then
  if prior.metadata->>'operational_code'<>p.operational_code or prior.metadata->'items'<>p_items then raise exception 'idempotency_key_reused_with_different_payload';end if;
  return jsonb_build_object('ok',true,'already_confirmed',true,'batch_id',prior.metadata->>'batch_id','item_count',(prior.metadata->>'item_count')::integer,'total_ml',(prior.metadata->>'total_ml')::numeric);
 end if;
 batch:=public.preparation_batch_create(p.id,p_items);
 identified:=public.preparation_batch_identify(batch,p.operational_code);
 if not coalesce((identified->>'ok')::boolean,false) then raise exception 'scan_confirmation_failed';end if;
 confirmed:=public.preparation_batch_confirm(batch);
 insert into public.audit_logs(organization_id,actor_id,action,entity_type,entity_id,metadata)
 values(p.organization_id,auth.uid(),'inventory_station_preparation_confirmed','preparation_batch',batch::text,jsonb_build_object('idempotency_key',p_idempotency_key,'batch_id',batch,'perfume_id',p.id,'operational_code',p.operational_code,'items',p_items,'item_count',confirmed->'item_count','total_ml',confirmed->'total_ml'));
 return confirmed||jsonb_build_object('batch_id',batch);
end;$$;
revoke all on function public.inventory_station_confirm_preparation(text,jsonb,uuid) from public,anon;
grant execute on function public.inventory_station_confirm_preparation(text,jsonb,uuid) to authenticated;

-- O status comercial é derivado do fato físico e do batch; nunca editável.
create or replace function public.davi_excel_dataset()
returns table(id uuid,client_name text,sale_date date,shipping_deadline_display text,shipping_deadline_date date,shipped_at timestamptz,sale_type text,volume_ml numeric,perfume_name text,amount numeric,payment_status text,payment_method text,paid_at date,credit_reference_amount numeric,notes text,operational_status text,search_reference text)
language sql stable security definer set search_path=public as $$
 select s.id,c.name,s.sale_date,
 case when coalesce(ship.posted_at,s.shipped_at) is not null then 'ENVIADO' when s.payment_status='cancelled' then 'CANCELADO' when s.shipping_available_date is not null and s.shipping_availability_confirmed_at is null then to_char(s.shipping_available_date,'DD/MM/YYYY') else null end,
 s.shipping_available_date,coalesce(ship.posted_at,s.shipped_at),s.sale_type,s.volume_ml,p.full_name_raw,s.amount,s.payment_status::text,s.payment_method,s.paid_at,s.credit_reference_amount,s.notes,
 case when s.payment_status='cancelled' then 'CANCELADO' when coalesce(ship.posted_at,s.shipped_at) is not null then 'ENVIADO' when active_client.request_id is not null and own_request.request_id is null then 'PRÓXIMO ENVIO' when own_request.request_id is not null then 'ENVIO EM ANDAMENTO' when a.id is null then 'AGUARDANDO PERFUME' when in_progress.batch_id is not null then 'EM PREPARAÇÃO' when coalesce(prep.prepared_ml,0)<a.original_quantity_ml then 'AGUARDANDO PREPARAÇÃO' else 'PRONTO PARA ENVIO' end,
 coalesce(s.import_signature,'')
 from public.sales s join public.clients c on c.id=s.client_id and c.organization_id=s.organization_id left join public.perfumes p on p.id=s.perfume_id
 left join public.inventory_allocations a on a.sale_id=s.id and a.status in('reserved','shipping','shipped')
 left join lateral(select sum(bi.quantity_ml) prepared_ml from public.preparation_batch_items bi join public.preparation_batches b on b.id=bi.batch_id and b.status='confirmed' where bi.allocation_id=a.id) prep on true
 left join lateral(select b.id batch_id from public.preparation_batch_items bi join public.preparation_batches b on b.id=bi.batch_id where bi.allocation_id=a.id and b.status in('awaiting_scan','identified') limit 1) in_progress on true
 left join lateral(select sh.posted_at from public.shipment_items si join public.shipments sh on sh.id=si.shipment_id where si.sale_id=s.id and si.removed_at is null order by sh.created_at desc limit 1) ship on true
 left join lateral(select r.id request_id from public.customer_shipment_request_items ri join public.customer_shipment_requests r on r.id=ri.request_id left join public.shipments sh on sh.id=r.converted_shipment_id where ri.allocation_id=a.id and((r.status='requested' and r.converted_shipment_id is null)or(r.status='converted' and sh.status not in('posted','delivered','cancelled')))limit 1)own_request on true
 left join lateral(select r.id request_id from public.customer_shipment_requests r left join public.shipments sh on sh.id=r.converted_shipment_id where r.client_id=s.client_id and((r.status='requested' and r.converted_shipment_id is null)or(r.status='converted' and sh.status not in('posted','delivered','cancelled')))limit 1)active_client on true
 where s.organization_id in(select public.current_user_org_ids()) and public.has_org_permission(s.organization_id,'sales.view') and s.deleted_at is null;
$$;

commit;
