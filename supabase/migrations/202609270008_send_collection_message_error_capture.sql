begin;

-- ============================================================
-- MUGÔ ONE — Sprint de Limpeza (Cobrança Universal + Zero Ruah)
--
-- Bug achado na QA ao vivo: com provider CONECTADO mas destinatário
-- ausente (ex.: cliente sem e-mail cadastrado), send_communication_message
-- levanta 'recipient_required' — sem tratamento, a exceção propagava
-- e a transação inteira (incluindo o insert em collection_attempts)
-- era desfeita. Resultado: a tentativa de cobrança simplesmente
-- desaparecia, sem nenhum registro — exatamente o que o briefing §23
-- proíbe ("o registro da cobrança deve persistir independentemente").
--
-- Agora QUALQUER falha do envio (provider ausente OU erro do
-- Communication Hub) vira status='failed' com o código real do erro,
-- sempre registrado.
-- ============================================================

create or replace function public.send_collection_message(
  p_organization_id uuid, p_client_id uuid, p_sale_ids uuid[], p_template_id uuid, p_channel text default 'email'
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_template public.collection_message_templates;
  v_connection_id uuid;
  v_rendered jsonb;
  v_send_result jsonb;
  v_status text;
  v_error_code text;
  v_error_message text;
  v_message_id uuid;
  v_conversation_id uuid;
  v_attempt_id uuid;
begin
  if auth.role() <> 'service_role' and not public.has_org_permission(p_organization_id, 'collections.send') then
    raise exception 'forbidden';
  end if;
  if not exists (select 1 from public.clients where id = p_client_id and organization_id = p_organization_id and deleted_at is null) then
    raise exception 'client_not_found';
  end if;

  select * into v_template from public.collection_message_templates where id = p_template_id and organization_id = p_organization_id and active = true;
  if v_template.id is null then raise exception 'template_not_found'; end if;

  v_rendered := public.render_collection_template(p_organization_id, p_template_id, p_client_id, p_sale_ids);

  select id into v_connection_id from public.communication_connections
  where organization_id = p_organization_id and channel = p_channel and status = 'connected'
  order by created_at asc
  limit 1;

  if v_connection_id is null then
    v_status := 'failed';
    v_error_code := 'provider_not_configured';
    v_error_message := 'Nenhum provedor conectado para o canal "' || p_channel || '". Configure em Configurações → Comunicações.';
  else
    begin
      v_send_result := public.send_communication_message(
        p_organization_id, p_channel, v_connection_id, p_client_id, null, null, null, null,
        null, v_rendered->>'subject', v_rendered->>'body',
        case p_channel when 'email' then 'resend' else p_channel end, null
      );
      v_message_id := (v_send_result->>'message_id')::uuid;
      v_conversation_id := (v_send_result->>'conversation_id')::uuid;
      v_status := 'sent';
    exception when others then
      v_status := 'failed';
      v_error_code := sqlerrm;
      v_error_message := 'Não foi possível enviar a cobrança pelo Communication Hub: ' || sqlerrm;
    end;
  end if;

  insert into public.collection_attempts(
    organization_id, client_id, template_id, channel, conversation_id, message_id,
    status, sent_by_user_id, sent_at, error_code, error_message, metadata
  ) values (
    p_organization_id, p_client_id, v_template.id, p_channel, v_conversation_id, v_message_id,
    v_status, auth.uid(), case when v_status = 'sent' then now() else null end, v_error_code, v_error_message,
    jsonb_build_object('sale_ids', to_jsonb(coalesce(p_sale_ids, '{}'::uuid[])), 'invalid_variables', v_rendered->'invalid_variables')
  ) returning id into v_attempt_id;

  return jsonb_build_object(
    'attempt_id', v_attempt_id, 'status', v_status, 'error_code', v_error_code, 'error_message', v_error_message,
    'conversation_id', v_conversation_id, 'message_id', v_message_id, 'rendered', v_rendered
  );
end;
$$;

commit;
