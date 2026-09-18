begin;

-- ============================================================
-- MUGÔ ONE — Sprint O (Event Engine + Automation Engine)
--
-- Lacuna de design achada no smoke test: send_communication_message só
-- ENFILEIRA a message (o envio HTTP de verdade acontece depois, numa
-- Edge Function separada — briefing §18/§26). Isso significa que, sem
-- checagem extra, a action sempre reportaria 'completed' na hora,
-- mesmo sem nenhuma conexão de e-mail configurada — só falharia
-- depois, de forma assíncrona, sem o run refletir isso.
--
-- O briefing §49 espera especificamente que a AUSÊNCIA de provider
-- configurado apareça como 'failed'/'provider_not_configured' NA
-- EXECUÇÃO da automação (run vira partially_failed), não só depois.
-- Um pedaço de SQL não consegue checar RESEND_API_KEY (variável de
-- ambiente da Edge Function), mas CONSEGUE checar se existe uma
-- communication_connections ativa (provider='resend', channel='email',
-- status='connected') para a organização — proxy verificável e
-- coerente com a própria tela de Configurações → Comunicações, que já
-- mostra "NÃO CONFIGURADO" exatamente nesse caso. Se uma connection
-- existir mas o RESEND_API_KEY mesmo assim faltar no ambiente, a
-- falha só aparece depois quando o worker processar a fila — limite
-- documentado, não escondido.
-- ============================================================

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
  v_connection_id uuid;
begin
  select id into v_connection_id from public.communication_connections
  where organization_id = p_event.organization_id and provider = 'resend' and channel = 'email' and status = 'connected'
  limit 1;
  if v_connection_id is null then
    raise exception 'provider_not_configured';
  end if;

  v_subject := public.resolve_automation_template(coalesce(p_configuration->>'subject', 'Mensagem automática'), p_event);
  v_body := public.resolve_automation_template(coalesce(p_configuration->>'body_text', ''), p_event);

  if p_event.entity_type = 'lead' then v_lead_id := p_event.entity_id;
  elsif p_event.entity_type = 'customer' then v_customer_id := p_event.entity_id;
  elsif p_event.payload ? 'customer_id' then v_customer_id := nullif(p_event.payload->>'customer_id', '')::uuid;
  end if;

  return public.send_communication_message(
    p_event.organization_id, 'email', v_connection_id, v_customer_id, null, null, v_lead_id, null,
    nullif(p_configuration->>'recipient_identity', ''), v_subject, v_body, 'resend', p_event.id
  );
end;
$$;

commit;
