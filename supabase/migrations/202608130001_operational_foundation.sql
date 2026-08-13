-- Fase 1: fundacao operacional. Migration aditiva e preservadora.

create type public.inventory_allocation_status as enum ('reserved','shipping','shipped','released','reconciliation_required');
create type public.shipment_status as enum (
  'draft','requested','awaiting_customer_approval','customer_approved',
  'label_pending','label_released','posted','delivered','cancelled'
);

alter table public.clients
  add column if not exists whatsapp_phone text,
  add column if not exists normalized_phone text,
  add column if not exists normalized_whatsapp text,
  add column if not exists normalized_cpf text,
  add column if not exists normalized_postal_code text,
  add column if not exists cnpj text,
  add column if not exists registration_origin text;

alter table public.sales
  add column if not exists inventory_allocation_eligible boolean not null default false,
  add column if not exists operational_created_at timestamptz;

create or replace function public.only_digits(value text)
returns text language sql immutable parallel safe as $$
  select nullif(regexp_replace(coalesce(value,''),'\D','','g'),'');
$$;

create or replace function public.normalize_br_phone(value text)
returns text language sql immutable parallel safe as $$
  select case
    when public.only_digits(value) is null then null
    when length(public.only_digits(value)) in (10,11) then '55'||public.only_digits(value)
    when length(public.only_digits(value)) in (12,13) and public.only_digits(value) like '55%' then public.only_digits(value)
    else public.only_digits(value)
  end;
$$;

create or replace function public.normalize_client_contacts()
returns trigger language plpgsql set search_path=public as $$
begin
  new.normalized_phone:=public.normalize_br_phone(new.phone);
  new.normalized_whatsapp:=public.normalize_br_phone(coalesce(new.whatsapp_phone,new.phone));
  new.normalized_cpf:=public.only_digits(new.cpf);
  new.normalized_postal_code:=public.only_digits(new.postal_code);
  new.state:=nullif(upper(btrim(coalesce(new.state,''))),'');
  return new;
end;
$$;

drop trigger if exists normalize_client_contacts on public.clients;
create trigger normalize_client_contacts before insert or update of phone,whatsapp_phone,cpf,postal_code,state
on public.clients for each row execute function public.normalize_client_contacts();

update public.clients set
  normalized_phone=public.normalize_br_phone(phone),
  normalized_whatsapp=public.normalize_br_phone(coalesce(whatsapp_phone,phone)),
  normalized_cpf=public.only_digits(cpf),
  normalized_postal_code=public.only_digits(postal_code),
  state=nullif(upper(btrim(coalesce(state,''))),'')
where normalized_phone is distinct from public.normalize_br_phone(phone)
   or normalized_whatsapp is distinct from public.normalize_br_phone(coalesce(whatsapp_phone,phone))
   or normalized_cpf is distinct from public.only_digits(cpf)
   or normalized_postal_code is distinct from public.only_digits(postal_code)
   or state is distinct from nullif(upper(btrim(coalesce(state,''))),'');

create index if not exists clients_org_normalized_phone_idx on public.clients(organization_id,normalized_phone)
  where normalized_phone is not null and deleted_at is null;
create index if not exists clients_org_normalized_whatsapp_idx on public.clients(organization_id,normalized_whatsapp)
  where normalized_whatsapp is not null and deleted_at is null;

alter table public.inventory_items
  add column if not exists physical_ml numeric(14,3),
  add column if not exists reconciliation_status text not null default 'pending'
    check(reconciliation_status in('pending','reconciled','review_required'));

update public.inventory_items set physical_ml=available_ml where physical_ml is null;
alter table public.inventory_items alter column physical_ml set not null;
alter table public.inventory_items alter column physical_ml set default 0;
alter table public.inventory_items add constraint inventory_physical_nonnegative check(physical_ml>=0) not valid;
alter table public.inventory_items validate constraint inventory_physical_nonnegative;

create table public.inventory_allocations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  inventory_item_id uuid not null references public.inventory_items(id),
  client_id uuid not null references public.clients(id),
  sale_id uuid not null references public.sales(id),
  perfume_id uuid not null references public.perfumes(id),
  shipment_id uuid,
  quantity_ml numeric(14,3) not null check(quantity_ml>0),
  status public.inventory_allocation_status not null,
  allocated_at timestamptz,
  released_at timestamptz,
  shipped_at timestamptz,
  reconciliation_note text,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index inventory_allocations_active_sale_uidx on public.inventory_allocations(sale_id)
  where status in('reserved','shipping','shipped');
create index inventory_allocations_client_status_idx on public.inventory_allocations(organization_id,client_id,status);
create index inventory_allocations_item_status_idx on public.inventory_allocations(inventory_item_id,status);

create table public.shipments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  client_id uuid not null references public.clients(id),
  status public.shipment_status not null default 'draft',
  requested_at timestamptz,
  requested_by uuid references public.profiles(id),
  customer_approved_at timestamptz,
  approved_by uuid references public.profiles(id),
  carrier text, service text, service_id text, shipping_price numeric(14,2),
  package_weight numeric(14,3), package_height numeric(14,2), package_width numeric(14,2),
  package_length numeric(14,2), package_format text,
  superfrete_order_id text, superfrete_status text, tracking_code text, label_pdf_url text,
  label_generated_at timestamptz, posted_at timestamptz, delivered_at timestamptz, cancelled_at timestamptz,
  recipient_name text not null, recipient_phone text, recipient_document text, recipient_email text,
  recipient_postal_code text, recipient_address text, recipient_number text, recipient_complement text,
  recipient_district text, recipient_city text, recipient_state text,
  notes text, created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);

alter table public.inventory_allocations add constraint inventory_allocations_shipment_fk
  foreign key(shipment_id) references public.shipments(id);

create table public.shipment_items (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  shipment_id uuid not null references public.shipments(id) on delete cascade,
  allocation_id uuid not null references public.inventory_allocations(id),
  sale_id uuid not null references public.sales(id),
  quantity_ml numeric(14,3) not null check(quantity_ml>0),
  created_at timestamptz not null default now(), removed_at timestamptz,
  unique(shipment_id,allocation_id)
);
create unique index shipment_items_active_allocation_uidx on public.shipment_items(allocation_id) where removed_at is null;

create table public.shipment_events (
  id bigint generated always as identity primary key,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  shipment_id uuid not null references public.shipments(id) on delete cascade,
  event_type text not null, from_status public.shipment_status, to_status public.shipment_status,
  metadata jsonb not null default '{}', actor_id uuid references public.profiles(id),
  created_at timestamptz not null default now()
);

create table public.incremental_import_staging (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  import_batch_id uuid references public.import_batches(id) on delete cascade,
  source_row integer not null,
  raw_data jsonb not null,
  identity_signature text not null,
  classification text not null check(classification in(
    'existing_exact','existing_changed','new_safe','possible_duplicate','review_required'
  )),
  match_sale_id uuid references public.sales(id),
  confidence numeric(4,3) check(confidence between 0 and 1),
  reason text not null,
  proposed_changes jsonb not null default '{}',
  review_status text not null default 'pending' check(review_status in('pending','approved','rejected','applied')),
  reviewed_by uuid references public.profiles(id), reviewed_at timestamptz,
  applied_at timestamptz, created_at timestamptz not null default now(),
  unique(organization_id,import_batch_id,source_row)
);
create index incremental_staging_classification_idx on public.incremental_import_staging(organization_id,classification,review_status);

alter table public.inventory_allocations enable row level security;
alter table public.shipments enable row level security;
alter table public.shipment_items enable row level security;
alter table public.shipment_events enable row level security;
alter table public.incremental_import_staging enable row level security;

create policy allocations_select on public.inventory_allocations for select
  using(organization_id in(select public.current_user_org_ids()));
create policy allocations_manager_write on public.inventory_allocations for all
  using(public.has_org_role(organization_id,array['admin','manager']::public.member_role[]))
  with check(public.has_org_role(organization_id,array['admin','manager']::public.member_role[]));
create policy shipments_select on public.shipments for select
  using(organization_id in(select public.current_user_org_ids()));
create policy shipments_write on public.shipments for all
  using(public.has_org_role(organization_id,array['admin','manager','operator']::public.member_role[]))
  with check(public.has_org_role(organization_id,array['admin','manager','operator']::public.member_role[]));
create policy shipment_items_select on public.shipment_items for select
  using(organization_id in(select public.current_user_org_ids()));
create policy shipment_items_write on public.shipment_items for all
  using(public.has_org_role(organization_id,array['admin','manager','operator']::public.member_role[]))
  with check(public.has_org_role(organization_id,array['admin','manager','operator']::public.member_role[]));
create policy shipment_events_select on public.shipment_events for select
  using(organization_id in(select public.current_user_org_ids()));
create policy shipment_events_insert on public.shipment_events for insert
  with check(public.has_org_role(organization_id,array['admin','manager','operator']::public.member_role[]));
create policy incremental_staging_select on public.incremental_import_staging for select
  using(organization_id in(select public.current_user_org_ids()));
create policy incremental_staging_manager_write on public.incremental_import_staging for all
  using(public.has_org_role(organization_id,array['admin','manager']::public.member_role[]))
  with check(public.has_org_role(organization_id,array['admin','manager']::public.member_role[]));

-- Escritas operacionais passam apenas pelas RPCs transacionais abaixo.
revoke insert,update,delete on public.inventory_allocations from authenticated;
revoke insert,update,delete on public.shipments from authenticated;
revoke insert,update,delete on public.shipment_items from authenticated;
revoke insert,update,delete on public.shipment_events from authenticated;

create or replace function public.sync_sale_inventory_allocation()
returns trigger language plpgsql security definer set search_path=public as $$
declare v_item public.inventory_items; v_allocation public.inventory_allocations; v_delta numeric;
begin
  select * into v_allocation from public.inventory_allocations
    where sale_id=new.id and status in('reserved','shipping','shipped') for update;

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

  select * into v_item from public.inventory_items
    where organization_id=new.organization_id and perfume_id=new.perfume_id and status='active' for update;
  if not found or new.sale_date<v_item.reference_date then return new; end if;

  if v_allocation.id is null then
    if v_item.available_ml<new.volume_ml then raise exception 'insufficient_available_inventory'; end if;
    update public.inventory_items set available_ml=available_ml-new.volume_ml,updated_at=now() where id=v_item.id;
    insert into public.inventory_allocations(
      organization_id,inventory_item_id,client_id,sale_id,perfume_id,quantity_ml,status,allocated_at,created_by
    ) values(new.organization_id,v_item.id,new.client_id,new.id,new.perfume_id,new.volume_ml,'reserved',now(),auth.uid());
  elsif v_allocation.status='reserved' then
    if v_allocation.inventory_item_id<>v_item.id then raise exception 'allocation_perfume_change_requires_release'; end if;
    v_delta:=new.volume_ml-v_allocation.quantity_ml;
    if v_delta>v_item.available_ml then raise exception 'insufficient_available_inventory'; end if;
    update public.inventory_items set available_ml=available_ml-v_delta,updated_at=now() where id=v_item.id;
    update public.inventory_allocations set client_id=new.client_id,quantity_ml=new.volume_ml,updated_at=now() where id=v_allocation.id;
  end if;
  return new;
end;
$$;

-- Desliga o trigger antigo somente depois que o substituto foi criado.
drop trigger if exists inventory_sale_sync on public.sales;
create trigger sync_sale_inventory_allocation after insert or update of
  client_id,perfume_id,volume_ml,payment_status,sale_date,deleted_at,inventory_allocation_eligible
on public.sales for each row execute function public.sync_sale_inventory_allocation();

-- Movimentos administrativos alteram o fisico e o disponivel na mesma medida.
create or replace function public.inventory_apply(
  p_item_id uuid,p_quantity_ml numeric,p_type public.inventory_movement_type,
  p_reason text,p_notes text default null,p_sale_id uuid default null
) returns public.inventory_movements
language plpgsql security definer set search_path=public as $$
declare v_item public.inventory_items; v_movement public.inventory_movements; v_after numeric; v_physical_after numeric;
begin
  select * into v_item from public.inventory_items where id=p_item_id for update;
  if not found then raise exception 'inventory_item_not_found'; end if;
  if auth.uid() is not null and not public.has_org_role(v_item.organization_id,array['admin','manager','operator']::public.member_role[])
    then raise exception 'inventory_write_forbidden'; end if;
  if p_quantity_ml=0 or btrim(coalesce(p_reason,''))='' then raise exception 'inventory_reason_and_quantity_required'; end if;
  v_after:=v_item.available_ml+p_quantity_ml;
  v_physical_after:=v_item.physical_ml+p_quantity_ml;
  if v_after<0 then raise exception 'insufficient_available_inventory'; end if;
  if v_physical_after<0 then raise exception 'insufficient_physical_inventory'; end if;
  update public.inventory_items set available_ml=v_after,physical_ml=v_physical_after,updated_at=now() where id=v_item.id;
  insert into public.inventory_movements(
    organization_id,inventory_item_id,perfume_id,sale_id,movement_type,quantity_ml,
    balance_before,balance_after,reason,notes,created_by
  ) values(
    v_item.organization_id,v_item.id,v_item.perfume_id,p_sale_id,p_type,p_quantity_ml,
    v_item.available_ml,v_after,p_reason,p_notes,auth.uid()
  ) returning * into v_movement;
  insert into public.audit_logs(organization_id,actor_id,action,entity_type,entity_id,metadata)
  values(v_item.organization_id,auth.uid(),'inventory_movement','inventory_item',v_item.id::text,
    jsonb_build_object('movement_id',v_movement.id,'type',p_type,'quantity_ml',p_quantity_ml,
      'physical_before',v_item.physical_ml,'physical_after',v_physical_after,'sale_id',p_sale_id));
  return v_movement;
end;
$$;

-- O historico comercial nao e convertido em reserva. O saldo operacional existente
-- e preservado e fica explicitamente pendente de conferencia fisica humana.
update public.inventory_items set physical_ml=available_ml,reconciliation_status='review_required';

create or replace function public.inventory_operational_rows(org_id uuid)
returns table(item_id uuid,perfume_id uuid,perfume text,physical_ml numeric,reserved_ml numeric,
  shipping_ml numeric,available_ml numeric,minimum_ml numeric,reconciliation_status text)
language sql stable security invoker set search_path=public as $$
  select i.id,p.id,p.full_name_raw,i.physical_ml,
    coalesce(sum(a.quantity_ml) filter(where a.status='reserved'),0),
    coalesce(sum(a.quantity_ml) filter(where a.status='shipping'),0),
    i.available_ml,i.minimum_ml,i.reconciliation_status
  from public.inventory_items i join public.perfumes p on p.id=i.perfume_id
  left join public.inventory_allocations a on a.inventory_item_id=i.id
  where i.organization_id=org_id and i.status='active'
  group by i.id,p.id,p.full_name_raw order by p.full_name_raw;
$$;

create or replace function public.client_360(p_client_id uuid)
returns jsonb language sql stable security invoker set search_path=public as $$
with c as (
  select * from public.clients where id=p_client_id and deleted_at is null
    and organization_id in(select public.current_user_org_ids())
), stats as (
  select count(*) filter(where payment_status<>'cancelled') purchases,
    coalesce(sum(amount) filter(where payment_status<>'cancelled'),0) total_purchased,
    coalesce(sum(amount) filter(where payment_status='paid'),0) paid,
    coalesce(sum(amount) filter(where payment_status='pending'),0) pending,
    coalesce(sum(amount) filter(where payment_status='cancelled'),0) cancelled,
    coalesce(avg(amount) filter(where payment_status<>'cancelled'),0) average_ticket,
    coalesce(sum(volume_ml) filter(where payment_status<>'cancelled'),0) total_ml,
    min(sale_date) first_purchase,max(sale_date) last_purchase
  from public.sales where client_id=p_client_id and deleted_at is null
), waiting as (
  select coalesce(sum(quantity_ml),0) waiting_ml,count(*) waiting_products
  from public.inventory_allocations where client_id=p_client_id and status='reserved'
), favorite as (
  select perfume_name_raw,count(*) purchases,coalesce(sum(amount),0) value
  from public.sales where client_id=p_client_id and deleted_at is null and payment_status<>'cancelled'
  group by perfume_name_raw order by purchases desc,value desc nulls last limit 1
)
select jsonb_build_object('client',to_jsonb(c),'commercial',to_jsonb(stats)||jsonb_build_object(
  'top_perfume',(select perfume_name_raw from favorite),'top_perfume_value',(select value from favorite)
),'waiting',to_jsonb(waiting)) from c cross join stats cross join waiting;
$$;

create or replace function public.client_waiting_products(p_client_id uuid)
returns table(allocation_id uuid,sale_id uuid,sale_date date,perfume text,sale_type text,
  quantity_ml numeric,amount numeric,payment_status public.payment_status,allocated_at timestamptz,days_waiting integer)
language sql stable security invoker set search_path=public as $$
  select a.id,s.id,s.sale_date,p.full_name_raw,s.sale_type,a.quantity_ml,s.amount,s.payment_status,
    a.allocated_at,greatest(0,(current_date-coalesce(a.allocated_at::date,s.sale_date)))::integer
  from public.inventory_allocations a join public.sales s on s.id=a.sale_id join public.perfumes p on p.id=a.perfume_id
  where a.client_id=p_client_id and a.status='reserved'
    and a.organization_id in(select public.current_user_org_ids()) order by s.sale_date,a.created_at;
$$;

create or replace function public.create_draft_shipment(p_client_id uuid,p_allocation_ids uuid[],p_notes text default null)
returns uuid language plpgsql security definer set search_path=public as $$
declare v_client public.clients; v_org uuid; v_id uuid; v_count integer;
begin
  select * into v_client from public.clients where id=p_client_id and deleted_at is null;
  v_org:=v_client.organization_id;
  if v_org is null or not public.has_org_role(v_org,array['admin','manager','operator']::public.member_role[]) then raise exception 'forbidden'; end if;
  perform id from public.inventory_allocations
    where id=any(p_allocation_ids) and organization_id=v_org and client_id=p_client_id and status='reserved' for update;
  select count(*) into v_count from public.inventory_allocations
    where id=any(p_allocation_ids) and organization_id=v_org and client_id=p_client_id and status='reserved';
  if v_count<>cardinality(p_allocation_ids) or v_count=0 then raise exception 'invalid_or_unavailable_allocations'; end if;
  insert into public.shipments(
    organization_id,client_id,status,recipient_name,recipient_phone,recipient_document,recipient_email,
    recipient_postal_code,recipient_address,recipient_number,recipient_complement,recipient_district,
    recipient_city,recipient_state,notes,created_by
  ) values(v_org,p_client_id,'draft',v_client.name,coalesce(v_client.whatsapp_phone,v_client.phone),v_client.cpf,
    v_client.email,v_client.postal_code,v_client.address_line,v_client.address_number,v_client.complement,
    v_client.district,v_client.city,v_client.state,p_notes,auth.uid()) returning id into v_id;
  insert into public.shipment_items(organization_id,shipment_id,allocation_id,sale_id,quantity_ml)
    select v_org,v_id,a.id,a.sale_id,a.quantity_ml from public.inventory_allocations a where a.id=any(p_allocation_ids);
  update public.inventory_allocations set status='shipping',shipment_id=v_id,updated_at=now() where id=any(p_allocation_ids);
  insert into public.shipment_events(organization_id,shipment_id,event_type,to_status,actor_id)
    values(v_org,v_id,'shipment_created','draft',auth.uid());
  return v_id;
end;
$$;

create or replace function public.cancel_draft_shipment(p_shipment_id uuid)
returns void language plpgsql security definer set search_path=public as $$
declare v public.shipments;
begin
  select * into v from public.shipments where id=p_shipment_id for update;
  if v.id is null or not public.has_org_role(v.organization_id,array['admin','manager','operator']::public.member_role[]) then raise exception 'forbidden'; end if;
  if v.status not in('draft','requested','awaiting_customer_approval') then raise exception 'shipment_cannot_be_cancelled'; end if;
  update public.inventory_allocations set status='reserved',shipment_id=null,updated_at=now() where shipment_id=v.id and status='shipping';
  update public.shipment_items set removed_at=now() where shipment_id=v.id and removed_at is null;
  update public.shipments set status='cancelled',cancelled_at=now(),updated_at=now() where id=v.id;
  insert into public.shipment_events(organization_id,shipment_id,event_type,from_status,to_status,actor_id)
    values(v.organization_id,v.id,'shipment_cancelled',v.status,'cancelled',auth.uid());
end;
$$;

create or replace function public.post_shipment(p_shipment_id uuid)
returns void language plpgsql security definer set search_path=public as $$
declare v public.shipments; r record;
begin
  select * into v from public.shipments where id=p_shipment_id for update;
  if v.id is null or not public.has_org_role(v.organization_id,array['admin','manager']::public.member_role[]) then raise exception 'forbidden'; end if;
  if v.status in('posted','delivered') then return; end if;
  if v.status not in('label_released','customer_approved') then raise exception 'shipment_not_ready_to_post'; end if;
  for r in select a.* from public.inventory_allocations a where a.shipment_id=v.id and a.status='shipping' for update loop
    perform 1 from public.inventory_items where id=r.inventory_item_id and physical_ml>=r.quantity_ml for update;
    if not found then raise exception 'insufficient_physical_inventory'; end if;
    update public.inventory_items set physical_ml=physical_ml-r.quantity_ml,updated_at=now() where id=r.inventory_item_id;
    update public.inventory_allocations set status='shipped',shipped_at=now(),updated_at=now() where id=r.id;
  end loop;
  update public.shipments set status='posted',posted_at=now(),updated_at=now() where id=v.id;
  insert into public.shipment_events(organization_id,shipment_id,event_type,from_status,to_status,actor_id)
    values(v.organization_id,v.id,'shipment_posted',v.status,'posted',auth.uid());
end;
$$;

create trigger audit_inventory_allocations after insert or update or delete on public.inventory_allocations
  for each row execute function public.audit_row_change();
create trigger audit_shipments after insert or update or delete on public.shipments
  for each row execute function public.audit_row_change();
create trigger audit_shipment_items after insert or update or delete on public.shipment_items
  for each row execute function public.audit_row_change();
create trigger audit_incremental_staging after insert or update or delete on public.incremental_import_staging
  for each row execute function public.audit_row_change();

create or replace function public.ai_authorized_aggregates(org_id uuid,start_date date,end_date date)
returns jsonb language sql stable security invoker set search_path=public as $$
  select public.commercial_period_summary(org_id,start_date,end_date)-'daily'||jsonb_build_object(
    'inventory',jsonb_build_object(
      'physical_ml',coalesce((select sum(physical_ml) from public.inventory_operational_rows(org_id)),0),
      'reserved_ml',coalesce((select sum(reserved_ml) from public.inventory_operational_rows(org_id)),0),
      'shipping_ml',coalesce((select sum(shipping_ml) from public.inventory_operational_rows(org_id)),0),
      'available_ml',coalesce((select sum(available_ml) from public.inventory_operational_rows(org_id)),0),
      'review_required',coalesce((select count(*) from public.inventory_operational_rows(org_id) where reconciliation_status='review_required'),0)
    ),
    'shipments',jsonb_build_object(
      'draft',coalesce((select count(*) from public.shipments where organization_id=org_id and status='draft'),0),
      'awaiting_customer_approval',coalesce((select count(*) from public.shipments where organization_id=org_id and status='awaiting_customer_approval'),0),
      'posted',coalesce((select count(*) from public.shipments where organization_id=org_id and status='posted'),0)
    ),
    'data_source','Supabase RUAH - agregados operacionais autorizados','generated_at',now(),'timezone','America/Sao_Paulo'
  );
$$;

revoke all on function public.inventory_operational_rows(uuid) from public,anon;
revoke all on function public.client_360(uuid) from public,anon;
revoke all on function public.client_waiting_products(uuid) from public,anon;
revoke all on function public.create_draft_shipment(uuid,uuid[],text) from public,anon;
revoke all on function public.cancel_draft_shipment(uuid) from public,anon;
revoke all on function public.post_shipment(uuid) from public,anon;
grant execute on function public.inventory_operational_rows(uuid) to authenticated,service_role;
grant execute on function public.client_360(uuid) to authenticated,service_role;
grant execute on function public.client_waiting_products(uuid) to authenticated,service_role;
grant execute on function public.create_draft_shipment(uuid,uuid[],text) to authenticated,service_role;
grant execute on function public.cancel_draft_shipment(uuid) to authenticated,service_role;
grant execute on function public.post_shipment(uuid) to authenticated,service_role;
