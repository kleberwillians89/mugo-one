begin;

-- ============================================================
-- RUAH — Portal da cliente: lado STAFF.
--
-- Fila em "Entregas → Solicitações de clientes" reaproveita task_assignments
-- (extendido em 202608200001) e o RPC task_assign/task_resolve já
-- existentes — nenhuma lógica de atribuição nova, mesmo "reivindicar" já
-- usado por vendas bloqueadas/waitlist/recuperação.
--
-- "COTAR FRETE" cria o shipment real (create_draft_shipment_from_customer_request,
-- abaixo) e a partir daí a equipe usa o fluxo de cotação/aprovação/checkout/
-- postagem já existente e intocado (quoteShipment/select_shipment_quote/
-- claim_superfrete_cart/post_shipment) — nenhum sistema logístico paralelo.
-- Autorização com has_org_role(admin,manager,operator), mesmo patamar que
-- create_draft_shipment já usa hoje (essa função é irmã dela).
-- ============================================================

create or replace function public.create_draft_shipment_from_customer_request(p_request_id uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_request public.customer_shipment_requests; v_client public.clients; v_id uuid; v_count integer;
  v_allocation_ids uuid[]; cfg public.organization_shipping_settings; addr jsonb;
begin
  select * into v_request from public.customer_shipment_requests where id = p_request_id for update;
  if v_request.id is null or not public.has_org_role(v_request.organization_id, array['admin','manager','operator']::public.member_role[])
    then raise exception 'forbidden'; end if;
  if v_request.status <> 'requested' then raise exception 'request_not_pending'; end if;

  select array_agg(allocation_id) into v_allocation_ids from public.customer_shipment_request_items where request_id = v_request.id;
  select * into v_client from public.clients where id = v_request.client_id and deleted_at is null;
  if v_client.id is null then raise exception 'client_not_found'; end if;

  perform id from public.inventory_allocations where id = any(v_allocation_ids) and organization_id = v_request.organization_id
    and client_id = v_request.client_id and status = 'reserved' for update;
  select count(*) into v_count from public.inventory_allocations where id = any(v_allocation_ids)
    and organization_id = v_request.organization_id and client_id = v_request.client_id and status = 'reserved';
  if v_count <> cardinality(v_allocation_ids) or v_count = 0 then raise exception 'invalid_or_unavailable_allocations'; end if;

  select * into cfg from public.organization_shipping_settings where organization_id = v_request.organization_id;
  addr := v_request.address_snapshot;

  -- Endereço vem do SNAPSHOT confirmado pela cliente na solicitação, nunca
  -- do cadastro "ao vivo" em clients — mudanças posteriores no cadastro
  -- nunca alteram silenciosamente um pedido já enviado (briefing explícito).
  insert into public.shipments(
    organization_id, client_id, status, recipient_name, recipient_phone, recipient_document, recipient_email,
    recipient_postal_code, recipient_address, recipient_number, recipient_complement, recipient_district, recipient_city, recipient_state,
    package_weight, package_height, package_width, package_length, package_format, declared_value, notes, created_by
  )
  select v_request.organization_id, v_request.client_id, 'draft',
    coalesce(addr->>'name', v_client.name), coalesce(addr->>'phone', v_client.phone, v_client.whatsapp_phone),
    coalesce(v_client.cpf, v_client.cnpj), v_client.email,
    addr->>'postal_code', addr->>'address_line', addr->>'address_number', addr->>'complement', addr->>'district', addr->>'city', addr->>'state',
    cfg.default_weight, cfg.default_height, cfg.default_width, cfg.default_length, coalesce(cfg.default_format, 'box'),
    coalesce(sum(s.amount), 0), v_request.notes, auth.uid()
  from public.inventory_allocations a join public.sales s on s.id = a.sale_id where a.id = any(v_allocation_ids)
  returning id into v_id;

  insert into public.shipment_items(organization_id, shipment_id, allocation_id, sale_id, quantity_ml)
  select v_request.organization_id, v_id, a.id, a.sale_id, a.quantity_ml from public.inventory_allocations a where a.id = any(v_allocation_ids);

  update public.inventory_allocations set status = 'shipping', shipment_id = v_id, updated_at = now() where id = any(v_allocation_ids);
  insert into public.shipment_events(organization_id, shipment_id, event_type, to_status, actor_id)
    values (v_request.organization_id, v_id, 'shipment_created', 'draft', auth.uid());

  update public.customer_shipment_requests set status = 'converted', converted_shipment_id = v_id, updated_at = now() where id = v_request.id;

  insert into public.audit_logs(organization_id, actor_id, action, entity_type, entity_id, metadata)
  values (v_request.organization_id, auth.uid(), 'customer_shipping_quoted', 'customer_shipment_request', v_request.id::text,
    jsonb_build_object('shipment_id', v_id, 'allocation_count', v_count));

  return v_id;
end;
$$;
revoke all on function public.create_draft_shipment_from_customer_request(uuid) from public, anon;
grant execute on function public.create_draft_shipment_from_customer_request(uuid) to authenticated;

create or replace function public.customer_shipment_requests_queue(org_id uuid)
returns table(
  request_id uuid, client_id uuid, client_name text, status text, requested_at timestamptz,
  item_count bigint, total_ml numeric, items jsonb, assignment_id uuid, assigned_to_name text
)
language sql stable security invoker set search_path = public as $$
  select r.id, r.client_id, c.name, r.status, r.requested_at,
    count(i.id), coalesce(sum(i.quantity_ml), 0),
    jsonb_agg(jsonb_build_object('perfume', p.full_name_raw, 'quantity_ml', i.quantity_ml)),
    ta.id, ta.assigned_to_name_snapshot
  from public.customer_shipment_requests r
  join public.clients c on c.id = r.client_id
  left join public.customer_shipment_request_items i on i.request_id = r.id
  left join public.perfumes p on p.id = i.perfume_id
  left join public.task_assignments ta on ta.organization_id = org_id and ta.entity_type = 'customer_shipment_request'
    and ta.entity_id = r.id and ta.resolved_at is null
  where r.organization_id = org_id and r.status = 'requested'
  group by r.id, c.name, ta.id, ta.assigned_to_name_snapshot
  order by r.requested_at;
$$;
grant execute on function public.customer_shipment_requests_queue(uuid) to authenticated;

create or replace function public.customer_support_tickets_queue(org_id uuid)
returns table(
  ticket_id uuid, client_id uuid, client_name text, category text, description text, status text, created_at timestamptz,
  shipment_id uuid, assignment_id uuid, assigned_to_name text
)
language sql stable security invoker set search_path = public as $$
  select t.id, t.client_id, c.name, t.category, t.description, t.status, t.created_at, t.shipment_id,
    ta.id, ta.assigned_to_name_snapshot
  from public.customer_support_tickets t
  join public.clients c on c.id = t.client_id
  left join public.task_assignments ta on ta.organization_id = org_id and ta.entity_type = 'customer_support_ticket'
    and ta.entity_id = t.id and ta.resolved_at is null
  where t.organization_id = org_id and t.status <> 'resolved'
  order by t.created_at;
$$;
grant execute on function public.customer_support_tickets_queue(uuid) to authenticated;

create or replace function public.customer_support_ticket_resolve(p_ticket_id uuid, p_resolution_note text default null)
returns public.customer_support_tickets
language plpgsql security definer set search_path = public as $$
declare v public.customer_support_tickets;
begin
  select * into v from public.customer_support_tickets where id = p_ticket_id for update;
  if v.id is null or not public.has_org_role(v.organization_id, array['admin','manager','operator']::public.member_role[])
    then raise exception 'forbidden'; end if;
  update public.customer_support_tickets set status = 'resolved', resolved_at = now(), resolved_by = auth.uid() where id = v.id returning * into v;
  update public.task_assignments set resolved_at = now(), resolved_by = auth.uid(), notes = coalesce(p_resolution_note, notes)
    where organization_id = v.organization_id and entity_type = 'customer_support_ticket' and entity_id = v.id and resolved_at is null;
  insert into public.audit_logs(organization_id, actor_id, action, entity_type, entity_id, metadata)
    values (v.organization_id, auth.uid(), 'customer_support_resolved', 'customer_support_ticket', v.id::text, '{}');
  return v;
end;
$$;
revoke all on function public.customer_support_ticket_resolve(uuid, text) from public, anon;
grant execute on function public.customer_support_ticket_resolve(uuid, text) to authenticated;

-- Aba "Portal / Custódia" no Cliente 360.
create or replace function public.client_portal_status(p_client_id uuid)
returns table(
  account_status text, claim_email text, verified_at timestamptz,
  open_requests bigint, open_tickets bigint
)
language sql stable security invoker set search_path = public as $$
  select ca.status, ca.claim_email, ca.verified_at,
    (select count(*) from public.customer_shipment_requests where client_id = p_client_id and status = 'requested'),
    (select count(*) from public.customer_support_tickets where client_id = p_client_id and status <> 'resolved')
  from public.clients c
  left join public.client_accounts ca on ca.client_id = c.id
  where c.id = p_client_id and c.organization_id in (select public.current_user_org_ids());
$$;
grant execute on function public.client_portal_status(uuid) to authenticated;

-- ============================================================
-- Anexos de tickets (Storage). Cada objeto vive em {ticket_id}/{arquivo}
-- (a cliente não precisa saber organization_id) — RLS confere posse via
-- join em customer_support_tickets, mesma filosofia de tenant/ownership do
-- resto do projeto (nunca confia em client_id vindo do navegador).
-- ============================================================
insert into storage.buckets (id, name, public)
values ('customer-support-attachments', 'customer-support-attachments', false)
on conflict (id) do nothing;

create policy customer_support_attachments_customer_insert on storage.objects
  for insert with check (
    bucket_id = 'customer-support-attachments'
    and exists (
      select 1 from public.customer_support_tickets t
      where t.client_id = public.current_customer_client()
        and (storage.foldername(name))[1] = t.id::text
    )
  );
create policy customer_support_attachments_customer_select on storage.objects
  for select using (
    bucket_id = 'customer-support-attachments'
    and exists (
      select 1 from public.customer_support_tickets t
      where t.client_id = public.current_customer_client()
        and (storage.foldername(name))[1] = t.id::text
    )
  );
create policy customer_support_attachments_staff_select on storage.objects
  for select using (
    bucket_id = 'customer-support-attachments'
    and exists (
      select 1 from public.customer_support_tickets t
      where t.organization_id in (select public.current_user_org_ids())
        and (storage.foldername(name))[1] = t.id::text
    )
  );

commit;
