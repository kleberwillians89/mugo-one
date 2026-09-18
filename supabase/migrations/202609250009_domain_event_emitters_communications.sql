begin;

create or replace function public.resolve_or_create_conversation(
  p_organization_id uuid, p_channel text, p_customer_id uuid, p_company_id uuid, p_contact_id uuid,
  p_lead_id uuid, p_connection_id uuid, p_subject text, p_conversation_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_conversation public.conversations;
  v_is_new boolean := false;
begin
  if p_conversation_id is not null then
    select * into v_conversation from public.conversations
    where id = p_conversation_id and organization_id = p_organization_id;
    if not found then
      raise exception 'conversation_not_found';
    end if;
    return jsonb_build_object('conversation_id', v_conversation.id, 'is_new', false);
  end if;

  select * into v_conversation from public.conversations
  where organization_id = p_organization_id
    and channel = p_channel
    and status in ('open', 'pending')
    and customer_id is not distinct from p_customer_id
    and company_id is not distinct from p_company_id
    and contact_id is not distinct from p_contact_id
    and lead_id is not distinct from p_lead_id
  order by updated_at desc
  limit 1;

  if found then
    return jsonb_build_object('conversation_id', v_conversation.id, 'is_new', false);
  end if;

  insert into public.conversations (
    organization_id, channel, customer_id, company_id, contact_id, lead_id, connection_id, subject
  ) values (
    p_organization_id, p_channel, p_customer_id, p_company_id, p_contact_id, p_lead_id, p_connection_id, p_subject
  ) returning * into v_conversation;
  v_is_new := true;

  perform public.log_activity(
    p_organization_id, 'conversation', v_conversation.id, 'conversation_started', auth.uid(),
    'Conversa iniciada', p_subject,
    jsonb_build_object('channel', p_channel)
  );

  perform public.emit_domain_event(
    p_organization_id, 'conversation.created', 'conversation', v_conversation.id,
    jsonb_build_object('conversation_id', v_conversation.id, 'channel', p_channel, 'customer_id', p_customer_id, 'lead_id', p_lead_id),
    'resolve_or_create_conversation', auth.uid(), null, null
  );

  return jsonb_build_object('conversation_id', v_conversation.id, 'is_new', v_is_new);
end;
$$;

create or replace function public.set_conversation_status(p_conversation_id uuid, p_new_status text, p_expected_updated_at timestamptz)
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

  if p_new_status = 'closed' then
    perform public.emit_domain_event(
      v_conversation.organization_id, 'conversation.closed', 'conversation', v_conversation.id,
      jsonb_build_object('conversation_id', v_conversation.id),
      'set_conversation_status', auth.uid(), null, null
    );
  end if;

  return v_conversation;
end;
$$;

create or replace function public.simulate_inbound_message(
  p_organization_id uuid, p_channel text, p_customer_id uuid default null, p_company_id uuid default null,
  p_contact_id uuid default null, p_lead_id uuid default null, p_conversation_id uuid default null,
  p_body_text text default null, p_provider text default 'mock', p_provider_message_id text default null
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

  -- Payload mínimo (briefing §43) — nunca o corpo da mensagem.
  perform public.emit_domain_event(
    p_organization_id, 'message.received', 'conversation', v_conversation_id,
    jsonb_build_object('message_id', v_message_id, 'conversation_id', v_conversation_id, 'customer_id', p_customer_id, 'lead_id', p_lead_id, 'channel', p_channel),
    'simulate_inbound_message', auth.uid(), null, null
  );

  return jsonb_build_object('conversation_id', v_conversation_id, 'message_id', v_message_id);
end;
$$;

create or replace function public.update_message_delivery_status(
  p_message_id uuid default null, p_provider text default null, p_provider_message_id text default null,
  p_status text default null, p_error_code text default null, p_error_message text default null
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
    return jsonb_build_object('status', 'not_found');
  end if;

  v_rank_current := coalesce((v_ranks->>v_message.status)::int, 0);
  v_rank_new := coalesce((v_ranks->>p_status)::int, 0);
  if v_rank_new < v_rank_current and v_message.status not in ('failed') then
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

  if p_status in ('sent', 'delivered', 'failed') then
    perform public.emit_domain_event(
      v_message.organization_id, 'message.' || p_status, 'conversation', v_message.conversation_id,
      jsonb_build_object('message_id', v_message.id, 'conversation_id', v_message.conversation_id),
      'update_message_delivery_status', null, null, null
    );
  end if;

  return jsonb_build_object('status', 'updated', 'message_id', v_message.id, 'conversation_id', v_message.conversation_id);
end;
$$;

-- ============================================================
-- send_communication_message ganha p_causation_id (novo parâmetro
-- final) — mesma lógica de create_task acima.
-- ============================================================

create or replace function public.send_communication_message(
  p_organization_id uuid, p_channel text, p_connection_id uuid, p_customer_id uuid default null,
  p_company_id uuid default null, p_contact_id uuid default null, p_lead_id uuid default null,
  p_conversation_id uuid default null, p_recipient_identity text default null, p_subject text default null,
  p_body_text text default null, p_provider text default 'resend', p_causation_id uuid default null
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

-- ============================================================
-- Executores de action reemitidos só para encadear causation_id
-- (o corpo é o mesmo da migration anterior, exceto pelo argumento
-- final novo passado para create_task/send_communication_message).
-- ============================================================

create or replace function public.run_create_task_action(p_configuration jsonb, p_event public.domain_events)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_title text;
  v_description text;
  v_entity_type text;
  v_entity_id uuid;
begin
  v_title := public.resolve_automation_template(coalesce(p_configuration->>'title', 'Tarefa automática'), p_event);
  v_description := case when p_configuration->>'description' is not null then public.resolve_automation_template(p_configuration->>'description', p_event) else null end;
  v_entity_type := coalesce(p_configuration->>'entity_type', p_event.entity_type);
  v_entity_id := coalesce(nullif(p_configuration->>'entity_id', '')::uuid, p_event.entity_id);

  return public.create_task(
    p_event.organization_id, v_title, v_description, coalesce(p_configuration->>'priority', 'normal'),
    nullif(p_configuration->>'assignee_user_id', '')::uuid, null, v_entity_type, v_entity_id,
    jsonb_build_object('automation_event_id', p_event.id), p_event.id
  );
end;
$$;

create or replace function public.run_send_email_action(p_configuration jsonb, p_event public.domain_events)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_subject text;
  v_body text;
  v_customer_id uuid;
  v_lead_id uuid;
begin
  v_subject := public.resolve_automation_template(coalesce(p_configuration->>'subject', 'Mensagem automática'), p_event);
  v_body := public.resolve_automation_template(coalesce(p_configuration->>'body_text', ''), p_event);

  if p_event.entity_type = 'lead' then v_lead_id := p_event.entity_id;
  elsif p_event.entity_type = 'customer' then v_customer_id := p_event.entity_id;
  elsif p_event.payload ? 'customer_id' then v_customer_id := nullif(p_event.payload->>'customer_id', '')::uuid;
  end if;

  return public.send_communication_message(
    p_event.organization_id, 'email', null, v_customer_id, null, null, v_lead_id, null,
    nullif(p_configuration->>'recipient_identity', ''), v_subject, v_body, 'resend', p_event.id
  );
end;
$$;

commit;
