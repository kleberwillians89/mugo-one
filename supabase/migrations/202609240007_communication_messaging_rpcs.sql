begin;

-- ============================================================
-- MUGÔ ONE — Sprint N (Communication Hub Universal)
--
-- send_communication_message: cria/reaproveita a conversation e insere
-- a message em 'queued'. NÃO faz a chamada HTTP ao provider — isso
-- acontece na Edge Function (send-email), que chama esta RPC primeiro
-- e depois public.update_message_delivery_status com o resultado
-- (mesma separação de responsabilidade de todo o resto do projeto:
-- HTTP de provider sempre em Edge Function, nunca em SQL — ver
-- docs/COMMUNICATION_HUB_MIGRATION_PLAN.md §3).
--
-- Chamável por: usuário autenticado com communications.send (fluxo
-- normal) OU service_role (chamada pela própria Edge Function depois
-- de já ter validado a sessão do usuário — evita checar permissão
-- duas vezes com contexto de auth diferente).
-- ============================================================

create or replace function public.send_communication_message(
  p_organization_id uuid,
  p_channel text,
  p_connection_id uuid,
  p_customer_id uuid default null,
  p_company_id uuid default null,
  p_contact_id uuid default null,
  p_lead_id uuid default null,
  p_conversation_id uuid default null,
  p_recipient_identity text default null,
  p_subject text default null,
  p_body_text text default null,
  p_provider text default 'resend'
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_resolved jsonb;
  v_conversation_id uuid;
  v_recipient text := nullif(btrim(coalesce(p_recipient_identity, '')), '');
  v_sender text;
  v_message_id uuid;
begin
  if auth.role() <> 'service_role' and not public.has_org_permission(p_organization_id, 'communications.send') then
    raise exception 'forbidden';
  end if;
  if coalesce(btrim(p_body_text), '') = '' then
    raise exception 'message_body_required';
  end if;
  if p_connection_id is not null and not exists (
    select 1 from public.communication_connections where id = p_connection_id and organization_id = p_organization_id
  ) then
    raise exception 'connection_organization_mismatch';
  end if;

  -- Resolve destinatário quando não informado manualmente: usa o
  -- e-mail/telefone já cadastrado na entidade vinculada (briefing §62
  -- "usar e-mail conhecido ou permitir informar e-mail manual").
  if v_recipient is null then
    if p_channel = 'email' then
      if p_customer_id is not null then select email into v_recipient from public.clients where id = p_customer_id;
      elsif p_contact_id is not null then select email into v_recipient from public.contacts where id = p_contact_id;
      elsif p_lead_id is not null then select email into v_recipient from public.leads where id = p_lead_id;
      end if;
    elsif p_channel = 'whatsapp' or p_channel = 'sms' then
      if p_customer_id is not null then select coalesce(whatsapp_phone, phone) into v_recipient from public.clients where id = p_customer_id;
      elsif p_contact_id is not null then select whatsapp_phone into v_recipient from public.contacts where id = p_contact_id;
      elsif p_lead_id is not null then select coalesce(whatsapp, phone) into v_recipient from public.leads where id = p_lead_id;
      end if;
    end if;
  end if;
  if v_recipient is null then
    raise exception 'recipient_required';
  end if;

  if p_connection_id is not null then
    select configuration->>'from_email' into v_sender from public.communication_connections where id = p_connection_id;
  end if;

  v_resolved := public.resolve_or_create_conversation(
    p_organization_id, p_channel, p_customer_id, p_company_id, p_contact_id, p_lead_id, p_connection_id, p_subject, p_conversation_id
  );
  v_conversation_id := (v_resolved->>'conversation_id')::uuid;

  insert into public.messages (
    organization_id, conversation_id, direction, channel, message_type,
    body_text, provider, sender_identity, recipient_identity, status
  ) values (
    p_organization_id, v_conversation_id, 'outbound', p_channel, 'text',
    p_body_text, p_provider, v_sender, v_recipient, 'queued'
  ) returning id into v_message_id;

  update public.conversations
  set last_message_at = now(), last_outbound_at = now(), subject = coalesce(subject, p_subject)
  where id = v_conversation_id;

  return jsonb_build_object('conversation_id', v_conversation_id, 'message_id', v_message_id, 'recipient_identity', v_recipient, 'sender_identity', v_sender);
end;
$$;

revoke all on function public.send_communication_message(uuid, text, uuid, uuid, uuid, uuid, uuid, uuid, text, text, text, text) from public, anon;
grant execute on function public.send_communication_message(uuid, text, uuid, uuid, uuid, uuid, uuid, uuid, text, text, text, text) to authenticated, service_role;

-- ============================================================
-- update_message_delivery_status: única forma de mudar o status de
-- uma message depois de criada. Aceita p_message_id (fluxo normal de
-- envio, id já conhecido) OU (p_provider + p_provider_message_id)
-- (webhook do provider, que não conhece nosso message_id interno —
-- resolve por provider_message_id, nunca confiando em organization_id
-- do payload — briefing §40). service_role only.
-- ============================================================

create or replace function public.update_message_delivery_status(
  p_message_id uuid default null,
  p_provider text default null,
  p_provider_message_id text default null,
  p_status text default null,
  p_error_code text default null,
  p_error_message text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_message public.messages;
  v_rank_current int;
  v_rank_new int;
  v_ranks jsonb := '{"queued":0,"sent":1,"delivered":2,"read":3,"failed":9,"received":9}'::jsonb;
begin
  if auth.role() <> 'service_role' then
    raise exception 'permission_denied' using errcode = '42501';
  end if;
  if p_status is null or not (p_status = any(array['queued','sent','delivered','read','failed','received'])) then
    raise exception 'invalid_status';
  end if;

  if p_message_id is not null then
    select * into v_message from public.messages where id = p_message_id;
  elsif p_provider is not null and p_provider_message_id is not null then
    select * into v_message from public.messages where provider = p_provider and provider_message_id = p_provider_message_id;
  end if;

  if v_message.id is null then
    -- Idempotente/silencioso: um webhook atrasado/duplicado para uma
    -- message que não existe (ou já foi limpa) não pode derrubar o
    -- endpoint público — devolve not_found, não uma exceção.
    return jsonb_build_object('status', 'not_found');
  end if;

  v_rank_current := coalesce((v_ranks->>v_message.status)::int, 0);
  v_rank_new := coalesce((v_ranks->>p_status)::int, 0);
  if v_rank_new < v_rank_current and v_message.status not in ('failed') then
    -- Nunca regride um status que já avançou (ex.: 'delivered' não
    -- pode voltar a 'sent' por causa de reentrega fora de ordem do
    -- webhook) — idempotência real, não só "não duplica linha".
    return jsonb_build_object('status', 'ignored_out_of_order', 'message_id', v_message.id, 'conversation_id', v_message.conversation_id);
  end if;

  update public.messages set
    status = p_status,
    provider_message_id = coalesce(p_provider_message_id, provider_message_id),
    sent_at = case when p_status = 'sent' and sent_at is null then now() else sent_at end,
    delivered_at = case when p_status = 'delivered' and delivered_at is null then now() else delivered_at end,
    read_at = case when p_status = 'read' and read_at is null then now() else read_at end,
    failed_at = case when p_status = 'failed' and failed_at is null then now() else failed_at end,
    error_code = case when p_status = 'failed' then p_error_code else error_code end,
    error_message = case when p_status = 'failed' then p_error_message else error_message end
  where id = v_message.id;

  return jsonb_build_object('status', 'updated', 'message_id', v_message.id, 'conversation_id', v_message.conversation_id);
end;
$$;

revoke all on function public.update_message_delivery_status(uuid, text, text, text, text, text) from public, anon, authenticated;
grant execute on function public.update_message_delivery_status(uuid, text, text, text, text, text) to service_role;

-- ============================================================
-- simulate_inbound_message: caminho de QA (briefing §19) — nunca
-- exposto como opção real de provider na UI de Conexões. Reaproveita
-- resolve_or_create_conversation; gera touchpoint no customer/lead
-- vinculado quando existir (briefing §36), nunca duplica o corpo da
-- mensagem em outro lugar.
-- ============================================================

create or replace function public.simulate_inbound_message(
  p_organization_id uuid,
  p_channel text,
  p_customer_id uuid default null,
  p_company_id uuid default null,
  p_contact_id uuid default null,
  p_lead_id uuid default null,
  p_conversation_id uuid default null,
  p_body_text text default null,
  p_provider text default 'mock',
  p_provider_message_id text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_resolved jsonb;
  v_conversation_id uuid;
  v_message_id uuid;
  v_touchpoint_entity_type text;
  v_touchpoint_entity_id uuid;
begin
  if not public.has_org_permission(p_organization_id, 'communications.send') then
    raise exception 'forbidden';
  end if;
  if coalesce(btrim(p_body_text), '') = '' then
    raise exception 'message_body_required';
  end if;

  v_resolved := public.resolve_or_create_conversation(
    p_organization_id, p_channel, p_customer_id, p_company_id, p_contact_id, p_lead_id, null, null, p_conversation_id
  );
  v_conversation_id := (v_resolved->>'conversation_id')::uuid;

  insert into public.messages (
    organization_id, conversation_id, direction, channel, message_type,
    body_text, provider, provider_message_id, status
  ) values (
    p_organization_id, v_conversation_id, 'inbound', p_channel, 'text',
    p_body_text, p_provider, p_provider_message_id, 'received'
  ) returning id into v_message_id;

  update public.conversations
  set last_message_at = now(), last_inbound_at = now(), unread_count = unread_count + 1
  where id = v_conversation_id;

  select customer_id, company_id, contact_id, lead_id
    into p_customer_id, p_company_id, p_contact_id, p_lead_id
  from public.conversations where id = v_conversation_id;

  v_touchpoint_entity_type := case when p_customer_id is not null then 'customer' when p_lead_id is not null then 'lead'
    when p_contact_id is not null then 'contact' when p_company_id is not null then 'company' else null end;
  v_touchpoint_entity_id := coalesce(p_customer_id, p_lead_id, p_contact_id, p_company_id);

  if v_touchpoint_entity_type is not null then
    insert into public.touchpoints (organization_id, entity_type, entity_id, lead_id, channel, provider, event_type, occurred_at)
    values (p_organization_id, v_touchpoint_entity_type, v_touchpoint_entity_id, p_lead_id, p_channel, p_provider, 'inbound_message', now());
  end if;

  return jsonb_build_object('conversation_id', v_conversation_id, 'message_id', v_message_id);
end;
$$;

revoke all on function public.simulate_inbound_message(uuid, text, uuid, uuid, uuid, uuid, uuid, text, text, text) from public, anon;
grant execute on function public.simulate_inbound_message(uuid, text, uuid, uuid, uuid, uuid, uuid, text, text, text) to authenticated;

-- ============================================================
-- Mutações simples de conversa: assign/status/read — mesmo padrão de
-- concorrência otimista do Task Engine (*_stale).
-- ============================================================

create or replace function public.assign_conversation(
  p_conversation_id uuid,
  p_assignee_user_id uuid,
  p_expected_updated_at timestamptz
)
returns public.conversations
language plpgsql
security definer
set search_path = public
as $$
declare
  v_conversation public.conversations;
begin
  select * into v_conversation from public.conversations where id = p_conversation_id;
  if not found then raise exception 'conversation_not_found'; end if;
  if not public.has_org_permission(v_conversation.organization_id, 'communications.assign') then
    raise exception 'forbidden';
  end if;
  if v_conversation.updated_at <> p_expected_updated_at then
    raise exception 'conversation_stale';
  end if;

  update public.conversations set assigned_user_id = p_assignee_user_id
  where id = p_conversation_id
  returning * into v_conversation;

  return v_conversation;
end;
$$;

create or replace function public.set_conversation_status(
  p_conversation_id uuid,
  p_new_status text,
  p_expected_updated_at timestamptz
)
returns public.conversations
language plpgsql
security definer
set search_path = public
as $$
declare
  v_conversation public.conversations;
begin
  if p_new_status not in ('open', 'pending', 'closed') then
    raise exception 'invalid_status';
  end if;
  select * into v_conversation from public.conversations where id = p_conversation_id;
  if not found then raise exception 'conversation_not_found'; end if;
  if not public.has_org_permission(v_conversation.organization_id, 'communications.send') then
    raise exception 'forbidden';
  end if;
  if v_conversation.updated_at <> p_expected_updated_at then
    raise exception 'conversation_stale';
  end if;

  update public.conversations
  set status = p_new_status,
      closed_at = case when p_new_status = 'closed' then now() else null end
  where id = p_conversation_id
  returning * into v_conversation;

  perform public.log_activity(
    v_conversation.organization_id, 'conversation', v_conversation.id,
    case when p_new_status = 'closed' then 'conversation_closed' else 'conversation_reopened' end,
    auth.uid(), case when p_new_status = 'closed' then 'Conversa fechada' else 'Conversa reaberta' end,
    null, '{}'::jsonb
  );

  return v_conversation;
end;
$$;

create or replace function public.mark_conversation_read(p_conversation_id uuid)
returns public.conversations
language plpgsql
security definer
set search_path = public
as $$
declare
  v_conversation public.conversations;
begin
  select * into v_conversation from public.conversations where id = p_conversation_id;
  if not found then raise exception 'conversation_not_found'; end if;
  if not public.has_org_permission(v_conversation.organization_id, 'communications.view') then
    raise exception 'forbidden';
  end if;

  update public.conversations set unread_count = 0
  where id = p_conversation_id
  returning * into v_conversation;

  return v_conversation;
end;
$$;

revoke all on function public.assign_conversation(uuid, uuid, timestamptz) from public, anon;
grant execute on function public.assign_conversation(uuid, uuid, timestamptz) to authenticated;
revoke all on function public.set_conversation_status(uuid, text, timestamptz) from public, anon;
grant execute on function public.set_conversation_status(uuid, text, timestamptz) to authenticated;
revoke all on function public.mark_conversation_read(uuid) from public, anon;
grant execute on function public.mark_conversation_read(uuid) to authenticated;

commit;
