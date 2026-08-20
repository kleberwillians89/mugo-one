begin;

-- ============================================================
-- RUAH — Portal da cliente ("Minha RUAH").
--
-- Auditoria prévia (obrigatória, feita antes de qualquer schema novo):
-- a representação canônica de "esta quantidade deste perfume pertence a
-- esta cliente e ainda está na RUAH" JÁ EXISTE — é
-- public.inventory_allocations com status='reserved' (qualquer
-- allocation_source), já exposta via client_360()/client_waiting_products_v2()
-- e já rotulada "custódia" na própria UI administrativa (ClientDetailsPage,
-- seção "Produtos aguardando envio"). NADA disso é duplicado aqui — o
-- portal lê a mesma tabela, por trás de RPCs novas escopadas ao cliente
-- chamador em vez de à organização do funcionário chamador.
--
-- Decisão de escopo importante (documentada também no relatório final):
-- inventory_allocations tem uma constraint existente
-- (inventory_allocations_active_sale_uidx) que permite NO MÁXIMO UMA
-- allocation ativa por venda. Isso significa que dividir uma única
-- allocation em "10ml agora, 10ml depois" exigiria alterar essa
-- invariante existente — não fiz isso. Uma solicitação de envio sempre
-- pega uma allocation JÁ RESERVADA na ÍNTEGRA (o mesmo grão que a tela
-- administrativa "Preparar envio" já usa). Uma cliente com duas compras
-- separadas de 10ml do mesmo perfume vê "20ml" no total e pode escolher
-- quais das duas linhas incluir num pedido — nunca uma fração arbitrária
-- de uma única linha.
--
-- Cliente final NUNCA vira organization_members. Vínculo separado:
-- client_accounts (auth.users ↔ clients). Toda leitura/escrita do portal
-- passa por RPC SECURITY DEFINER que resolve client_id a partir de
-- auth.uid() — nunca de um client_id vindo do navegador — mesmo padrão de
-- bloqueio total de grant direto já usado em shipments/allocations/bottles.

-- ============================================================
-- 1. client_accounts — vínculo auth.users ↔ clients
-- ============================================================
create table public.client_accounts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  client_id uuid not null references public.clients(id) on delete cascade,
  auth_user_id uuid references auth.users(id) on delete set null,
  status text not null default 'pending_verification' check (status in ('pending_verification','active','disabled')),
  claim_email text,
  last_invited_at timestamptz,
  created_at timestamptz not null default now(),
  verified_at timestamptz,
  updated_at timestamptz not null default now()
);
create unique index client_accounts_client_uidx on public.client_accounts(client_id);
create unique index client_accounts_auth_user_uidx on public.client_accounts(auth_user_id) where auth_user_id is not null;
create index client_accounts_org_idx on public.client_accounts(organization_id);

alter table public.client_accounts enable row level security;
-- Só staff (leitura, aba "Portal" no Cliente 360) — nunca o próprio
-- cliente lendo a linha bruta; o cliente é servido por RPCs abaixo.
create policy client_accounts_staff_select on public.client_accounts
  for select using (organization_id in (select public.current_user_org_ids()));
revoke insert, update, delete on public.client_accounts from authenticated;

-- Resolve o client_id do CHAMADOR autenticado — nunca aceita client_id por
-- parâmetro. Autoridade única para todo RPC "customer_*" abaixo, mesmo
-- papel que has_org_permission tem para o staff.
create or replace function public.current_customer_client()
returns uuid language sql stable security definer set search_path = public as $$
  select client_id from public.client_accounts where auth_user_id = auth.uid() and status = 'active';
$$;
grant execute on function public.current_customer_client() to authenticated;

-- ============================================================
-- 2. Solicitações de envio da cliente
-- ============================================================
create table public.customer_shipment_requests (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  client_id uuid not null references public.clients(id) on delete cascade,
  status text not null default 'requested' check (status in ('requested','converted','cancelled')),
  address_snapshot jsonb not null,
  notes text,
  requested_at timestamptz not null default now(),
  cancelled_at timestamptz,
  converted_shipment_id uuid references public.shipments(id),
  created_by_auth_user_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index customer_shipment_requests_org_idx on public.customer_shipment_requests(organization_id,status,requested_at desc);
create index customer_shipment_requests_client_idx on public.customer_shipment_requests(client_id,requested_at desc);

create table public.customer_shipment_request_items (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references public.customer_shipment_requests(id) on delete cascade,
  allocation_id uuid not null references public.inventory_allocations(id),
  perfume_id uuid not null references public.perfumes(id),
  quantity_ml numeric(14,3) not null check (quantity_ml > 0),
  created_at timestamptz not null default now(),
  unique(request_id, allocation_id)
);
create index customer_shipment_request_items_allocation_idx on public.customer_shipment_request_items(allocation_id);

alter table public.customer_shipment_requests enable row level security;
alter table public.customer_shipment_request_items enable row level security;
create policy customer_shipment_requests_staff_select on public.customer_shipment_requests
  for select using (organization_id in (select public.current_user_org_ids()));
create policy customer_shipment_request_items_staff_select on public.customer_shipment_request_items
  for select using (request_id in (select id from public.customer_shipment_requests where organization_id in (select public.current_user_org_ids())));
revoke insert, update, delete on public.customer_shipment_requests from authenticated;
revoke insert, update, delete on public.customer_shipment_request_items from authenticated;

-- ============================================================
-- 3. Tickets de suporte ("Preciso de ajuda")
-- ============================================================
create table public.customer_support_tickets (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  client_id uuid not null references public.clients(id) on delete cascade,
  shipment_id uuid references public.shipments(id),
  request_id uuid references public.customer_shipment_requests(id),
  category text not null check (category in (
    'wrong_item','missing_item','damaged_item','delivery_problem','wrong_quantity','other'
  )),
  description text not null check (btrim(description) <> ''),
  status text not null default 'open' check (status in ('open','in_progress','resolved')),
  created_at timestamptz not null default now(),
  resolved_at timestamptz,
  resolved_by uuid references public.profiles(id)
);
create index customer_support_tickets_org_idx on public.customer_support_tickets(organization_id,status,created_at desc);
create index customer_support_tickets_client_idx on public.customer_support_tickets(client_id,created_at desc);

alter table public.customer_support_tickets enable row level security;
create policy customer_support_tickets_staff_select on public.customer_support_tickets
  for select using (organization_id in (select public.current_user_org_ids()));
revoke insert, update, delete on public.customer_support_tickets from authenticated;

-- ============================================================
-- 4. Fila de tarefas — reaproveita task_assignments (Fase 5 já existente),
--    só estende o enum fechado de entity_type. Nenhuma lógica de
--    atribuição nova: mesma regra de "reivindicar" já usada por
--    blocked_sale/waitlist_item/customer_recovery via task_assign/task_resolve.
-- ============================================================
alter table public.task_assignments drop constraint task_assignments_entity_type_check;
alter table public.task_assignments add constraint task_assignments_entity_type_check
  check (entity_type in (
    'blocked_sale','waitlist_item','customer_recovery',
    'customer_shipment_request','customer_support_ticket'
  ));

-- ============================================================
-- 5. RPCs — lado CLIENTE (current_customer_client() é a única autoridade)
-- ============================================================

-- "Meus perfumes": uma linha por allocation reservada da cliente, com o
-- quanto já está preso numa solicitação ativa dela mesma (nunca aparece
-- vendável de novo para outra pessoa — allocation continua 'reserved' até
-- a conversão real em shipment). Nomes 100% humanos, nada de jargão.
create or replace function public.customer_custody()
returns table(
  allocation_id uuid, perfume_id uuid, perfume_name text,
  quantity_ml numeric, sale_date date, requested boolean, request_id uuid
)
language sql stable security definer set search_path = public as $$
  select a.id, a.perfume_id, p.full_name_raw, a.quantity_ml, s.sale_date,
    (i.id is not null) as requested, i.request_id
  from public.inventory_allocations a
  join public.perfumes p on p.id = a.perfume_id
  join public.sales s on s.id = a.sale_id
  left join public.customer_shipment_request_items i
    on i.allocation_id = a.id
    and i.request_id in (select id from public.customer_shipment_requests where status <> 'cancelled')
  where a.client_id = public.current_customer_client() and a.status = 'reserved'
  order by p.full_name_raw, s.sale_date;
$$;
grant execute on function public.customer_custody() to authenticated;

-- Cria a solicitação de forma transacional/idempotente: trava as
-- allocations (mesmo padrão de create_draft_shipment), rejeita qualquer
-- uma que já esteja numa solicitação ativa (concorrência/duplo clique —
-- nunca confia só no frontend), nunca toca inventory_allocations,
-- shipments, physical_ml ou available_ml.
create or replace function public.customer_shipment_request_create(
  p_allocation_ids uuid[],
  p_address jsonb,
  p_notes text default null
) returns public.customer_shipment_requests
language plpgsql security definer set search_path = public as $$
declare
  v_client_id uuid; v_org uuid; v_count integer; v_conflict integer; v_request public.customer_shipment_requests;
begin
  v_client_id := public.current_customer_client();
  if v_client_id is null then raise exception 'forbidden'; end if;
  if p_allocation_ids is null or cardinality(p_allocation_ids) = 0 then raise exception 'no_items_selected'; end if;
  select organization_id into v_org from public.clients where id = v_client_id;

  perform 1 from public.inventory_allocations
    where id = any(p_allocation_ids) and client_id = v_client_id and status = 'reserved' for update;

  select count(*) into v_count from public.inventory_allocations
    where id = any(p_allocation_ids) and client_id = v_client_id and status = 'reserved';
  if v_count <> cardinality(p_allocation_ids) then raise exception 'invalid_or_unavailable_custody'; end if;

  select count(*) into v_conflict from public.customer_shipment_request_items i
    join public.customer_shipment_requests r on r.id = i.request_id
    where i.allocation_id = any(p_allocation_ids) and r.status <> 'cancelled';
  if v_conflict > 0 then raise exception 'already_requested'; end if;

  if coalesce(btrim(p_address->>'postal_code'), '') = '' or coalesce(btrim(p_address->>'address_line'), '') = ''
    or coalesce(btrim(p_address->>'city'), '') = '' or coalesce(btrim(p_address->>'state'), '') = '' then
    raise exception 'incomplete_address';
  end if;

  insert into public.customer_shipment_requests(organization_id, client_id, address_snapshot, notes, created_by_auth_user_id)
  values (v_org, v_client_id, p_address, nullif(btrim(p_notes), ''), auth.uid())
  returning * into v_request;

  insert into public.customer_shipment_request_items(request_id, allocation_id, perfume_id, quantity_ml)
  select v_request.id, a.id, a.perfume_id, a.quantity_ml
  from public.inventory_allocations a where a.id = any(p_allocation_ids);

  insert into public.audit_logs(organization_id, actor_id, action, entity_type, entity_id, metadata)
  values (v_org, auth.uid(), 'customer_shipment_requested', 'customer_shipment_request', v_request.id::text,
    jsonb_build_object('client_id', v_client_id, 'allocation_count', v_count));

  return v_request;
end;
$$;
grant execute on function public.customer_shipment_request_create(uuid[], jsonb, text) to authenticated;

create or replace function public.customer_shipment_request_cancel(p_request_id uuid)
returns public.customer_shipment_requests
language plpgsql security definer set search_path = public as $$
declare v_client_id uuid; v public.customer_shipment_requests;
begin
  v_client_id := public.current_customer_client();
  if v_client_id is null then raise exception 'forbidden'; end if;
  select * into v from public.customer_shipment_requests where id = p_request_id and client_id = v_client_id for update;
  if v.id is null then raise exception 'request_not_found'; end if;
  if v.status = 'converted' then raise exception 'request_already_in_progress'; end if;
  update public.customer_shipment_requests set status = 'cancelled', cancelled_at = now(), updated_at = now()
    where id = v.id returning * into v;
  insert into public.audit_logs(organization_id, actor_id, action, entity_type, entity_id, metadata)
  values (v.organization_id, auth.uid(), 'customer_request_cancelled', 'customer_shipment_request', v.id::text, '{}');
  return v;
end;
$$;
grant execute on function public.customer_shipment_request_cancel(uuid) to authenticated;

-- Lista as solicitações da cliente com os itens (nomes de perfume, ml) e,
-- quando já convertida, o status/rastreio do shipment real (fonte única
-- de verdade — não existe um segundo campo de status duplicado aqui).
create or replace function public.customer_shipment_requests_list()
returns table(
  request_id uuid, status text, requested_at timestamptz, cancelled_at timestamptz,
  items jsonb, converted_shipment_id uuid, shipment_status public.shipment_status,
  awaiting_approval boolean, shipping_price numeric, tracking_code text,
  posted_at timestamptz, delivered_at timestamptz
)
language sql stable security definer set search_path = public as $$
  select r.id, r.status, r.requested_at, r.cancelled_at,
    (select jsonb_agg(jsonb_build_object('perfume', p.full_name_raw, 'quantity_ml', i.quantity_ml))
       from public.customer_shipment_request_items i join public.perfumes p on p.id = i.perfume_id
       where i.request_id = r.id),
    r.converted_shipment_id, sh.status, (sh.status = 'awaiting_customer_approval'), sh.shipping_price,
    sh.tracking_code, sh.posted_at, sh.delivered_at
  from public.customer_shipment_requests r
  left join public.shipments sh on sh.id = r.converted_shipment_id
  where r.client_id = public.current_customer_client()
  order by r.requested_at desc;
$$;
grant execute on function public.customer_shipment_requests_list() to authenticated;

-- Cliente aceita o frete já cotado pela equipe — mesmo efeito de
-- approve_shipment_for_label (staff), mas a autorização é "sou dona deste
-- pedido", não has_org_role. NÃO chama checkout/SuperFrete, NÃO baixa
-- estoque — só troca o shipment para customer_approved, exatamente como o
-- fluxo staff-only já fazia manualmente por telefone/WhatsApp.
create or replace function public.customer_shipment_request_confirm(p_request_id uuid)
returns public.customer_shipment_requests
language plpgsql security definer set search_path = public as $$
declare v_client_id uuid; v_request public.customer_shipment_requests; v_shipment public.shipments;
begin
  v_client_id := public.current_customer_client();
  if v_client_id is null then raise exception 'forbidden'; end if;
  select * into v_request from public.customer_shipment_requests where id = p_request_id and client_id = v_client_id for update;
  if v_request.id is null or v_request.converted_shipment_id is null then raise exception 'request_not_ready'; end if;
  select * into v_shipment from public.shipments where id = v_request.converted_shipment_id for update;
  if v_shipment.status <> 'awaiting_customer_approval' or v_shipment.selected_quote_id is null then
    raise exception 'quote_not_available';
  end if;
  update public.shipments set status = 'customer_approved', customer_approved_at = now(), approved_by = auth.uid(), updated_at = now()
    where id = v_shipment.id;
  insert into public.shipment_events(organization_id, shipment_id, event_type, from_status, to_status, actor_id)
    values (v_shipment.organization_id, v_shipment.id, 'customer_approved', 'awaiting_customer_approval', 'customer_approved', auth.uid());
  insert into public.audit_logs(organization_id, actor_id, action, entity_type, entity_id, metadata)
    values (v_shipment.organization_id, auth.uid(), 'customer_shipping_confirmed', 'shipment', v_shipment.id::text,
      jsonb_build_object('request_id', v_request.id, 'shipping_price', v_shipment.shipping_price));
  return v_request;
end;
$$;
grant execute on function public.customer_shipment_request_confirm(uuid) to authenticated;

-- Histórico: compras != recebimentos, mostrados como duas listas
-- separadas e nunca confundidas (briefing explícito).
create or replace function public.customer_purchase_history()
returns table(sale_id uuid, sale_date date, perfume_name text, quantity_ml numeric, amount numeric)
language sql stable security definer set search_path = public as $$
  select s.id, s.sale_date, p.full_name_raw, s.volume_ml, s.amount
  from public.sales s left join public.perfumes p on p.id = s.perfume_id
  where s.client_id = public.current_customer_client() and s.deleted_at is null and s.payment_status = 'paid'
  order by s.sale_date desc nulls last;
$$;
grant execute on function public.customer_purchase_history() to authenticated;

create or replace function public.customer_delivery_history()
returns table(shipment_id uuid, status public.shipment_status, tracking_code text, posted_at timestamptz, delivered_at timestamptz, items jsonb)
language sql stable security definer set search_path = public as $$
  select sh.id, sh.status, sh.tracking_code, sh.posted_at, sh.delivered_at,
    (select jsonb_agg(jsonb_build_object('perfume', p.full_name_raw, 'quantity_ml', si.quantity_ml))
       from public.shipment_items si
       join public.inventory_allocations a2 on a2.id = si.allocation_id
       join public.perfumes p on p.id = a2.perfume_id
       where si.shipment_id = sh.id and si.removed_at is null)
  from public.shipments sh
  where sh.client_id = public.current_customer_client() and sh.status in ('posted','delivered')
  order by coalesce(sh.delivered_at, sh.posted_at) desc;
$$;
grant execute on function public.customer_delivery_history() to authenticated;

create or replace function public.customer_profile()
returns table(name text, email text, phone text, cpf_masked text,
  postal_code text, address_line text, address_number text, complement text, district text, city text, state text)
language sql stable security definer set search_path = public as $$
  select c.name, c.email, coalesce(c.phone, c.whatsapp_phone),
    case when length(coalesce(c.normalized_cpf,'')) = 11
      then '***.***.***-' || right(c.normalized_cpf, 2) else null end,
    c.postal_code, c.address_line, c.address_number, c.complement, c.district, c.city, c.state
  from public.clients c where c.id = public.current_customer_client();
$$;
grant execute on function public.customer_profile() to authenticated;

create or replace function public.customer_support_ticket_create(
  p_category text, p_description text, p_shipment_id uuid default null, p_request_id uuid default null
) returns public.customer_support_tickets
language plpgsql security definer set search_path = public as $$
declare v_client_id uuid; v_org uuid; v_row public.customer_support_tickets;
begin
  v_client_id := public.current_customer_client();
  if v_client_id is null then raise exception 'forbidden'; end if;
  select organization_id into v_org from public.clients where id = v_client_id;
  if p_shipment_id is not null and not exists(select 1 from public.shipments where id = p_shipment_id and client_id = v_client_id) then
    raise exception 'shipment_not_found';
  end if;
  if p_request_id is not null and not exists(select 1 from public.customer_shipment_requests where id = p_request_id and client_id = v_client_id) then
    raise exception 'request_not_found';
  end if;
  insert into public.customer_support_tickets(organization_id, client_id, shipment_id, request_id, category, description)
  values (v_org, v_client_id, p_shipment_id, p_request_id, p_category, p_description)
  returning * into v_row;
  insert into public.audit_logs(organization_id, actor_id, action, entity_type, entity_id, metadata)
  values (v_org, auth.uid(), 'customer_support_opened', 'customer_support_ticket', v_row.id::text, jsonb_build_object('category', p_category));
  return v_row;
end;
$$;
grant execute on function public.customer_support_ticket_create(text, text, uuid, uuid) to authenticated;

create or replace function public.customer_support_tickets_list()
returns table(id uuid, category text, description text, status text, created_at timestamptz, resolved_at timestamptz)
language sql stable security definer set search_path = public as $$
  select id, category, description, status, created_at, resolved_at
  from public.customer_support_tickets where client_id = public.current_customer_client()
  order by created_at desc;
$$;
grant execute on function public.customer_support_tickets_list() to authenticated;

commit;
