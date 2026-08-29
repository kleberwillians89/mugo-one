begin;

-- ==========================================================================
-- 1. CLIENT_NUMBER — identificador operacional permanente por organização
-- --------------------------------------------------------------------------
-- Permanente, tenant-safe, transacional. Nunca deriva do índice da tela,
-- de filtro ou de ordenação. Não muda quando o cliente ganha uma venda.
-- Não é reutilizado silenciosamente. Cliente existente nunca troca de número.
-- ==========================================================================
alter table public.clients add column if not exists client_number integer;

-- Backfill determinístico por organização.
with numbered as (
  select id,
         row_number() over (partition by organization_id order by created_at, id)::integer as assigned_number
  from public.clients
  where client_number is null
)
update public.clients c
set client_number = numbered.assigned_number
from numbered
where numbered.id = c.id;

alter table public.clients
  alter column client_number set not null,
  add constraint clients_client_number_positive check (client_number > 0),
  add constraint clients_organization_client_number_key unique (organization_id, client_number);

comment on column public.clients.client_number is
  'Identificador operacional permanente, positivo e único dentro da organização. Nunca muda; nunca é reutilizado silenciosamente.';

-- Contador por organização, incremento atômico. Exclusão de cliente não faz
-- o número voltar. Outra organização pode ter o seu próprio 001.
create table public.client_number_counters (
  organization_id uuid primary key references public.organizations(id) on delete cascade,
  last_number integer not null check (last_number >= 0),
  updated_at timestamptz not null default now()
);
alter table public.client_number_counters enable row level security;
revoke all on table public.client_number_counters from public, anon, authenticated;

insert into public.client_number_counters (organization_id, last_number)
select organization_id, max(client_number) from public.clients group by organization_id
on conflict (organization_id) do update
  set last_number = greatest(public.client_number_counters.last_number, excluded.last_number),
      updated_at = now();

create or replace function public.assign_permanent_client_number()
returns trigger language plpgsql security definer set search_path=public as $$
begin
  if tg_op = 'UPDATE' then
    if new.organization_id is distinct from old.organization_id then raise exception 'client_organization_is_permanent'; end if;
    if new.client_number is distinct from old.client_number then raise exception 'client_number_is_permanent'; end if;
    return new;
  end if;

  if new.client_number is null then
    insert into public.client_number_counters (organization_id, last_number)
    values (new.organization_id, 1)
    on conflict (organization_id) do update
      set last_number = public.client_number_counters.last_number + 1,
          updated_at = now()
    returning last_number into new.client_number;
  else
    if new.client_number <= 0 then raise exception 'invalid_client_number'; end if;
    insert into public.client_number_counters (organization_id, last_number)
    values (new.organization_id, new.client_number)
    on conflict (organization_id) do update
      set last_number = greatest(public.client_number_counters.last_number, excluded.last_number),
          updated_at = now();
  end if;
  return new;
end;$$;
revoke all on function public.assign_permanent_client_number() from public, anon, authenticated;

drop trigger if exists assign_permanent_client_number on public.clients;
create trigger assign_permanent_client_number
before insert or update of organization_id, client_number on public.clients
for each row execute function public.assign_permanent_client_number();

-- ==========================================================================
-- 2. DATA DO SPLIT — sales.split_completed_at
-- --------------------------------------------------------------------------
-- Data em que uma venda SPLIT foi efetivamente splitada. NÃO é data de venda,
-- pagamento, envio, prazo ou preparação automática. Nunca inferida.
-- Não altera estoque, ML, allocation, RUAH-P, preparação ou envio.
-- ==========================================================================
alter table public.sales add column if not exists split_completed_at date;

alter table public.sales add constraint sales_split_completed_at_requires_split
  check (split_completed_at is null or sale_type = 'SPLIT');

comment on column public.sales.split_completed_at is
  'Data em que a venda SPLIT foi efetivamente splitada. Independente de venda, pagamento, envio, prazo e preparação. Não movimenta estoque.';

create index sales_org_split_completed_at_idx on public.sales (organization_id, split_completed_at)
  where deleted_at is null and sale_type = 'SPLIT';

-- ==========================================================================
-- 3. RPCs Davi Excel — republicação mínima para client_number + split
-- ==========================================================================

-- 3.1 Criação: aceita split_completed_at somente para SPLIT.
create or replace function public.davi_excel_create_sale(p_payload jsonb,p_idempotency_key text)
returns uuid language plpgsql security definer set search_path=public as $$
declare org uuid;uid uuid:=auth.uid();client public.clients;perfume public.perfumes;sale_id uuid;status public.payment_status;
begin
 if uid is null then raise exception 'authentication_required';end if;
 if nullif(btrim(p_idempotency_key),'') is null then raise exception 'idempotency_key_required';end if;
 select * into client from public.clients where id=(p_payload->>'client_id')::uuid and deleted_at is null and merged_into_id is null;
 if not found then raise exception 'invalid_client';end if;
 org:=client.organization_id;
 if not public.has_org_permission(org,'sales.edit') then raise exception 'permission_denied';end if;
 select * into perfume from public.perfumes where id=(p_payload->>'perfume_id')::uuid and organization_id=org;
 if not found then raise exception 'invalid_perfume';end if;
 status:=(p_payload->>'payment_status')::public.payment_status;
 if (p_payload->>'sale_type') not in('APC','SPLIT') then raise exception 'invalid_sale_type';end if;
 if (p_payload->>'volume_ml')::numeric<=0 then raise exception 'invalid_volume';end if;
 if (p_payload->>'amount')::numeric<0 then raise exception 'invalid_amount';end if;
 if nullif(p_payload->>'split_completed_at','') is not null and (p_payload->>'sale_type')<>'SPLIT' then raise exception 'split_date_requires_split_sale';end if;
 select id into sale_id from public.sales where organization_id=org and source='davi_excel' and import_signature=p_idempotency_key;
 if found then return sale_id;end if;
 insert into public.sales(organization_id,client_id,perfume_id,sale_date,amount,payment_status,payment_method,paid_at,notes,source,import_signature,created_by,perfume_name_raw,perfume_base_name,sale_type,volume_ml,volume_ml_raw,shipping_deadline_raw,shipping_deadline_date,shipping_operational_status,data_quality_status,inventory_allocation_eligible,operational_created_at,split_completed_at)
 values(org,client.id,perfume.id,(p_payload->>'sale_date')::date,(p_payload->>'amount')::numeric,status,nullif(btrim(p_payload->>'payment_method'),''),case when status='paid' then nullif(p_payload->>'paid_at','')::date else null end,nullif(btrim(p_payload->>'notes'),''),'davi_excel',p_idempotency_key,uid,perfume.full_name_raw,perfume.base_name,p_payload->>'sale_type',(p_payload->>'volume_ml')::numeric,p_payload->>'volume_ml',nullif(btrim(p_payload->>'shipping_deadline_raw'),''),nullif(p_payload->>'shipping_deadline_date','')::date,case when nullif(p_payload->>'shipping_deadline_date','') is null then nullif(btrim(p_payload->>'shipping_deadline_raw'),'') else null end,'verified',true,now(),case when p_payload->>'sale_type'='SPLIT' then nullif(p_payload->>'split_completed_at','')::date else null end) returning id into sale_id;
 return sale_id;
exception when unique_violation then
 select id into sale_id from public.sales where organization_id=org and source='davi_excel' and import_signature=p_idempotency_key;
 return sale_id;
end;$$;
revoke all on function public.davi_excel_create_sale(jsonb,text) from public,anon;
grant execute on function public.davi_excel_create_sale(jsonb,text) to authenticated;

-- 3.2 Edição da mesma sale: split_completed_at editável, com audit before/after,
-- optimistic concurrency e tenant validation. Não dispara escrita operacional.
create or replace function public.davi_excel_update_sale(
  p_sale_id uuid,
  p_patch jsonb,
  p_expected_updated_at timestamptz,
  p_confirm_operational boolean default false
)
returns jsonb language plpgsql security definer set search_path=public as $$
declare
  before_row public.sales; after_row public.sales; key text;
  next_client public.clients; next_perfume public.perfumes;
  has_allocation boolean; has_preparation boolean; has_shipment boolean; has_posted boolean;
  protected_change boolean; changed text[]:=array[]::text[];
  allowed constant text[]:=array['client_id','sale_date','shipping_deadline_date','shipping_deadline_raw','shipped_at','sale_type','volume_ml','perfume_id','split_completed_at','amount','payment_status','payment_method','paid_at','credit_reference_amount','notes'];
  effective_type text;
begin
  select * into before_row from public.sales
   where id=p_sale_id and organization_id in(select public.current_user_org_ids()) and deleted_at is null
   for update;
  if before_row.id is null then raise exception 'sale_not_found'; end if;
  if not public.has_org_permission(before_row.organization_id,'sales.edit') then raise exception 'forbidden'; end if;
  if before_row.updated_at is distinct from p_expected_updated_at then raise exception 'stale_sale'; end if;
  for key in select jsonb_object_keys(p_patch) loop
    if not(key=any(allowed)) then raise exception 'field_not_editable:%',key; end if;
    changed:=array_append(changed,key);
  end loop;

  if p_patch?'client_id' then
    select * into next_client from public.clients where id=(p_patch->>'client_id')::uuid and organization_id=before_row.organization_id and deleted_at is null;
    if next_client.id is null then raise exception 'invalid_client'; end if;
  end if;
  if p_patch?'perfume_id' then
    select * into next_perfume from public.perfumes where id=(p_patch->>'perfume_id')::uuid and organization_id=before_row.organization_id;
    if next_perfume.id is null then raise exception 'invalid_perfume'; end if;
  end if;

  effective_type:=coalesce(nullif(btrim(p_patch->>'sale_type'),''),before_row.sale_type);
  if nullif(p_patch->>'split_completed_at','') is not null and effective_type<>'SPLIT' then
    raise exception 'split_date_requires_split_sale';
  end if;

  select exists(select 1 from public.inventory_allocations a where a.sale_id=before_row.id),
    exists(select 1 from public.preparation_batch_items bi join public.inventory_allocations a on a.id=bi.allocation_id where a.sale_id=before_row.id),
    exists(select 1 from public.shipment_items si join public.shipments sh on sh.id=si.shipment_id where si.sale_id=before_row.id and si.removed_at is null and sh.status<>'cancelled'),
    exists(select 1 from public.shipment_items si join public.shipments sh on sh.id=si.shipment_id where si.sale_id=before_row.id and si.removed_at is null and sh.status in('posted','delivered'))
    into has_allocation,has_preparation,has_shipment,has_posted;
  protected_change:=p_patch ?| array['client_id','perfume_id','volume_ml'];
  if protected_change and (has_allocation or has_preparation or has_shipment) and not p_confirm_operational then
    raise exception 'operational_confirmation_required';
  end if;
  if p_patch?'shipped_at' and has_shipment then raise exception 'shipment_controls_shipping_date'; end if;

  update public.sales set
    client_id=case when p_patch?'client_id' then next_client.id else client_id end,
    client_name_raw=case when p_patch?'client_id' then next_client.name else client_name_raw end,
    sale_date=case when p_patch?'sale_date' then nullif(p_patch->>'sale_date','')::date else sale_date end,
    shipping_deadline_date=case when p_patch?'shipping_deadline_date' then nullif(p_patch->>'shipping_deadline_date','')::date else shipping_deadline_date end,
    shipping_deadline_raw=case when p_patch?'shipping_deadline_raw' then nullif(btrim(p_patch->>'shipping_deadline_raw'),'') else shipping_deadline_raw end,
    shipped_at=case when p_patch?'shipped_at' then nullif(p_patch->>'shipped_at','')::timestamptz else shipped_at end,
    sale_type=case when p_patch?'sale_type' then nullif(btrim(p_patch->>'sale_type'),'') else sale_type end,
    volume_ml=case when p_patch?'volume_ml' then (p_patch->>'volume_ml')::numeric else volume_ml end,
    volume_ml_raw=case when p_patch?'volume_ml' then p_patch->>'volume_ml' else volume_ml_raw end,
    perfume_id=case when p_patch?'perfume_id' then next_perfume.id else perfume_id end,
    perfume_name_raw=case when p_patch?'perfume_id' then next_perfume.full_name_raw else perfume_name_raw end,
    perfume_base_name=case when p_patch?'perfume_id' then next_perfume.base_name else perfume_base_name end,
    split_completed_at=case
      when p_patch?'split_completed_at' then nullif(p_patch->>'split_completed_at','')::date
      when p_patch?'sale_type' and nullif(btrim(p_patch->>'sale_type'),'')<>'SPLIT' then null
      else split_completed_at end,
    amount=case when p_patch?'amount' then (p_patch->>'amount')::numeric else amount end,
    payment_status=case when p_patch?'payment_status' then (p_patch->>'payment_status')::public.payment_status else payment_status end,
    payment_method=case when p_patch?'payment_method' then nullif(btrim(p_patch->>'payment_method'),'') else payment_method end,
    paid_at=case when p_patch?'paid_at' then nullif(p_patch->>'paid_at','')::date else paid_at end,
    credit_reference_amount=case when p_patch?'credit_reference_amount' then nullif(p_patch->>'credit_reference_amount','')::numeric else credit_reference_amount end,
    notes=case when p_patch?'notes' then nullif(btrim(p_patch->>'notes'),'') else notes end,
    updated_at=now()
   where id=before_row.id returning * into after_row;

  insert into public.audit_logs(organization_id,actor_id,action,entity_type,entity_id,metadata)
  values(before_row.organization_id,auth.uid(),'davi_excel_sale_updated','sale',before_row.id::text,
    jsonb_build_object('sale_id',before_row.id,'changed_fields',changed,'before',to_jsonb(before_row),'after',to_jsonb(after_row),
      'operational',jsonb_build_object('allocation',has_allocation,'preparation',has_preparation,'shipment',has_shipment,'posted',has_posted,'shipment_snapshot_preserved',true)));
  return jsonb_build_object('id',after_row.id,'updated_at',after_row.updated_at,'changed_fields',changed,'shipment_snapshot_preserved',true);
end;$$;
revoke all on function public.davi_excel_update_sale(uuid,jsonb,timestamptz,boolean) from public,anon;
grant execute on function public.davi_excel_update_sale(uuid,jsonb,timestamptz,boolean) to authenticated;

-- 3.3 Read model: expõe client_id, client_number e split_completed_at.
-- A assinatura da RETURNS TABLE muda (novas colunas), então DROP + CREATE.
-- As demais RPCs resolvem davi_excel_dataset por nome em tempo de execução
-- e são republicadas logo abaixo.
drop function if exists public.davi_excel_dataset();
create function public.davi_excel_dataset()
returns table(
 id uuid,client_id uuid,client_number integer,client_name text,sale_date date,shipping_deadline_display text,shipping_deadline_date date,
 shipped_at timestamptz,sale_type text,volume_ml numeric,perfume_name text,split_completed_at date,amount numeric,
 payment_status text,payment_method text,paid_at date,credit_reference_amount numeric,notes text,
 operational_status text,search_reference text
) language sql stable security definer set search_path=public as $$
 select s.id,s.client_id,c.client_number,c.name,s.sale_date,
 case when coalesce(active_shipment.posted_at,s.shipped_at) is not null then 'ENVIADO' when s.payment_status='cancelled' then 'CANCELADO' when s.shipping_available_date is not null and s.shipping_availability_confirmed_at is null then to_char(s.shipping_available_date,'DD/MM/YYYY') else null end,
 s.shipping_available_date,coalesce(active_shipment.posted_at,s.shipped_at),s.sale_type,s.volume_ml,p.full_name_raw,s.split_completed_at,s.amount,s.payment_status::text,s.payment_method,s.paid_at,s.credit_reference_amount,s.notes,
 case when s.payment_status='cancelled' then 'CANCELADO' when coalesce(active_shipment.posted_at,s.shipped_at) is not null then 'ENVIADO' when active_shipment.shipment_id is not null then 'ENVIO EM ANDAMENTO' when active_client.request_id is not null and own_request.request_id is null then 'PRÓXIMO ENVIO' when own_request.request_id is not null then 'ENVIO EM ANDAMENTO' when s.shipping_availability_confirmed_at is null then 'AGUARDANDO PERFUME' when coalesce(prep.prepared_ml,0)<coalesce(a.quantity_ml,s.volume_ml,0) then 'AGUARDANDO PREPARAÇÃO' else 'PRONTO PARA ENVIO' end,
 coalesce(s.import_signature,'')
 from public.sales s
 join public.clients c on c.id=s.client_id and c.organization_id=s.organization_id
 left join public.perfumes p on p.id=s.perfume_id
 left join public.inventory_allocations a on a.sale_id=s.id and a.status in('reserved','shipping','shipped')
 left join lateral(select sum(bi.quantity_ml) prepared_ml from public.preparation_batch_items bi join public.preparation_batches b on b.id=bi.batch_id and b.status='confirmed' where bi.allocation_id=a.id) prep on true
 left join lateral(select sh.id shipment_id,sh.status,sh.posted_at from public.shipment_items si join public.shipments sh on sh.id=si.shipment_id where si.sale_id=s.id and si.removed_at is null and sh.status<>'cancelled' order by sh.created_at desc limit 1) active_shipment on true
 left join lateral(select r.id request_id from public.customer_shipment_request_items ri join public.customer_shipment_requests r on r.id=ri.request_id left join public.shipments sh on sh.id=r.converted_shipment_id where ri.allocation_id=a.id and ((r.status='requested' and r.converted_shipment_id is null) or(r.status='converted' and sh.status not in('posted','delivered','cancelled'))) limit 1) own_request on true
 left join lateral(select r.id request_id from public.customer_shipment_requests r left join public.shipments sh on sh.id=r.converted_shipment_id where r.client_id=s.client_id and ((r.status='requested' and r.converted_shipment_id is null) or(r.status='converted' and sh.status not in('posted','delivered','cancelled'))) limit 1) active_client on true
 where s.organization_id in(select public.current_user_org_ids())
 and public.has_org_permission(s.organization_id,'sales.view') and s.deleted_at is null;
$$;
revoke all on function public.davi_excel_dataset() from public,anon;
grant execute on function public.davi_excel_dataset() to authenticated;

-- 3.4 Lista paginada multi-sort: ordenar por DATA DO SPLIT e filtros
-- SPLITADO (SPLIT + data) / NÃO SPLITADO (SPLIT + sem data). APC nunca é
-- pendência de split.
create or replace function public.davi_excel_list_multi(
 p_filters jsonb default '{}'::jsonb,p_page integer default 0,p_page_size integer default 100,
 p_sorts jsonb default '[{"column":"sale_date","direction":"asc"},{"column":"perfume","direction":"asc"},{"column":"type","direction":"asc"},{"column":"volume","direction":"desc"}]'::jsonb
) returns jsonb language plpgsql stable security definer set search_path=public as $$
declare level jsonb;column_name text;direction text;expression text;order_clause text:='';result jsonb;position integer:=0;
begin
 if jsonb_typeof(p_sorts)<>'array' then raise exception 'invalid_sort';end if;
 for level in select value from jsonb_array_elements(p_sorts) loop
  position:=position+1;if position>5 then exit;end if;
  column_name:=level->>'column';direction:=lower(level->>'direction');
  if direction not in('asc','desc') then raise exception 'invalid_sort_direction';end if;
  expression:=case column_name
   when 'client' then 'public.davi_excel_sort_text(client_name)'
   when 'sale_date' then 'sale_date'
   when 'deadline' then 'shipping_deadline_date'
   when 'shipped_at' then 'shipped_at'
   when 'type' then 'public.davi_excel_sort_text(sale_type)'
   when 'volume' then 'volume_ml'
   when 'perfume' then 'public.davi_excel_sort_text(perfume_name)'
   when 'split_completed_at' then 'split_completed_at'
   when 'amount' then 'amount'
   when 'payment' then 'public.davi_excel_sort_text(payment_status)'
   when 'method' then 'public.davi_excel_sort_text(payment_method)'
   when 'paid_at' then 'paid_at'
   when 'credit' then 'credit_reference_amount'
   when 'notes' then 'public.davi_excel_sort_text(notes)'
   else null end;
  if expression is null then raise exception 'invalid_sort_column';end if;
  order_clause:=order_clause||case when order_clause='' then '' else ',' end||expression||' '||direction||' nulls last';
 end loop;
 if order_clause='' then order_clause:='sale_date asc nulls last,public.davi_excel_sort_text(perfume_name) asc nulls last,public.davi_excel_sort_text(sale_type) asc nulls last,volume_ml desc nulls last';end if;
 execute format($query$
  with filtered as(
   select * from public.davi_excel_dataset() d where
   (coalesce($1->>'search','')='' or d.client_name ilike '%%'||($1->>'search')||'%%' or d.perfume_name ilike '%%'||($1->>'search')||'%%' or d.notes ilike '%%'||($1->>'search')||'%%' or d.search_reference ilike '%%'||($1->>'search')||'%%') and
   (coalesce($1->>'split','all')='all' or ($1->>'split'='completed' and d.sale_type='SPLIT' and d.split_completed_at is not null) or ($1->>'split'='pending' and d.sale_type='SPLIT' and d.split_completed_at is null)) and
   public.davi_excel_filter_matches($1#>'{columns,client}',d.client_name,null,null,'text') and
   public.davi_excel_filter_matches($1#>'{columns,sale_date}',d.sale_date::text,null,d.sale_date,'date') and
   public.davi_excel_filter_matches($1#>'{columns,deadline}',coalesce(d.shipping_deadline_display,d.operational_status),null,d.shipping_deadline_date,'date') and
   public.davi_excel_filter_matches($1#>'{columns,shipped_at}',d.shipped_at::date::text,null,d.shipped_at::date,'date') and
   public.davi_excel_filter_matches($1#>'{columns,type}',d.sale_type,null,null,'text') and
   public.davi_excel_filter_matches($1#>'{columns,volume}',d.volume_ml::text,d.volume_ml,null,'number') and
   public.davi_excel_filter_matches($1#>'{columns,perfume}',d.perfume_name,null,null,'text') and
   public.davi_excel_filter_matches($1#>'{columns,split_completed_at}',d.split_completed_at::text,null,d.split_completed_at,'date') and
   public.davi_excel_filter_matches($1#>'{columns,amount}',d.amount::text,d.amount,null,'number') and
   public.davi_excel_filter_matches($1#>'{columns,payment}',d.payment_status,null,null,'text') and
   public.davi_excel_filter_matches($1#>'{columns,method}',d.payment_method,null,null,'text') and
   public.davi_excel_filter_matches($1#>'{columns,paid_at}',d.paid_at::text,null,d.paid_at,'date') and
   public.davi_excel_filter_matches($1#>'{columns,credit}',d.credit_reference_amount::text,d.credit_reference_amount,null,'number') and
   public.davi_excel_filter_matches($1#>'{columns,notes}',d.notes,null,null,'text')
  ),counted as(select *,count(*)over() total_count from filtered),ordered as(
   select * from counted order by %s,id desc limit $2 offset $3
  ) select jsonb_build_object('rows',coalesce(jsonb_agg(to_jsonb(ordered)-'total_count'-'search_reference'-'shipping_deadline_date'),'[]'::jsonb),'total',coalesce(max(total_count),0)) from ordered
 $query$,order_clause) into result using coalesce(p_filters,'{}'::jsonb),least(greatest(p_page_size,1),500),greatest(p_page,0)*least(greatest(p_page_size,1),500);
 return result;
end;$$;
revoke all on function public.davi_excel_list_multi(jsonb,integer,integer,jsonb) from public,anon;
grant execute on function public.davi_excel_list_multi(jsonb,integer,integer,jsonb) to authenticated;

-- 3.5 Valores distintos: nova coluna filtrável split_completed_at, mantendo o
-- filtro semântico SPLITADO/NÃO SPLITADO ativo nas demais colunas.
create or replace function public.davi_excel_distinct(p_column text,p_filters jsonb default '{}'::jsonb,p_search text default '',p_offset integer default 0,p_limit integer default 200)
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare cleaned jsonb:=coalesce(p_filters,'{}'::jsonb);result jsonb;
begin
 if p_column not in('client','sale_date','deadline','shipped_at','type','volume','perfume','split_completed_at','amount','payment','method','paid_at','credit','notes') then raise exception 'invalid_filter_column';end if;
 cleaned:=jsonb_set(cleaned,'{columns}',coalesce(cleaned->'columns','{}'::jsonb)-p_column,true);
 with filtered as(
  select d.* from public.davi_excel_dataset() d where
  (coalesce(cleaned->>'search','')='' or d.client_name ilike '%'||(cleaned->>'search')||'%' or d.perfume_name ilike '%'||(cleaned->>'search')||'%' or d.notes ilike '%'||(cleaned->>'search')||'%') and
  (coalesce(cleaned->>'split','all')='all' or (cleaned->>'split'='completed' and d.sale_type='SPLIT' and d.split_completed_at is not null) or (cleaned->>'split'='pending' and d.sale_type='SPLIT' and d.split_completed_at is null)) and
  public.davi_excel_filter_matches(cleaned#>'{columns,client}',d.client_name,null,null,'text') and public.davi_excel_filter_matches(cleaned#>'{columns,sale_date}',d.sale_date::text,null,d.sale_date,'date') and public.davi_excel_filter_matches(cleaned#>'{columns,deadline}',coalesce(d.shipping_deadline_display,d.operational_status),null,d.shipping_deadline_date,'date') and public.davi_excel_filter_matches(cleaned#>'{columns,shipped_at}',d.shipped_at::date::text,null,d.shipped_at::date,'date') and public.davi_excel_filter_matches(cleaned#>'{columns,type}',d.sale_type,null,null,'text') and public.davi_excel_filter_matches(cleaned#>'{columns,volume}',d.volume_ml::text,d.volume_ml,null,'number') and public.davi_excel_filter_matches(cleaned#>'{columns,perfume}',d.perfume_name,null,null,'text') and public.davi_excel_filter_matches(cleaned#>'{columns,split_completed_at}',d.split_completed_at::text,null,d.split_completed_at,'date') and public.davi_excel_filter_matches(cleaned#>'{columns,amount}',d.amount::text,d.amount,null,'number') and public.davi_excel_filter_matches(cleaned#>'{columns,payment}',d.payment_status,null,null,'text') and public.davi_excel_filter_matches(cleaned#>'{columns,method}',d.payment_method,null,null,'text') and public.davi_excel_filter_matches(cleaned#>'{columns,paid_at}',d.paid_at::text,null,d.paid_at,'date') and public.davi_excel_filter_matches(cleaned#>'{columns,credit}',d.credit_reference_amount::text,d.credit_reference_amount,null,'number') and public.davi_excel_filter_matches(cleaned#>'{columns,notes}',d.notes,null,null,'text')
 ),valueset as(
  select case p_column when 'client' then client_name when 'sale_date' then sale_date::text when 'deadline' then coalesce(shipping_deadline_display,operational_status) when 'shipped_at' then shipped_at::date::text when 'type' then sale_type when 'volume' then volume_ml::text when 'perfume' then perfume_name when 'split_completed_at' then split_completed_at::text when 'amount' then amount::text when 'payment' then payment_status when 'method' then payment_method when 'paid_at' then paid_at::text when 'credit' then credit_reference_amount::text when 'notes' then notes end value,count(*) amount from filtered group by 1
 ),searched as(select * from valueset where coalesce(value,'') ilike '%'||coalesce(p_search,'')||'%'),windowed as(select *,count(*)over() total_values from searched order by value nulls first limit least(greatest(p_limit,1),250) offset greatest(p_offset,0))
 select jsonb_build_object('values',coalesce(jsonb_agg(jsonb_build_object('value',coalesce(value,'__BLANK__'),'count',amount) order by value nulls first),'[]'::jsonb),'total',coalesce(max(total_values),0),'has_more',coalesce(max(total_values),0)>greatest(p_offset,0)+least(greatest(p_limit,1),250)) into result from windowed;
 return coalesce(result,jsonb_build_object('values','[]'::jsonb,'total',0,'has_more',false));
end;$$;
revoke all on function public.davi_excel_distinct(text,jsonb,text,integer,integer) from public,anon;
grant execute on function public.davi_excel_distinct(text,jsonb,text,integer,integer) to authenticated;

commit;
