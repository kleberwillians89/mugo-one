-- Fase 2: fundacao SuperFrete. Migration aditiva, sem chamadas externas.

create table public.organization_shipping_settings (
  organization_id uuid primary key references public.organizations(id) on delete cascade,
  id uuid not null default gen_random_uuid() unique,
  sender_name text, sender_document text, sender_email text, sender_phone text,
  sender_postal_code text, sender_address text, sender_number text, sender_complement text,
  sender_district text, sender_city text, sender_state text,
  default_weight numeric(10,3) check(default_weight is null or default_weight>0),
  default_height numeric(10,2) check(default_height is null or default_height>0),
  default_width numeric(10,2) check(default_width is null or default_width>0),
  default_length numeric(10,2) check(default_length is null or default_length>0),
  default_format text not null default 'box',
  calculator_services text not null default '1,2,17,3,31',
  updated_by uuid references public.profiles(id),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);

create table public.shipment_quotes (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  shipment_id uuid not null references public.shipments(id) on delete cascade,
  provider text not null default 'superfrete' check(provider='superfrete'),
  service_id text not null, service_name text not null, carrier text,
  price numeric(14,2) not null check(price>=0), currency text not null default 'BRL',
  delivery_days integer, delivery_min integer, delivery_max integer,
  package jsonb not null default '{}', available boolean not null default true,
  safe_error text, quoted_at timestamptz not null default now(), expires_at timestamptz
);
create index shipment_quotes_shipment_idx on public.shipment_quotes(shipment_id,quoted_at desc);

create table public.integration_runs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  provider text not null, operation text not null, entity_type text not null, entity_id uuid not null,
  idempotency_key text not null, external_id text, status text not null,
  attempts integer not null default 1 check(attempts>0),
  started_at timestamptz not null default now(), completed_at timestamptz,
  error_code text, safe_error_message text, metadata jsonb not null default '{}',
  created_by uuid references public.profiles(id),
  unique(provider,operation,idempotency_key)
);
create index integration_runs_entity_idx on public.integration_runs(organization_id,provider,entity_type,entity_id,started_at desc);

alter table public.shipments
  add column selected_quote_id uuid references public.shipment_quotes(id),
  add column declared_value numeric(14,2) check(declared_value is null or declared_value>=0),
  add column fiscal_mode text not null default 'declaration' check(fiscal_mode in('declaration','invoice')),
  add column invoice_number text,
  add column invoice_key text,
  add column invoice_id text,
  add column superfrete_protocol text,
  add column checkout_status text,
  add column checkout_started_at timestamptz,
  add column checkout_completed_at timestamptz,
  add column delivery_days integer,
  add column delivery_min integer,
  add column delivery_max integer,
  add column print_url text,
  add column superfrete_updated_at timestamptz,
  add column integration_error text;

alter table public.organization_shipping_settings enable row level security;
alter table public.shipment_quotes enable row level security;
alter table public.integration_runs enable row level security;

create policy shipping_settings_select on public.organization_shipping_settings for select
  using(organization_id in(select public.current_user_org_ids()));
create policy shipping_settings_write on public.organization_shipping_settings for all
  using(public.has_org_role(organization_id,array['admin','manager']::public.member_role[]))
  with check(public.has_org_role(organization_id,array['admin','manager']::public.member_role[]));
create policy shipment_quotes_select on public.shipment_quotes for select
  using(organization_id in(select public.current_user_org_ids()));
create policy integration_runs_select on public.integration_runs for select
  using(public.has_org_role(organization_id,array['admin','manager']::public.member_role[]));

grant select,insert,update on public.organization_shipping_settings to authenticated;
grant select on public.shipment_quotes to authenticated;
grant select on public.integration_runs to authenticated;
revoke insert,update,delete on public.shipment_quotes from authenticated;
revoke insert,update,delete on public.integration_runs from authenticated;

create or replace function public.save_superfrete_quotes(p_shipment_id uuid,p_quotes jsonb)
returns setof public.shipment_quotes language plpgsql security definer set search_path=public as $$
declare v public.shipments; item jsonb;
begin
  select * into v from public.shipments where id=p_shipment_id for update;
  if v.id is null or not public.has_org_role(v.organization_id,array['admin','manager','operator']::public.member_role[]) then raise exception 'forbidden'; end if;
  if v.status not in('draft','requested') or v.selected_quote_id is not null then raise exception 'shipment_not_quotable'; end if;
  delete from public.shipment_quotes where shipment_id=v.id;
  for item in select * from jsonb_array_elements(p_quotes) loop
    insert into public.shipment_quotes(organization_id,shipment_id,service_id,service_name,carrier,price,currency,
      delivery_days,delivery_min,delivery_max,package,available,safe_error)
    values(v.organization_id,v.id,item->>'service_id',item->>'service_name',item->>'carrier',
      coalesce(nullif(item->>'price','')::numeric,0),coalesce(item->>'currency','BRL'),
      nullif(item->>'delivery_days','')::integer,nullif(item->>'delivery_min','')::integer,
      nullif(item->>'delivery_max','')::integer,coalesce(item->'package','{}'),
      coalesce((item->>'available')::boolean,true),item->>'safe_error');
  end loop;
  update public.shipments set integration_error=null,updated_at=now() where id=v.id;
  return query select * from public.shipment_quotes where shipment_id=v.id order by available desc,price;
end;$$;

create or replace function public.update_shipment_shipping_data(p_shipment_id uuid,p_data jsonb)
returns public.shipments language plpgsql security definer set search_path=public as $$
declare v public.shipments;
begin
  select * into v from public.shipments where id=p_shipment_id for update;
  if v.id is null or not public.has_org_role(v.organization_id,array['admin','manager','operator']::public.member_role[]) then raise exception 'forbidden'; end if;
  if v.status not in('draft','requested') or v.selected_quote_id is not null then raise exception 'shipment_shipping_data_locked'; end if;
  update public.shipments set
    recipient_name=coalesce(nullif(btrim(p_data->>'recipient_name'),''),recipient_name),
    recipient_phone=nullif(btrim(p_data->>'recipient_phone'),''), recipient_document=nullif(btrim(p_data->>'recipient_document'),''),
    recipient_email=nullif(btrim(p_data->>'recipient_email'),''), recipient_postal_code=public.only_digits(p_data->>'recipient_postal_code'),
    recipient_address=nullif(btrim(p_data->>'recipient_address'),''), recipient_number=nullif(btrim(p_data->>'recipient_number'),''),
    recipient_complement=nullif(btrim(p_data->>'recipient_complement'),''), recipient_district=nullif(btrim(p_data->>'recipient_district'),''),
    recipient_city=nullif(btrim(p_data->>'recipient_city'),''), recipient_state=nullif(upper(btrim(p_data->>'recipient_state')),''),
    package_weight=nullif(p_data->>'package_weight','')::numeric, package_height=nullif(p_data->>'package_height','')::numeric,
    package_width=nullif(p_data->>'package_width','')::numeric, package_length=nullif(p_data->>'package_length','')::numeric,
    package_format=coalesce(nullif(p_data->>'package_format',''),package_format,'box'),
    declared_value=coalesce(nullif(p_data->>'declared_value','')::numeric,declared_value),
    fiscal_mode=coalesce(nullif(p_data->>'fiscal_mode',''),fiscal_mode), notes=coalesce(p_data->>'notes',notes), updated_at=now()
  where id=v.id returning * into v;
  if v.package_weight is not null and v.package_weight<=0 or v.package_height is not null and v.package_height<=0
     or v.package_width is not null and v.package_width<=0 or v.package_length is not null and v.package_length<=0 then
    raise exception 'invalid_package_dimensions';
  end if;
  return v;
end;$$;

create or replace function public.refresh_shipment_recipient(p_shipment_id uuid)
returns public.shipments language plpgsql security definer set search_path=public as $$
declare v public.shipments; c public.clients;
begin
  select * into v from public.shipments where id=p_shipment_id for update;
  if v.id is null or not public.has_org_role(v.organization_id,array['admin','manager','operator']::public.member_role[]) then raise exception 'forbidden'; end if;
  if v.status not in('draft','requested') or v.selected_quote_id is not null then raise exception 'shipment_recipient_locked'; end if;
  select * into c from public.clients where id=v.client_id and organization_id=v.organization_id and deleted_at is null;
  if c.id is null then raise exception 'client_not_found'; end if;
  update public.shipments set recipient_name=c.name,recipient_phone=coalesce(c.phone,c.whatsapp_phone),recipient_document=coalesce(c.cpf,c.cnpj),
    recipient_email=c.email,recipient_postal_code=c.postal_code,recipient_address=c.address_line,recipient_number=c.address_number,
    recipient_complement=c.complement,recipient_district=c.district,recipient_city=c.city,recipient_state=c.state,updated_at=now()
    where id=v.id returning * into v;
  return v;
end;$$;

create or replace function public.select_shipment_quote(p_shipment_id uuid,p_quote_id uuid)
returns public.shipments language plpgsql security definer set search_path=public as $$
declare v public.shipments; q public.shipment_quotes; previous_status public.shipment_status;
begin
  select * into v from public.shipments where id=p_shipment_id for update;
  if v.id is null or not public.has_org_role(v.organization_id,array['admin','manager','operator']::public.member_role[]) then raise exception 'forbidden'; end if;
  if v.status not in('draft','requested') then raise exception 'shipment_quote_locked'; end if;
  select * into q from public.shipment_quotes where id=p_quote_id and shipment_id=v.id and organization_id=v.organization_id and available;
  if q.id is null then raise exception 'quote_not_available'; end if;
  previous_status:=v.status;
  update public.shipments set selected_quote_id=q.id,carrier=q.carrier,service=q.service_name,service_id=q.service_id,
    shipping_price=q.price,delivery_days=q.delivery_days,delivery_min=q.delivery_min,delivery_max=q.delivery_max,
    status='awaiting_customer_approval',updated_at=now() where id=v.id returning * into v;
  insert into public.shipment_events(organization_id,shipment_id,event_type,from_status,to_status,metadata,actor_id)
    values(v.organization_id,v.id,'quote_selected',previous_status,'awaiting_customer_approval',
      jsonb_build_object('quote_id',q.id,'service_id',q.service_id,'price',q.price),auth.uid());
  return v;
end;$$;

create or replace function public.approve_shipment_for_label(p_shipment_id uuid)
returns public.shipments language plpgsql security definer set search_path=public as $$
declare v public.shipments;
begin
  select * into v from public.shipments where id=p_shipment_id for update;
  if v.id is null or not public.has_org_role(v.organization_id,array['admin','manager']::public.member_role[]) then raise exception 'forbidden'; end if;
  if v.status<>'awaiting_customer_approval' or v.selected_quote_id is null then raise exception 'shipment_not_awaiting_approval'; end if;
  update public.shipments set status='customer_approved',customer_approved_at=now(),approved_by=auth.uid(),updated_at=now()
    where id=v.id returning * into v;
  insert into public.shipment_events(organization_id,shipment_id,event_type,from_status,to_status,actor_id)
    values(v.organization_id,v.id,'customer_approved','awaiting_customer_approval','customer_approved',auth.uid());
  return v;
end;$$;

create or replace function public.claim_superfrete_cart(p_shipment_id uuid,p_idempotency_key text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v public.shipments; run public.integration_runs; missing text[]:='{}';
begin
  select * into v from public.shipments where id=p_shipment_id for update;
  if v.id is null or not public.has_org_role(v.organization_id,array['admin','manager']::public.member_role[]) then raise exception 'forbidden'; end if;
  if v.superfrete_order_id is not null then return jsonb_build_object('claimed',false,'reason','order_exists','order_id',v.superfrete_order_id,'checkout_status',v.checkout_status); end if;
  if v.status<>'customer_approved' then raise exception 'shipment_not_customer_approved'; end if;
  if coalesce(btrim(v.recipient_name),'')='' then missing:=array_append(missing,'recipient_name'); end if;
  if coalesce(btrim(v.recipient_document),'')='' then missing:=array_append(missing,'recipient_document'); end if;
  if coalesce(btrim(v.recipient_phone),'')='' then missing:=array_append(missing,'recipient_phone'); end if;
  if coalesce(btrim(v.recipient_email),'')='' then missing:=array_append(missing,'recipient_email'); end if;
  if length(coalesce(public.only_digits(v.recipient_postal_code),''))<>8 then missing:=array_append(missing,'recipient_postal_code'); end if;
  if coalesce(btrim(v.recipient_address),'')='' then missing:=array_append(missing,'recipient_address'); end if;
  if coalesce(btrim(v.recipient_number),'')='' then missing:=array_append(missing,'recipient_number'); end if;
  if coalesce(btrim(v.recipient_district),'')='' then missing:=array_append(missing,'recipient_district'); end if;
  if coalesce(btrim(v.recipient_city),'')='' then missing:=array_append(missing,'recipient_city'); end if;
  if length(coalesce(btrim(v.recipient_state),''))<>2 then missing:=array_append(missing,'recipient_state'); end if;
  if v.package_weight is null or v.package_height is null or v.package_width is null or v.package_length is null then missing:=array_append(missing,'package'); end if;
  if v.service_id is null or v.selected_quote_id is null then missing:=array_append(missing,'service'); end if;
  if cardinality(missing)>0 then return jsonb_build_object('claimed',false,'reason','incomplete_shipping_data','missing',missing); end if;
  select * into run from public.integration_runs where provider='superfrete' and operation='create_cart' and idempotency_key=p_idempotency_key;
  if run.id is not null and run.status='failed' then
    update public.integration_runs set status='started',attempts=attempts+1,started_at=now(),completed_at=null,error_code=null,safe_error_message=null where id=run.id;
    update public.shipments set status='label_pending',checkout_status='cart_started',integration_error=null,updated_at=now() where id=v.id;
    return jsonb_build_object('claimed',true,'run_id',run.id);
  end if;
  if run.id is not null then return jsonb_build_object('claimed',false,'reason',run.status,'run_id',run.id); end if;
  insert into public.integration_runs(organization_id,provider,operation,entity_type,entity_id,idempotency_key,status,created_by)
    values(v.organization_id,'superfrete','create_cart','shipment',v.id,p_idempotency_key,'started',auth.uid()) returning * into run;
  update public.shipments set status='label_pending',checkout_status='cart_started',integration_error=null,updated_at=now() where id=v.id;
  return jsonb_build_object('claimed',true,'run_id',run.id);
end;$$;

create or replace function public.complete_superfrete_cart(p_shipment_id uuid,p_run_id uuid,p_order_id text,p_protocol text,p_price numeric)
returns public.shipments language plpgsql security definer set search_path=public as $$
declare v public.shipments;
begin
  select * into v from public.shipments where id=p_shipment_id for update;
  if v.id is null or not public.has_org_role(v.organization_id,array['admin','manager']::public.member_role[]) then raise exception 'forbidden'; end if;
  if coalesce(btrim(p_order_id),'')='' then raise exception 'external_order_required'; end if;
  if v.superfrete_order_id is not null and v.superfrete_order_id<>p_order_id then raise exception 'shipment_already_has_other_order'; end if;
  update public.shipments set superfrete_order_id=p_order_id,superfrete_protocol=nullif(p_protocol,''),
    shipping_price=coalesce(p_price,shipping_price),superfrete_status='pending',checkout_status='cart_created',updated_at=now()
    where id=v.id returning * into v;
  update public.integration_runs set external_id=p_order_id,status='succeeded',completed_at=now() where id=p_run_id and entity_id=v.id;
  return v;
end;$$;

create or replace function public.claim_superfrete_checkout(p_shipment_id uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v public.shipments; run public.integration_runs;
begin
  select * into v from public.shipments where id=p_shipment_id for update;
  if v.id is null or not public.has_org_role(v.organization_id,array['admin','manager']::public.member_role[]) then raise exception 'forbidden'; end if;
  if v.checkout_status in('released','checkout_succeeded') then return jsonb_build_object('claimed',false,'reason','already_released'); end if;
  if v.checkout_status in('checkout_started','checkout_uncertain','cart_uncertain') then return jsonb_build_object('claimed',false,'reason',v.checkout_status); end if;
  if v.superfrete_order_id is null or v.checkout_status<>'cart_created' then raise exception 'cart_not_ready'; end if;
  select * into run from public.integration_runs where provider='superfrete' and operation='checkout' and idempotency_key=v.id::text||':checkout:v1';
  if run.id is not null and run.status='failed' then
    update public.integration_runs set status='started',attempts=attempts+1,started_at=now(),completed_at=null,error_code=null,safe_error_message=null where id=run.id;
  elsif run.id is not null then
    return jsonb_build_object('claimed',false,'reason',run.status,'run_id',run.id);
  else
    insert into public.integration_runs(organization_id,provider,operation,entity_type,entity_id,idempotency_key,external_id,status,created_by)
      values(v.organization_id,'superfrete','checkout','shipment',v.id,v.id::text||':checkout:v1',v.superfrete_order_id,'started',auth.uid()) returning * into run;
  end if;
  update public.shipments set checkout_status='checkout_started',checkout_started_at=now(),integration_error=null,updated_at=now() where id=v.id;
  return jsonb_build_object('claimed',true,'run_id',run.id,'order_id',v.superfrete_order_id);
end;$$;

create or replace function public.mark_superfrete_operation(p_shipment_id uuid,p_run_id uuid,p_stage text,p_outcome text,p_code text,p_safe_message text)
returns public.shipments language plpgsql security definer set search_path=public as $$
declare v public.shipments; uncertain boolean:=p_outcome='uncertain';
begin
  select * into v from public.shipments where id=p_shipment_id for update;
  if v.id is null or not public.has_org_role(v.organization_id,array['admin','manager']::public.member_role[]) then raise exception 'forbidden'; end if;
  if p_outcome not in('failed','uncertain') or p_stage not in('cart','checkout') then raise exception 'invalid_operation_outcome'; end if;
  update public.integration_runs set status=p_outcome,error_code=left(p_code,80),safe_error_message=left(p_safe_message,500),completed_at=now()
    where id=p_run_id and entity_id=v.id;
  update public.shipments set
    status=case when not uncertain and p_stage='cart' then 'customer_approved'::public.shipment_status else status end,
    checkout_status=case when uncertain then p_stage||'_uncertain' when p_stage='cart' then 'cart_failed' else 'cart_created' end,
    integration_error=left(p_safe_message,500),updated_at=now() where id=v.id returning * into v;
  return v;
end;$$;

create or replace function public.apply_superfrete_state(p_shipment_id uuid,p_run_id uuid,p_state jsonb)
returns public.shipments language plpgsql security definer set search_path=public as $$
declare v public.shipments; external_status text; internal_status public.shipment_status;
begin
  select * into v from public.shipments where id=p_shipment_id for update;
  if v.id is null or not public.has_org_role(v.organization_id,array['admin','manager']::public.member_role[]) then raise exception 'forbidden'; end if;
  external_status:=lower(coalesce(p_state->>'status',v.superfrete_status,''));
  internal_status:=case external_status when 'released' then 'label_released' when 'posted' then 'posted'
    when 'delivered' then 'delivered' when 'cancelled' then 'cancelled' when 'canceled' then 'cancelled' else v.status end;
  if internal_status in('posted','delivered') and v.status not in('posted','delivered') then
    if v.status not in('label_released','customer_approved') then update public.shipments set status='label_released',updated_at=now() where id=v.id; end if;
    perform public.post_shipment(v.id); select * into v from public.shipments where id=v.id;
  end if;
  if internal_status='cancelled' and v.status not in('posted','delivered','cancelled') then
    update public.inventory_allocations set status='reserved',shipment_id=null,updated_at=now()
      where shipment_id=v.id and status='shipping';
    update public.shipment_items set removed_at=coalesce(removed_at,now()) where shipment_id=v.id and removed_at is null;
  end if;
  update public.shipments set status=case when internal_status='posted' then status else internal_status end,
    superfrete_status=nullif(external_status,''),tracking_code=coalesce(p_state->>'tracking',tracking_code),
    print_url=coalesce(p_state->'print'->>'url',p_state->>'print_url',print_url),
    label_pdf_url=coalesce(p_state->'print'->>'url',p_state->>'print_url',label_pdf_url),
    shipping_price=coalesce(nullif(p_state->>'price','')::numeric,shipping_price),
    delivery_days=coalesce(nullif(p_state->>'delivery','')::integer,delivery_days),
    delivery_min=coalesce(nullif(p_state->>'delivery_min','')::integer,delivery_min),
    delivery_max=coalesce(nullif(p_state->>'delivery_max','')::integer,delivery_max),
    label_generated_at=coalesce(nullif(p_state->>'generated_at','')::timestamptz,label_generated_at),
    posted_at=coalesce(nullif(p_state->>'posted_at','')::timestamptz,posted_at),
    delivered_at=coalesce(nullif(p_state->>'delivered_at','')::timestamptz,delivered_at),
    cancelled_at=coalesce(nullif(p_state->>'canceled_at','')::timestamptz,nullif(p_state->>'cancelled_at','')::timestamptz,cancelled_at),
    checkout_status=case when external_status='released' then 'released' else checkout_status end,
    checkout_completed_at=case when external_status='released' then coalesce(checkout_completed_at,now()) else checkout_completed_at end,
    superfrete_updated_at=now(),integration_error=null,updated_at=now() where id=v.id returning * into v;
  if p_run_id is not null then update public.integration_runs set status='succeeded',completed_at=now() where id=p_run_id and entity_id=v.id; end if;
  return v;
end;$$;

-- Novos Shipments recebem pacote padrão; o endereço continua sendo snapshot do cliente.
create or replace function public.create_draft_shipment(p_client_id uuid,p_allocation_ids uuid[],p_notes text default null)
returns uuid language plpgsql security definer set search_path=public as $$
declare v_client public.clients; v_org uuid; v_id uuid; v_count integer; cfg public.organization_shipping_settings;
begin
  select * into v_client from public.clients where id=p_client_id and deleted_at is null;
  v_org:=v_client.organization_id;
  if v_org is null or not public.has_org_role(v_org,array['admin','manager','operator']::public.member_role[]) then raise exception 'forbidden'; end if;
  perform id from public.inventory_allocations where id=any(p_allocation_ids) and organization_id=v_org and client_id=p_client_id and status='reserved' for update;
  select count(*) into v_count from public.inventory_allocations where id=any(p_allocation_ids) and organization_id=v_org and client_id=p_client_id and status='reserved';
  if v_count<>cardinality(p_allocation_ids) or v_count=0 then raise exception 'invalid_or_unavailable_allocations'; end if;
  select * into cfg from public.organization_shipping_settings where organization_id=v_org;
  insert into public.shipments(organization_id,client_id,status,recipient_name,recipient_phone,recipient_document,recipient_email,
    recipient_postal_code,recipient_address,recipient_number,recipient_complement,recipient_district,recipient_city,recipient_state,
    package_weight,package_height,package_width,package_length,package_format,declared_value,notes,created_by)
  select v_org,p_client_id,'draft',v_client.name,coalesce(v_client.phone,v_client.whatsapp_phone),coalesce(v_client.cpf,v_client.cnpj),
    v_client.email,v_client.postal_code,v_client.address_line,v_client.address_number,v_client.complement,v_client.district,v_client.city,v_client.state,
    cfg.default_weight,cfg.default_height,cfg.default_width,cfg.default_length,coalesce(cfg.default_format,'box'),
    coalesce(sum(s.amount),0),p_notes,auth.uid()
    from public.inventory_allocations a join public.sales s on s.id=a.sale_id where a.id=any(p_allocation_ids)
    returning id into v_id;
  insert into public.shipment_items(organization_id,shipment_id,allocation_id,sale_id,quantity_ml)
    select v_org,v_id,a.id,a.sale_id,a.quantity_ml from public.inventory_allocations a where a.id=any(p_allocation_ids);
  update public.inventory_allocations set status='shipping',shipment_id=v_id,updated_at=now() where id=any(p_allocation_ids);
  insert into public.shipment_events(organization_id,shipment_id,event_type,to_status,actor_id) values(v_org,v_id,'shipment_created','draft',auth.uid());
  return v_id;
end;$$;

create trigger audit_shipping_settings after insert or update or delete on public.organization_shipping_settings for each row execute function public.audit_row_change();
create trigger audit_shipment_quotes after insert or update or delete on public.shipment_quotes for each row execute function public.audit_row_change();
create trigger audit_integration_runs after insert or update or delete on public.integration_runs for each row execute function public.audit_row_change();

revoke all on function public.save_superfrete_quotes(uuid,jsonb) from public,anon;
revoke all on function public.update_shipment_shipping_data(uuid,jsonb) from public,anon;
revoke all on function public.refresh_shipment_recipient(uuid) from public,anon;
revoke all on function public.select_shipment_quote(uuid,uuid) from public,anon;
revoke all on function public.approve_shipment_for_label(uuid) from public,anon;
revoke all on function public.claim_superfrete_cart(uuid,text) from public,anon;
revoke all on function public.complete_superfrete_cart(uuid,uuid,text,text,numeric) from public,anon;
revoke all on function public.claim_superfrete_checkout(uuid) from public,anon;
revoke all on function public.mark_superfrete_operation(uuid,uuid,text,text,text,text) from public,anon;
revoke all on function public.apply_superfrete_state(uuid,uuid,jsonb) from public,anon;
grant execute on function public.save_superfrete_quotes(uuid,jsonb) to authenticated,service_role;
grant execute on function public.update_shipment_shipping_data(uuid,jsonb) to authenticated,service_role;
grant execute on function public.refresh_shipment_recipient(uuid) to authenticated,service_role;
grant execute on function public.select_shipment_quote(uuid,uuid) to authenticated,service_role;
grant execute on function public.approve_shipment_for_label(uuid) to authenticated,service_role;
grant execute on function public.claim_superfrete_cart(uuid,text) to authenticated,service_role;
grant execute on function public.complete_superfrete_cart(uuid,uuid,text,text,numeric) to authenticated,service_role;
grant execute on function public.claim_superfrete_checkout(uuid) to authenticated,service_role;
grant execute on function public.mark_superfrete_operation(uuid,uuid,text,text,text,text) to authenticated,service_role;
grant execute on function public.apply_superfrete_state(uuid,uuid,jsonb) to authenticated,service_role;
