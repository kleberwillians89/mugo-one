begin;

-- Identidade operacional tenant-safe e imutável do perfume canônico.
create table public.perfume_operational_sequences(
  organization_id uuid primary key references public.organizations(id) on delete cascade,
  last_value integer not null default 0 check(last_value>=0)
);
alter table public.perfume_operational_sequences enable row level security;
revoke all on public.perfume_operational_sequences from public,anon,authenticated;

alter table public.perfumes add column if not exists operational_code text;
create unique index if not exists perfumes_org_operational_code_uidx on public.perfumes(organization_id,operational_code) where operational_code is not null;

with ranked as(
  select id,organization_id,row_number() over(partition by organization_id order by created_at,id)::integer seq
  from public.perfumes where operational_code is null
) update public.perfumes p set operational_code='RUAH-P'||lpad(r.seq::text,6,'0') from ranked r where p.id=r.id;
insert into public.perfume_operational_sequences(organization_id,last_value)
select organization_id,max(substring(operational_code from '([0-9]+)$')::integer) from public.perfumes group by organization_id
on conflict(organization_id) do update set last_value=greatest(public.perfume_operational_sequences.last_value,excluded.last_value);
alter table public.perfumes alter column operational_code set not null;

create or replace function public.perfume_operational_code_assign()
returns trigger language plpgsql security definer set search_path=public as $$
declare seq integer;
begin
  if tg_op='UPDATE' and new.operational_code is distinct from old.operational_code then raise exception 'operational_code_immutable'; end if;
  if tg_op='INSERT' and new.operational_code is not null then raise exception 'operational_code_generated_by_database'; end if;
  if tg_op='INSERT' and new.operational_code is null then
    insert into public.perfume_operational_sequences(organization_id,last_value) values(new.organization_id,1)
    on conflict(organization_id) do update set last_value=public.perfume_operational_sequences.last_value+1 returning last_value into seq;
    new.operational_code:='RUAH-P'||lpad(seq::text,6,'0');
  end if;
  return new;
end;$$;
drop trigger if exists perfume_operational_code_guard on public.perfumes;
create trigger perfume_operational_code_guard before insert or update of operational_code on public.perfumes for each row execute function public.perfume_operational_code_assign();

create or replace function public.resolve_perfume_operational_code(p_code text)
returns table(perfume_id uuid,perfume_name text,brand_house text,operational_code text)
language sql stable security definer set search_path=public as $$
  select p.id,p.full_name_raw,p.brand_house,p.operational_code from public.perfumes p
  where upper(p.operational_code)=upper(btrim(coalesce(p_code,'')))
    and p.organization_id in(select public.current_user_org_ids());
$$;
revoke all on function public.resolve_perfume_operational_code(text) from public,anon;
grant execute on function public.resolve_perfume_operational_code(text) to authenticated,service_role;

create table public.preparation_batches(
  id uuid primary key default gen_random_uuid(),organization_id uuid not null references public.organizations(id) on delete cascade,
  perfume_id uuid not null references public.perfumes(id),status text not null default 'draft' check(status in('draft','awaiting_scan','identified','confirmed','cancelled')),
  created_at timestamptz not null default now(),created_by uuid references public.profiles(id),identified_at timestamptz,identified_by uuid references public.profiles(id),
  confirmed_at timestamptz,confirmed_by uuid references public.profiles(id),cancelled_at timestamptz,cancelled_by uuid references public.profiles(id)
);
create table public.preparation_batch_items(
  id uuid primary key default gen_random_uuid(),batch_id uuid not null references public.preparation_batches(id) on delete cascade,
  allocation_id uuid not null references public.inventory_allocations(id),quantity_ml numeric(14,3) not null check(quantity_ml>0),
  source_bottle_id uuid references public.inventory_bottles(id),created_at timestamptz not null default now(),unique(batch_id,allocation_id)
);
create index preparation_batch_items_allocation_idx on public.preparation_batch_items(allocation_id);
create index preparation_batches_org_status_idx on public.preparation_batches(organization_id,status,created_at desc);
alter table public.inventory_allocations add column if not exists original_quantity_ml numeric(14,3);
update public.inventory_allocations set original_quantity_ml=quantity_ml where original_quantity_ml is null;
alter table public.inventory_allocations alter column original_quantity_ml set not null;
alter table public.preparation_batches enable row level security;alter table public.preparation_batch_items enable row level security;
create policy preparation_batches_select on public.preparation_batches for select using(organization_id in(select public.current_user_org_ids()));
create policy preparation_batch_items_select on public.preparation_batch_items for select using(batch_id in(select id from public.preparation_batches where organization_id in(select public.current_user_org_ids())));
revoke insert,update,delete on public.preparation_batches,public.preparation_batch_items from authenticated;

create or replace function public.preparation_candidates(p_perfume_id uuid)
returns table(allocation_id uuid,client_name text,quantity_ml numeric,prepared_ml numeric,remaining_ml numeric,bottle_tracking_status text)
language sql stable security definer set search_path=public as $$
  select a.id,c.name,a.quantity_ml,coalesce(sum(bi.quantity_ml) filter(where b.status='confirmed'),0),
    a.original_quantity_ml-coalesce(sum(bi.quantity_ml) filter(where b.status='confirmed'),0),i.bottle_tracking_status
  from public.inventory_allocations a join public.clients c on c.id=a.client_id join public.sales s on s.id=a.sale_id
  join public.inventory_items i on i.id=a.inventory_item_id
  left join public.preparation_batch_items bi on bi.allocation_id=a.id left join public.preparation_batches b on b.id=bi.batch_id
  where a.perfume_id=p_perfume_id and a.organization_id in(select public.current_user_org_ids()) and a.status='reserved' and s.deleted_at is null
  group by a.id,c.name,i.bottle_tracking_status having a.original_quantity_ml-coalesce(sum(bi.quantity_ml) filter(where b.status='confirmed'),0)>0 order by c.name;
$$;
revoke all on function public.preparation_candidates(uuid) from public,anon;
grant execute on function public.preparation_candidates(uuid) to authenticated;

create or replace function public.preparation_batch_create(p_perfume_id uuid,p_items jsonb)
returns uuid language plpgsql security definer set search_path=public as $$
declare org uuid; batch_id uuid; item jsonb; a public.inventory_allocations; requested numeric; already numeric; tracking text; bottle public.inventory_bottles;
begin
  select organization_id into org from public.perfumes where id=p_perfume_id and organization_id in(select public.current_user_org_ids());
  if org is null or not public.has_org_permission(org,'inventory.adjust') then raise exception 'forbidden'; end if;
  if jsonb_typeof(p_items)<>'array' or jsonb_array_length(p_items)=0 then raise exception 'preparation_items_required'; end if;
  insert into public.preparation_batches(organization_id,perfume_id,status,created_by) values(org,p_perfume_id,'awaiting_scan',auth.uid()) returning id into batch_id;
  for item in select * from jsonb_array_elements(p_items) loop
    select * into a from public.inventory_allocations where id=(item->>'allocation_id')::uuid for update;
    requested:=(item->>'quantity_ml')::numeric;
    if a.id is null or a.organization_id<>org or a.perfume_id<>p_perfume_id or a.status<>'reserved' then raise exception 'allocation_not_eligible'; end if;
    select coalesce(sum(bi.quantity_ml),0) into already from public.preparation_batch_items bi join public.preparation_batches b on b.id=bi.batch_id where bi.allocation_id=a.id and b.status='confirmed';
    if requested<=0 or already+requested>a.original_quantity_ml then raise exception 'preparation_quantity_exceeded'; end if;
    select bottle_tracking_status into tracking from public.inventory_items where id=a.inventory_item_id;
    if nullif(item->>'source_bottle_id','') is not null then select * into bottle from public.inventory_bottles where id=(item->>'source_bottle_id')::uuid and organization_id=org and perfume_id=p_perfume_id and status='active';if bottle.id is null then raise exception 'invalid_source_bottle';end if;
    elsif tracking='active' then raise exception 'source_bottle_required'; end if;
    insert into public.preparation_batch_items(batch_id,allocation_id,quantity_ml,source_bottle_id) values(batch_id,a.id,requested,nullif(item->>'source_bottle_id','')::uuid);
  end loop;
  insert into public.audit_logs(organization_id,actor_id,action,entity_type,entity_id,metadata) values(org,auth.uid(),'preparation_batch_created','preparation_batch',batch_id::text,jsonb_build_object('batch_id',batch_id,'perfume_id',p_perfume_id,'item_count',jsonb_array_length(p_items)));
  return batch_id;
end;$$;
revoke all on function public.preparation_batch_create(uuid,jsonb) from public,anon;
grant execute on function public.preparation_batch_create(uuid,jsonb) to authenticated;

create or replace function public.preparation_batch_identify(p_batch_id uuid,p_code text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare b public.preparation_batches;p public.perfumes;scanned public.perfumes;total numeric;items integer;
begin
 select * into b from public.preparation_batches where id=p_batch_id for update;if b.id is null or b.organization_id not in(select public.current_user_org_ids()) then raise exception 'batch_not_found';end if;
 if b.status='confirmed' then return jsonb_build_object('ok',true,'already_confirmed',true);end if;if b.status not in('awaiting_scan','identified') then raise exception 'batch_not_identifiable';end if;
 select * into p from public.perfumes where id=b.perfume_id;select * into scanned from public.perfumes where organization_id=b.organization_id and upper(operational_code)=upper(btrim(p_code));
 if scanned.id is null then return jsonb_build_object('ok',false,'reason','code_not_found','expected',p.full_name_raw);end if;
 if scanned.id<>b.perfume_id then return jsonb_build_object('ok',false,'reason','wrong_perfume','expected',p.full_name_raw,'scanned',scanned.full_name_raw);end if;
 update public.preparation_batches set status='identified',identified_at=coalesce(identified_at,now()),identified_by=coalesce(identified_by,auth.uid()) where id=b.id;
 select count(*),sum(quantity_ml) into items,total from public.preparation_batch_items where batch_id=b.id;
 insert into public.audit_logs(organization_id,actor_id,action,entity_type,entity_id,metadata) values(b.organization_id,auth.uid(),'preparation_batch_identified','preparation_batch',b.id::text,jsonb_build_object('batch_id',b.id,'perfume_id',b.perfume_id,'total_ml',total,'item_count',items));
 return jsonb_build_object('ok',true,'perfume',p.full_name_raw,'total_ml',total,'item_count',items);
end;$$;
revoke all on function public.preparation_batch_identify(uuid,text) from public,anon;
grant execute on function public.preparation_batch_identify(uuid,text) to authenticated;

create or replace function public.preparation_batch_confirm(p_batch_id uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare b public.preparation_batches;r record;already numeric;total numeric:=0;items integer:=0;
begin
 select * into b from public.preparation_batches where id=p_batch_id for update;if b.id is null or b.organization_id not in(select public.current_user_org_ids()) then raise exception 'batch_not_found';end if;
 if b.status='confirmed' then return jsonb_build_object('ok',true,'already_confirmed',true,'message','Este fracionamento já foi concluído.');end if;if b.status<>'identified' then raise exception 'scan_confirmation_required';end if;
 for r in select bi.*,a.original_quantity_ml allocation_ml,a.status allocation_status,a.perfume_id allocation_perfume from public.preparation_batch_items bi join public.inventory_allocations a on a.id=bi.allocation_id where bi.batch_id=b.id order by bi.id for update of a loop
   if r.allocation_status<>'reserved' or r.allocation_perfume<>b.perfume_id then raise exception 'allocation_not_eligible';end if;
   select coalesce(sum(bi.quantity_ml),0) into already from public.preparation_batch_items bi join public.preparation_batches pb on pb.id=bi.batch_id where bi.allocation_id=r.allocation_id and pb.status='confirmed';
   if already+r.quantity_ml>r.allocation_ml then raise exception 'preparation_quantity_exceeded';end if;total:=total+r.quantity_ml;items:=items+1;
 end loop;
 update public.preparation_batches set status='confirmed',confirmed_at=now(),confirmed_by=auth.uid() where id=b.id;
 insert into public.audit_logs(organization_id,actor_id,action,entity_type,entity_id,metadata) values(b.organization_id,auth.uid(),'preparation_batch_confirmed','preparation_batch',b.id::text,jsonb_build_object('batch_id',b.id,'perfume_id',b.perfume_id,'total_ml',total,'item_count',items));
 return jsonb_build_object('ok',true,'already_confirmed',false,'total_ml',total,'item_count',items);
end;$$;
revoke all on function public.preparation_batch_confirm(uuid) from public,anon;
grant execute on function public.preparation_batch_confirm(uuid) to authenticated;

create or replace function public.preparation_batch_cancel(p_batch_id uuid)
returns void language plpgsql security definer set search_path=public as $$ declare b public.preparation_batches;begin select * into b from public.preparation_batches where id=p_batch_id for update;if b.id is null or b.organization_id not in(select public.current_user_org_ids()) then raise exception 'batch_not_found';end if;if b.status='confirmed' then raise exception 'confirmed_batch_requires_audited_correction';end if;update public.preparation_batches set status='cancelled',cancelled_at=now(),cancelled_by=auth.uid() where id=b.id and status<>'cancelled';insert into public.audit_logs(organization_id,actor_id,action,entity_type,entity_id,metadata) values(b.organization_id,auth.uid(),'preparation_batch_cancelled','preparation_batch',b.id::text,jsonb_build_object('batch_id',b.id,'perfume_id',b.perfume_id));end;$$;
revoke all on function public.preparation_batch_cancel(uuid) from public,anon;
grant execute on function public.preparation_batch_cancel(uuid) to authenticated;

-- Portal: disponibilidade é limitada ao total fisicamente preparado e ainda não solicitado.
drop function public.customer_custody();
create function public.customer_custody() returns table(allocation_id uuid,perfume_id uuid,perfume_name text,quantity_ml numeric,sale_date date,allocation_status text,requested boolean,request_id uuid,shipping_availability_text text,shipping_availability_kind text,shipping_available_date date,shipping_lead_business_days integer,shipping_availability_confirmed_at timestamptz,shipping_requestable boolean,requestable_quantity_ml numeric,prepared_quantity_ml numeric)
language sql stable security definer set search_path=public as $$
 select a.id,a.perfume_id,p.full_name_raw,a.quantity_ml,s.sale_date,a.status::text,(req.request_id is not null),req.request_id,s.shipping_availability_text,s.shipping_availability_kind,s.shipping_available_date,s.shipping_lead_business_days,s.shipping_availability_confirmed_at,
   greatest(least(a.quantity_ml,coalesce(prep.prepared_ml,0)-coalesce(req.requested_ml,0)),0)>0
     and (s.shipping_availability_kind is null or s.shipping_availability_kind='available_now' or s.shipping_availability_confirmed_at is not null),
   greatest(least(a.quantity_ml,coalesce(prep.prepared_ml,0)-coalesce(req.requested_ml,0)),0),coalesce(prep.prepared_ml,0)
 from public.inventory_allocations a join public.perfumes p on p.id=a.perfume_id join public.sales s on s.id=a.sale_id
 left join lateral(select sum(bi.quantity_ml) prepared_ml from public.preparation_batch_items bi join public.preparation_batches b on b.id=bi.batch_id where bi.allocation_id=a.id and b.status='confirmed') prep on true
 left join lateral(select sum(ri.quantity_ml) filter(where r.status<>'cancelled') requested_ml,min(r.id) filter(where r.status='requested' or sh.status not in('posted','delivered','cancelled')) request_id from public.customer_shipment_request_items ri join public.customer_shipment_requests r on r.id=ri.request_id left join public.shipments sh on sh.id=r.converted_shipment_id where ri.allocation_id=a.id) req on true
 where a.client_id=public.current_customer_client() and a.status in('reserved','shipping') order by p.full_name_raw,s.sale_date;
$$;
revoke all on function public.customer_custody() from public,anon;grant execute on function public.customer_custody() to authenticated;

create or replace function public.customer_shipment_request_create_prepared(p_items jsonb,p_address jsonb,p_notes text default null)
returns public.customer_shipment_requests language plpgsql security definer set search_path=public as $$
declare client uuid;org uuid;item jsonb;a public.inventory_allocations;qty numeric;prepared numeric;requested numeric;availability_ready boolean;request public.customer_shipment_requests;
begin
 client:=public.current_customer_client();if client is null then raise exception 'forbidden';end if;if jsonb_typeof(p_items)<>'array' or jsonb_array_length(p_items)=0 then raise exception 'no_items_selected';end if;
 select organization_id into org from public.clients where id=client;
 if coalesce(btrim(p_address->>'postal_code'),'')='' or coalesce(btrim(p_address->>'address_line'),'')='' or coalesce(btrim(p_address->>'city'),'')='' or coalesce(btrim(p_address->>'state'),'')='' then raise exception 'incomplete_address';end if;
 for item in select * from jsonb_array_elements(p_items) loop
  select * into a from public.inventory_allocations where id=(item->>'allocation_id')::uuid and client_id=client and status='reserved' for update;qty:=(item->>'quantity_ml')::numeric;if a.id is null or qty<=0 then raise exception 'invalid_or_unavailable_custody';end if;
  select coalesce(sum(bi.quantity_ml),0) into prepared from public.preparation_batch_items bi join public.preparation_batches b on b.id=bi.batch_id where bi.allocation_id=a.id and b.status='confirmed';
  select coalesce(sum(ri.quantity_ml),0) into requested from public.customer_shipment_request_items ri join public.customer_shipment_requests r on r.id=ri.request_id where ri.allocation_id=a.id and r.status<>'cancelled';
  select s.shipping_availability_kind is null or s.shipping_availability_kind='available_now' or s.shipping_availability_confirmed_at is not null into availability_ready from public.sales s where s.id=a.sale_id;
  if not coalesce(availability_ready,false) then raise exception 'shipping_availability_pending';end if;
  if qty>least(a.quantity_ml,prepared-requested) then raise exception 'shipping_availability_pending';end if;
 end loop;
 insert into public.customer_shipment_requests(organization_id,client_id,address_snapshot,notes,created_by_auth_user_id) values(org,client,p_address,nullif(btrim(p_notes),''),auth.uid()) returning * into request;
 insert into public.customer_shipment_request_items(request_id,allocation_id,perfume_id,quantity_ml) select request.id,a.id,a.perfume_id,(item->>'quantity_ml')::numeric from jsonb_array_elements(p_items) item join public.inventory_allocations a on a.id=(item->>'allocation_id')::uuid;
 return request;
end;$$;
revoke all on function public.customer_shipment_request_create_prepared(jsonb,jsonb,text) from public,anon;grant execute on function public.customer_shipment_request_create_prepared(jsonb,jsonb,text) to authenticated;

create or replace function public.create_draft_shipment_from_customer_request(p_request_id uuid)
returns uuid language plpgsql security definer set search_path=public as $$
declare req public.customer_shipment_requests;client public.clients;shipment uuid;cfg public.organization_shipping_settings;addr jsonb;source_count integer;
begin
 select * into req from public.customer_shipment_requests where id=p_request_id for update;if req.id is null or not public.has_org_role(req.organization_id,array['admin','manager','operator']::public.member_role[]) then raise exception 'forbidden';end if;if req.status<>'requested' then raise exception 'request_not_pending';end if;
 perform a.id from public.customer_shipment_request_items ri join public.inventory_allocations a on a.id=ri.allocation_id where ri.request_id=req.id and a.organization_id=req.organization_id and a.client_id=req.client_id and a.status='reserved' for update of a;
 select * into client from public.clients where id=req.client_id and deleted_at is null;select * into cfg from public.organization_shipping_settings where organization_id=req.organization_id;addr:=req.address_snapshot;
 insert into public.shipments(organization_id,client_id,status,recipient_name,recipient_phone,recipient_document,recipient_email,recipient_postal_code,recipient_address,recipient_number,recipient_complement,recipient_district,recipient_city,recipient_state,package_weight,package_height,package_width,package_length,package_format,declared_value,notes,created_by)
 select req.organization_id,req.client_id,'draft',coalesce(addr->>'name',client.name),coalesce(addr->>'phone',client.phone,client.whatsapp_phone),coalesce(client.cpf,client.cnpj),client.email,addr->>'postal_code',addr->>'address_line',addr->>'address_number',addr->>'complement',addr->>'district',addr->>'city',addr->>'state',cfg.default_weight,cfg.default_height,cfg.default_width,cfg.default_length,coalesce(cfg.default_format,'box'),coalesce(sum(s.amount),0),req.notes,auth.uid() from public.customer_shipment_request_items ri join public.inventory_allocations a on a.id=ri.allocation_id join public.sales s on s.id=a.sale_id where ri.request_id=req.id returning id into shipment;
 for source_count in select count(distinct bi.source_bottle_id) from public.customer_shipment_request_items ri join public.preparation_batch_items bi on bi.allocation_id=ri.allocation_id join public.preparation_batches b on b.id=bi.batch_id and b.status='confirmed' where ri.request_id=req.id group by ri.allocation_id having count(distinct bi.source_bottle_id)>1 loop raise exception 'preparation_source_ambiguous';end loop;
 insert into public.shipment_items(organization_id,shipment_id,allocation_id,sale_id,quantity_ml,bottle_id) select req.organization_id,shipment,a.id,a.sale_id,ri.quantity_ml,(select min(bi.source_bottle_id) from public.preparation_batch_items bi join public.preparation_batches b on b.id=bi.batch_id where bi.allocation_id=a.id and b.status='confirmed') from public.customer_shipment_request_items ri join public.inventory_allocations a on a.id=ri.allocation_id where ri.request_id=req.id;
 update public.inventory_allocations a set status='shipping',shipment_id=shipment,updated_at=now() where id in(select allocation_id from public.customer_shipment_request_items where request_id=req.id);
 insert into public.shipment_events(organization_id,shipment_id,event_type,to_status,actor_id) values(req.organization_id,shipment,'shipment_created','draft',auth.uid());update public.customer_shipment_requests set status='converted',converted_shipment_id=shipment,updated_at=now() where id=req.id;return shipment;
end;$$;

-- Única baixa física final; usa a quantidade efetivamente solicitada.
create or replace function public.post_shipment(p_shipment_id uuid)
returns void language plpgsql security definer set search_path=public as $$
declare sh public.shipments;r record;source_ml numeric;tracking text;
begin
 select * into sh from public.shipments where id=p_shipment_id for update;if sh.id is null or not public.has_org_permission(sh.organization_id,'shipping.post') then raise exception 'forbidden';end if;if sh.status in('posted','delivered') then return;end if;if sh.status not in('label_released','customer_approved') then raise exception 'shipment_not_ready_to_post';end if;
 for r in select a.*,si.quantity_ml shipped_ml,si.bottle_id,si.split_unit_id from public.inventory_allocations a join public.shipment_items si on si.allocation_id=a.id and si.shipment_id=sh.id and si.removed_at is null where a.shipment_id=sh.id and a.status='shipping' for update of a loop
  if r.stock_managed then select bottle_tracking_status into tracking from public.inventory_items where id=r.inventory_item_id for update;if tracking='active' and r.bottle_id is null and r.split_unit_id is null then raise exception 'physical_source_not_confirmed';end if;update public.inventory_items set physical_ml=physical_ml-r.shipped_ml,updated_at=now() where id=r.inventory_item_id and physical_ml>=r.shipped_ml;if not found then raise exception 'insufficient_physical_inventory';end if;
   if r.bottle_id is not null then select physical_ml into source_ml from public.inventory_bottles where id=r.bottle_id for update;if source_ml<r.shipped_ml then raise exception 'insufficient_bottle_inventory';end if;update public.inventory_bottles set physical_ml=physical_ml-r.shipped_ml,status=case when physical_ml-r.shipped_ml=0 then 'empty' else status end,updated_at=now() where id=r.bottle_id;
   elsif r.split_unit_id is not null then update public.inventory_split_units set status='consumed',consumed_at=now() where id=r.split_unit_id and status='available' and quantity_ml=r.shipped_ml;if not found then raise exception 'split_unit_unavailable';end if;end if;
  end if;
  if r.shipped_ml<r.quantity_ml then update public.inventory_allocations set quantity_ml=quantity_ml-r.shipped_ml,status='reserved',shipment_id=null,updated_at=now() where id=r.id;else update public.inventory_allocations set status='shipped',shipped_at=now(),updated_at=now() where id=r.id;end if;
 end loop;
 update public.shipments set status='posted',posted_at=now(),updated_at=now() where id=sh.id;insert into public.shipment_events(organization_id,shipment_id,event_type,from_status,to_status,actor_id) values(sh.organization_id,sh.id,'shipment_posted',sh.status,'posted',auth.uid());
end;$$;

revoke all on function public.create_draft_shipment_from_customer_request(uuid) from public,anon;
grant execute on function public.create_draft_shipment_from_customer_request(uuid) to authenticated,service_role;
revoke all on function public.post_shipment(uuid) from public,anon;
grant execute on function public.post_shipment(uuid) to authenticated,service_role;

commit;
