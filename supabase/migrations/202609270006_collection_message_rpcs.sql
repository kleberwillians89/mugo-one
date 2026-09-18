begin;

-- ============================================================
-- MUGÔ ONE — Sprint de Limpeza (Cobrança Universal + Zero Ruah)
--
-- Resolução de variável do template acontece NO SERVIDOR (briefing
-- §34), nunca em React — assim o futuro send_collection_message do
-- Automation Engine (briefing §35, não construído nesta sprint) pode
-- reaproveitar a mesma função sem duplicar lógica.
--
-- Allowlist fixa de variáveis (briefing §11-12) — qualquer
-- {{algo.assim}} que sobrar no texto DEPOIS da substituição das 12
-- conhecidas é, por definição, inválido: devolvido em
-- invalid_variables, nunca silenciosamente escondido nem quebra o
-- envio (o texto renderizado mantém a variável visível como está, o
-- chamador decide como avisar).
-- ============================================================

create or replace function public.collection_template_context(
  p_organization_id uuid, p_customer_name text, p_sale_id text, p_sale_total numeric,
  p_collection_amount numeric, p_due_date date
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_org public.organization_settings;
  v_settings public.organization_collection_settings;
  v_company_name text;
begin
  select * into v_org from public.organization_settings where organization_id = p_organization_id;
  select * into v_settings from public.organization_collection_settings where organization_id = p_organization_id;
  v_company_name := coalesce(nullif(btrim(v_org.company_name), ''), nullif(btrim(v_org.legal_name), ''), '');

  return jsonb_build_object(
    'customer.name', coalesce(nullif(btrim(p_customer_name), ''), 'Cliente'),
    'company.name', v_company_name,
    'organization.name', v_company_name,
    'sale.id', coalesce(p_sale_id, ''),
    'sale.total', case when p_sale_total is null then '' else 'R$ ' || to_char(p_sale_total, 'FM999G999G990D00') end,
    'collection.amount', case when p_collection_amount is null then '' else 'R$ ' || to_char(p_collection_amount, 'FM999G999G990D00') end,
    'collection.due_date', case when p_due_date is null then '' else to_char(p_due_date, 'DD/MM/YYYY') end,
    'payment.pix_key', case when coalesce(v_settings.pix_enabled, false) then coalesce(v_settings.pix_key, '') else '' end,
    'payment.pix_holder_name', case when coalesce(v_settings.pix_enabled, false) then coalesce(v_settings.pix_holder_name, '') else '' end,
    'payment.payment_link', case when coalesce(v_settings.payment_link_enabled, false) then coalesce(v_settings.payment_link_url, '') else '' end,
    'support.phone', coalesce(v_settings.support_phone, ''),
    'support.email', coalesce(v_settings.support_email, '')
  );
end;
$$;

create or replace function public.collection_render_with_context(p_template public.collection_message_templates, p_context jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_subject text := coalesce(p_template.subject, '');
  v_body text := p_template.body;
  k text; v text;
  v_invalid text[];
begin
  for k, v in select * from jsonb_each_text(p_context) loop
    v_subject := replace(v_subject, '{{' || k || '}}', v);
    v_body := replace(v_body, '{{' || k || '}}', v);
  end loop;

  select coalesce(array_agg(distinct m[1]), '{}') into v_invalid
  from regexp_matches(v_subject || E'\n' || v_body, '\{\{([a-zA-Z0-9_.]+)\}\}', 'g') as m;

  return jsonb_build_object(
    'template_id', p_template.id, 'channel', p_template.channel,
    'subject', v_subject, 'body', v_body,
    'invalid_variables', to_jsonb(coalesce(v_invalid, '{}'::text[]))
  );
end;
$$;

-- render_collection_template: dados REAIS (cliente/vendas verdadeiros)
-- — usado no envio de verdade.
create or replace function public.render_collection_template(
  p_organization_id uuid, p_template_id uuid, p_client_id uuid, p_sale_ids uuid[]
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_template public.collection_message_templates;
  v_settings public.organization_collection_settings;
  v_client public.clients;
  v_sale_count integer := 0;
  v_amount numeric;
  v_min_date date;
  v_due_date date;
  v_single_sale_id uuid;
  v_single_sale_amount numeric;
begin
  if auth.role() <> 'service_role'
     and not (public.has_org_permission(p_organization_id, 'collections.configure') or public.has_org_permission(p_organization_id, 'collections.send'))
  then
    raise exception 'forbidden';
  end if;

  select * into v_template from public.collection_message_templates where id = p_template_id and organization_id = p_organization_id;
  if v_template.id is null then raise exception 'template_not_found'; end if;

  select * into v_client from public.clients where id = p_client_id and organization_id = p_organization_id and deleted_at is null;
  if v_client.id is null then raise exception 'client_not_found'; end if;

  select * into v_settings from public.organization_collection_settings where organization_id = p_organization_id;

  if p_sale_ids is not null and array_length(p_sale_ids, 1) is not null then
    select count(*), coalesce(sum(amount), 0), min(sale_date)
      into v_sale_count, v_amount, v_min_date
    from public.sales
    where id = any(p_sale_ids) and organization_id = p_organization_id and client_id = p_client_id;
    if v_min_date is not null then v_due_date := v_min_date + coalesce(v_settings.default_due_days, 7); end if;
    if v_sale_count = 1 then
      v_single_sale_id := p_sale_ids[1];
      v_single_sale_amount := v_amount;
    end if;
  end if;

  return public.collection_render_with_context(
    v_template,
    public.collection_template_context(
      p_organization_id, v_client.name, v_single_sale_id::text, v_single_sale_amount, v_amount, v_due_date
    )
  );
end;
$$;

-- preview_collection_template: dados FICTÍCIOS de cliente/venda
-- (briefing §13 — "nunca um cliente real por padrão"), mas PIX/
-- instruções/contato reais da organização, para o gestor ver
-- exatamente o que seria enviado.
create or replace function public.preview_collection_template(p_organization_id uuid, p_template_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_template public.collection_message_templates;
  v_settings public.organization_collection_settings;
  v_due_date date;
begin
  if not (public.has_org_permission(p_organization_id, 'collections.configure') or public.has_org_permission(p_organization_id, 'collections.send')) then
    raise exception 'forbidden';
  end if;

  select * into v_template from public.collection_message_templates where id = p_template_id and organization_id = p_organization_id;
  if v_template.id is null then raise exception 'template_not_found'; end if;

  select * into v_settings from public.organization_collection_settings where organization_id = p_organization_id;
  v_due_date := current_date + coalesce(v_settings.default_due_days, 7);

  return public.collection_render_with_context(
    v_template,
    public.collection_template_context(p_organization_id, 'Cliente Exemplo (pré-visualização)', 'EXEMPLO-0001', 350.00, 350.00, v_due_date)
  );
end;
$$;

-- send_collection_message: renderiza + envia pelo Communication Hub
-- (send_communication_message, Sprint N) — nunca chama um provider
-- diretamente (briefing §21-25). Sem conexão ativa para o canal, o
-- envio falha com provider_not_configured, mas a TENTATIVA é sempre
-- registrada em collection_attempts (nunca falha silenciosamente, nem
-- deixa de existir o registro).
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
    v_send_result := public.send_communication_message(
      p_organization_id, p_channel, v_connection_id, p_client_id, null, null, null, null,
      null, v_rendered->>'subject', v_rendered->>'body',
      case p_channel when 'email' then 'resend' else p_channel end, null
    );
    v_message_id := (v_send_result->>'message_id')::uuid;
    v_conversation_id := (v_send_result->>'conversation_id')::uuid;
    v_status := 'sent';
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

-- seed_default_collection_templates: presets neutros de ponto de
-- partida (briefing §14-15 — nenhuma palavra por vertical, a
-- organização edita livremente depois; nunca "if business_type").
-- Idempotente por (organization_id, key) — chamar de novo não duplica.
create or replace function public.seed_default_collection_templates(p_organization_id uuid)
returns setof public.collection_message_templates
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.has_org_permission(p_organization_id, 'collections.configure') then
    raise exception 'forbidden';
  end if;

  insert into public.collection_message_templates (organization_id, name, key, channel, subject, body)
  values
    (p_organization_id, 'Cobrança inicial', 'cobranca_inicial', 'generic',
     'Pagamento pendente — {{organization.name}}',
     E'Olá, {{customer.name}}.\n\nIdentificamos um pagamento pendente no valor de {{collection.amount}}, com vencimento em {{collection.due_date}}.\n\n{{support.phone}}'),
    (p_organization_id, 'Lembrete antes do vencimento', 'lembrete_antes_vencimento', 'generic',
     'Lembrete de pagamento — {{organization.name}}',
     E'Olá, {{customer.name}}.\n\nPassando para lembrar que o pagamento de {{collection.amount}} vence em {{collection.due_date}}.\n\nQualquer dúvida, estamos à disposição.'),
    (p_organization_id, 'Vencimento hoje', 'vencimento_hoje', 'generic',
     'Pagamento vence hoje — {{organization.name}}',
     E'Olá, {{customer.name}}.\n\nO pagamento de {{collection.amount}} vence hoje.\n\nSe já realizou o pagamento, desconsidere esta mensagem.'),
    (p_organization_id, 'Pagamento atrasado', 'pagamento_atrasado', 'generic',
     'Pagamento em atraso — {{organization.name}}',
     E'Olá, {{customer.name}}.\n\nO pagamento de {{collection.amount}}, com vencimento em {{collection.due_date}}, ainda não foi identificado.\n\nPor favor, regularize assim que possível.'),
    (p_organization_id, 'Segundo lembrete', 'segundo_lembrete', 'generic',
     'Ainda aguardamos seu pagamento — {{organization.name}}',
     E'Olá, {{customer.name}}.\n\nAinda não identificamos o pagamento de {{collection.amount}}. Este é um segundo lembrete.\n\n{{support.email}}'),
    (p_organization_id, 'Confirmação de pagamento', 'confirmacao_pagamento', 'generic',
     'Pagamento confirmado — {{organization.name}}',
     E'Olá, {{customer.name}}.\n\nConfirmamos o recebimento do seu pagamento de {{collection.amount}}. Obrigado!')
  on conflict (organization_id, key) do nothing;

  return query select * from public.collection_message_templates where organization_id = p_organization_id order by created_at asc;
end;
$$;

revoke all on function public.collection_template_context(uuid, text, text, numeric, numeric, date) from public, anon;
revoke all on function public.collection_render_with_context(public.collection_message_templates, jsonb) from public, anon;
revoke all on function public.render_collection_template(uuid, uuid, uuid, uuid[]) from public, anon;
revoke all on function public.preview_collection_template(uuid, uuid) from public, anon;
revoke all on function public.send_collection_message(uuid, uuid, uuid[], uuid, text) from public, anon;
revoke all on function public.seed_default_collection_templates(uuid) from public, anon;

grant execute on function public.collection_template_context(uuid, text, text, numeric, numeric, date) to authenticated, service_role;
grant execute on function public.collection_render_with_context(public.collection_message_templates, jsonb) to authenticated, service_role;
grant execute on function public.render_collection_template(uuid, uuid, uuid, uuid[]) to authenticated, service_role;
grant execute on function public.preview_collection_template(uuid, uuid) to authenticated, service_role;
grant execute on function public.send_collection_message(uuid, uuid, uuid[], uuid, text) to authenticated, service_role;
grant execute on function public.seed_default_collection_templates(uuid) to authenticated;

commit;
