begin;

-- A previsão pertence à origem comercial da venda. Ela não é atributo do
-- perfume nem confirmação de estoque físico.
alter table public.sales
  add column if not exists shipping_availability_text text,
  add column if not exists shipping_availability_kind text,
  add column if not exists shipping_available_date date,
  add column if not exists shipping_lead_business_days integer,
  add column if not exists shipping_availability_review_required boolean not null default false,
  add column if not exists shipping_availability_confirmed_at timestamptz,
  add column if not exists shipping_availability_confirmed_by uuid references public.profiles(id);

alter table public.sales drop constraint if exists sales_shipping_availability_kind_check;
alter table public.sales add constraint sales_shipping_availability_kind_check check (
  shipping_availability_kind is null or shipping_availability_kind in
  ('available_now','available_from_date','expected_by_date','lead_time','unknown')
);
alter table public.sales drop constraint if exists sales_shipping_lead_business_days_check;
alter table public.sales add constraint sales_shipping_lead_business_days_check
  check (shipping_lead_business_days is null or shipping_lead_business_days >= 0);

-- Os RPCs de importação já gravam texto e data históricos. Este trigger
-- classifica esses dados na mesma transação, sem tocar estoque/alocação.
create or replace function public.sales_classify_shipping_availability()
returns trigger language plpgsql set search_path=public as $$
declare normalized text;
begin
  if new.shipping_availability_kind is not null then return new; end if;
  if new.source <> 'ai_sales_batch' then return new; end if;
  new.shipping_availability_text := nullif(btrim(new.shipping_deadline_raw),'');
  normalized := lower(unaccent(coalesce(new.shipping_availability_text,'')));
  new.shipping_available_date := new.shipping_deadline_date;
  new.shipping_lead_business_days := nullif((regexp_match(normalized,'([0-9]+)[[:space:]]+dias?[[:space:]]+uteis'))[1],'')::integer;
  if normalized ~ '(pronta entrega|disponivel imediatamente|envio imediato)' then
    new.shipping_availability_kind := 'available_now';
  elsif normalized ~ 'a partir de' then
    new.shipping_availability_kind := 'available_from_date';
  elsif normalized ~ '(ate[[:space:]]+[0-9]|previsao|previsto|estimad)' then
    new.shipping_availability_kind := 'expected_by_date';
  elsif new.shipping_lead_business_days is not null then
    new.shipping_availability_kind := 'lead_time';
  else
    new.shipping_availability_kind := 'unknown';
  end if;
  new.shipping_availability_review_required :=
    new.shipping_availability_kind = 'unknown' or
    (new.shipping_availability_kind in ('available_from_date','expected_by_date') and new.shipping_available_date is null);
  return new;
end;$$;
drop trigger if exists sales_classify_shipping_availability_before_insert on public.sales;
create trigger sales_classify_shipping_availability_before_insert before insert on public.sales
for each row execute function public.sales_classify_shipping_availability();

-- Wrappers novos mantêm os RPCs legados intactos e persistem exatamente a
-- interpretação confirmada no preview, ainda dentro da mesma transação.
create function public.confirm_ai_sales_batch_with_availability(
  p_organization_id uuid,p_fingerprint text,p_source_text text,p_batch jsonb,p_availability jsonb
) returns jsonb language plpgsql security definer set search_path=public as $$
declare result jsonb; idx integer; signature text;
begin
  result:=public.confirm_ai_sales_batch(p_organization_id,p_fingerprint,p_source_text,p_batch);
  for idx in 0..greatest(coalesce(jsonb_array_length(p_batch->'sales'),0)-1,0) loop
    signature:=public.ai_sha256_hex(p_fingerprint||'|'||idx::text);
    update public.sales set
      shipping_availability_text=nullif(p_availability->>'text',''),
      shipping_availability_kind=coalesce(nullif(p_availability->>'kind',''),'unknown'),
      shipping_available_date=nullif(p_availability->>'date','')::date,
      shipping_lead_business_days=nullif(p_availability->>'lead_business_days','')::integer,
      shipping_availability_review_required=coalesce((p_availability->>'review_required')::boolean,false)
    where organization_id=p_organization_id and import_signature=signature and source='ai_sales_batch';
  end loop;
  return result;
end;$$;
revoke all on function public.confirm_ai_sales_batch_with_availability(uuid,text,text,jsonb,jsonb) from public,anon;
grant execute on function public.confirm_ai_sales_batch_with_availability(uuid,text,text,jsonb,jsonb) to authenticated,service_role;

create function public.confirm_ai_sales_batch_multi_with_availability(
  p_organization_id uuid,p_fingerprint text,p_source_text text,p_sale_date date,p_shipping_deadline_date date,p_deadline_raw text,p_groups jsonb,p_availability jsonb
) returns jsonb language plpgsql security definer set search_path=public as $$
declare result jsonb; group_item jsonb; sale_item jsonb; signature text; perfume_name text;
begin
  result:=public.confirm_ai_sales_batch_multi(p_organization_id,p_fingerprint,p_source_text,p_sale_date,p_shipping_deadline_date,p_deadline_raw,p_groups);
  for group_item in select * from jsonb_array_elements(p_groups) loop
    perfume_name:=coalesce(nullif(btrim(group_item->>'display_name'),''),group_item->>'perfume');
    for sale_item in select * from jsonb_array_elements(group_item->'sales') loop
      signature:=public.ai_sha256_hex(btrim(regexp_replace(lower(unaccent(sale_item->>'client_name')),'[^a-z0-9]+',' ','g'))||'|'||p_sale_date::text||'|'||public.normalize_ai_perfume_name(perfume_name)||'|'||coalesce(sale_item->>'sale_type','')||'|'||coalesce(sale_item->>'volume_ml','')||'|'||coalesce(sale_item->>'amount',''));
      update public.sales set shipping_availability_text=nullif(p_availability->>'text',''),shipping_availability_kind=coalesce(nullif(p_availability->>'kind',''),'unknown'),shipping_available_date=nullif(p_availability->>'date','')::date,shipping_lead_business_days=nullif(p_availability->>'lead_business_days','')::integer,shipping_availability_review_required=coalesce((p_availability->>'review_required')::boolean,false)
      where organization_id=p_organization_id and import_signature=signature and source='ai_sales_batch';
    end loop;
  end loop;
  return result;
end;$$;
revoke all on function public.confirm_ai_sales_batch_multi_with_availability(uuid,text,text,date,date,text,jsonb,jsonb) from public,anon;
grant execute on function public.confirm_ai_sales_batch_multi_with_availability(uuid,text,text,date,date,text,jsonb,jsonb) to authenticated,service_role;

drop function public.customer_custody();
create function public.customer_custody()
returns table(
  allocation_id uuid, perfume_id uuid, perfume_name text,
  quantity_ml numeric, sale_date date, allocation_status text,
  requested boolean, request_id uuid,
  shipping_availability_text text, shipping_availability_kind text,
  shipping_available_date date, shipping_lead_business_days integer,
  shipping_availability_confirmed_at timestamptz, shipping_requestable boolean
)
language sql stable security definer set search_path=public as $$
  select a.id,a.perfume_id,p.full_name_raw,a.quantity_ml,s.sale_date,a.status::text,
    (i.id is not null),i.request_id,s.shipping_availability_text,s.shipping_availability_kind,
    s.shipping_available_date,s.shipping_lead_business_days,s.shipping_availability_confirmed_at,
    case
      when s.shipping_availability_kind is null then true
      when s.shipping_availability_confirmed_at is not null then true
      when s.shipping_availability_kind='available_now' then true
      else false
    end
  from public.inventory_allocations a
  join public.perfumes p on p.id=a.perfume_id
  join public.sales s on s.id=a.sale_id
  left join public.customer_shipment_request_items i on i.allocation_id=a.id
    and i.request_id in(select id from public.customer_shipment_requests where status<>'cancelled')
  where a.client_id=public.current_customer_client() and a.status in('reserved','shipping')
  order by p.full_name_raw,s.sale_date;
$$;
revoke all on function public.customer_custody() from public,anon;
grant execute on function public.customer_custody() to authenticated;

create or replace function public.confirm_sale_shipping_availability(p_sale_id uuid)
returns public.sales language plpgsql security definer set search_path=public as $$
declare v public.sales;
begin
  select * into v from public.sales where id=p_sale_id and deleted_at is null for update;
  if v.id is null then raise exception 'sale_not_found'; end if;
  if not public.has_org_role(v.organization_id,array['admin','manager','operator']::public.member_role[]) then raise exception 'forbidden'; end if;
  update public.sales set shipping_availability_confirmed_at=coalesce(shipping_availability_confirmed_at,now()),shipping_availability_confirmed_by=coalesce(shipping_availability_confirmed_by,auth.uid()) where id=v.id returning * into v;
  insert into public.audit_logs(organization_id,actor_id,action,entity_type,entity_id,metadata)
  values(v.organization_id,auth.uid(),'sale_shipping_availability_confirmed','sale',v.id::text,jsonb_build_object('kind',v.shipping_availability_kind,'available_date',v.shipping_available_date));
  return v;
end;$$;
revoke all on function public.confirm_sale_shipping_availability(uuid) from public,anon;
grant execute on function public.confirm_sale_shipping_availability(uuid) to authenticated,service_role;

-- Defesa no servidor: expected_by_date e lead_time são previsão, nunca prova
-- de chegada. Apenas confirmação operacional explícita os libera.
create or replace function public.customer_shipping_allocations_requestable(p_allocation_ids uuid[],p_client_id uuid)
returns boolean language sql stable security definer set search_path=public as $$
  select count(*)=cardinality(p_allocation_ids) and bool_and(
    s.shipping_availability_kind is null or s.shipping_availability_confirmed_at is not null or
    s.shipping_availability_kind='available_now'
  )
  from public.inventory_allocations a join public.sales s on s.id=a.sale_id
  where a.id=any(p_allocation_ids) and a.client_id=p_client_id and a.status='reserved';
$$;
revoke all on function public.customer_shipping_allocations_requestable(uuid[],uuid) from public,anon,authenticated;

-- Envolve a função existente sem alterar seu contrato público; o rename
-- preserva toda a transação/idempotência já validada e acrescenta o gate.
alter function public.customer_shipment_request_create(uuid[],jsonb,text) rename to customer_shipment_request_create_unchecked;
create function public.customer_shipment_request_create(p_allocation_ids uuid[],p_address jsonb,p_notes text default null)
returns public.customer_shipment_requests language plpgsql security definer set search_path=public as $$
declare v_client uuid;
begin
  v_client:=public.current_customer_client();
  if v_client is null then raise exception 'forbidden'; end if;
  if not public.customer_shipping_allocations_requestable(p_allocation_ids,v_client) then raise exception 'shipping_availability_pending'; end if;
  return public.customer_shipment_request_create_unchecked(p_allocation_ids,p_address,p_notes);
end;$$;
revoke all on function public.customer_shipment_request_create_unchecked(uuid[],jsonb,text) from public,anon,authenticated;
revoke all on function public.customer_shipment_request_create(uuid[],jsonb,text) from public,anon;
grant execute on function public.customer_shipment_request_create(uuid[],jsonb,text) to authenticated;

commit;
