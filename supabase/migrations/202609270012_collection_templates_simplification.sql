begin;

-- ============================================================
-- MUGÔ ONE — Sprint Final de Produto (Cobranças Simples + Zero Ruah + UX Apple)
--
-- UX "menos decisões, mais defaults": um template padrão (is_default) e
-- uma associação opcional por situação (situation) para que "Cobrar"
-- já abra direto no Preview sem exigir escolha manual toda vez
-- (briefing §3-4/§15-16). Nenhum Automation Scheduler é criado — isto é
-- só configuração/leitura, nunca um gatilho automático.
--
-- {{payment.instructions}} — variável nova, composta no servidor a
-- partir do que a organização já configurou (PIX/transferência/link),
-- ou o texto livre da organização quando ela preferir escrever à mão —
-- reduz o texto padrão a "menos formulário, mais defaults" sem duplicar
-- PIX/link em cada template manualmente.
-- ============================================================

alter table public.collection_message_templates
  add column is_default boolean not null default false,
  add column situation text check (situation in ('initial', 'due_today', 'overdue', 'second_reminder', 'paid'));

-- No máximo 1 template padrão e no máximo 1 template por situação, por organização.
create unique index collection_message_templates_one_default_idx
  on public.collection_message_templates(organization_id) where is_default;
create unique index collection_message_templates_one_per_situation_idx
  on public.collection_message_templates(organization_id, situation) where situation is not null;

create or replace function public.set_default_collection_template(p_template_id uuid)
returns public.collection_message_templates
language plpgsql
security definer
set search_path to public
as $$
declare
  v_org uuid; v_row public.collection_message_templates;
begin
  select organization_id into v_org from public.collection_message_templates where id = p_template_id;
  if v_org is null then raise exception 'template_not_found'; end if;
  if not public.has_org_permission(v_org, 'collections.configure') then raise exception 'forbidden'; end if;

  update public.collection_message_templates set is_default = false where organization_id = v_org and is_default;
  update public.collection_message_templates set is_default = true where id = p_template_id returning * into v_row;
  return v_row;
end;
$$;

create or replace function public.set_collection_template_situation(p_template_id uuid, p_situation text)
returns public.collection_message_templates
language plpgsql
security definer
set search_path to public
as $$
declare
  v_org uuid; v_row public.collection_message_templates;
begin
  if p_situation is not null and p_situation not in ('initial', 'due_today', 'overdue', 'second_reminder', 'paid') then
    raise exception 'invalid_situation';
  end if;
  select organization_id into v_org from public.collection_message_templates where id = p_template_id;
  if v_org is null then raise exception 'template_not_found'; end if;
  if not public.has_org_permission(v_org, 'collections.configure') then raise exception 'forbidden'; end if;

  if p_situation is not null then
    update public.collection_message_templates set situation = null where organization_id = v_org and situation = p_situation and id <> p_template_id;
  end if;
  update public.collection_message_templates set situation = p_situation where id = p_template_id returning * into v_row;
  return v_row;
end;
$$;

revoke all on function public.set_default_collection_template(uuid) from public, anon;
revoke all on function public.set_collection_template_situation(uuid, text) from public, anon;
grant execute on function public.set_default_collection_template(uuid) to authenticated;
grant execute on function public.set_collection_template_situation(uuid, text) to authenticated;

-- payment.instructions: variável 13, composta a partir da configuração
-- real da organização (nunca hardcoded) — texto livre quando a
-- organização preferir escrever à mão, senão um resumo automático de
-- PIX/transferência/link habilitados. As 12 variáveis atômicas
-- continuam disponíveis para quem quiser montar a própria frase.
create or replace function public.collection_template_context(
  p_organization_id uuid, p_customer_name text, p_sale_id text, p_sale_total numeric,
  p_collection_amount numeric, p_due_date date
)
returns jsonb
language plpgsql
stable
security definer
set search_path to public
as $function$
declare
  v_org public.organization_settings;
  v_settings public.organization_collection_settings;
  v_company_name text;
  v_instructions text;
  v_lines text[] := '{}';
begin
  select * into v_org from public.organization_settings where organization_id = p_organization_id;
  select * into v_settings from public.organization_collection_settings where organization_id = p_organization_id;
  v_company_name := coalesce(nullif(btrim(v_org.company_name), ''), nullif(btrim(v_org.legal_name), ''), '');

  v_instructions := nullif(btrim(coalesce(v_settings.payment_instructions, '')), '');
  if v_instructions is null then
    if coalesce(v_settings.pix_enabled, false) and nullif(btrim(coalesce(v_settings.pix_key, '')), '') is not null then
      v_lines := v_lines || ('PIX: ' || v_settings.pix_key || case when nullif(btrim(coalesce(v_settings.pix_holder_name, '')), '') is not null then ' (' || v_settings.pix_holder_name || ')' else '' end);
    end if;
    if coalesce(v_settings.bank_transfer_enabled, false) and nullif(btrim(coalesce(v_settings.bank_name, '')), '') is not null then
      v_lines := v_lines || ('Transferência: ' || v_settings.bank_name || case when nullif(btrim(coalesce(v_settings.bank_agency, '')), '') is not null then ' — agência ' || v_settings.bank_agency else '' end || case when nullif(btrim(coalesce(v_settings.bank_account, '')), '') is not null then ', conta ' || v_settings.bank_account else '' end);
    end if;
    if coalesce(v_settings.payment_link_enabled, false) and nullif(btrim(coalesce(v_settings.payment_link_url, '')), '') is not null then
      v_lines := v_lines || ('Link de pagamento: ' || v_settings.payment_link_url);
    end if;
    v_instructions := array_to_string(v_lines, E'\n');
  end if;

  return jsonb_build_object(
    'customer.name', coalesce(nullif(btrim(p_customer_name), ''), 'Cliente'),
    'company.name', v_company_name,
    'organization.name', v_company_name,
    'sale.id', coalesce(p_sale_id, ''),
    'sale.total', case when p_sale_total is null then '' else public.format_brl(p_sale_total) end,
    'collection.amount', case when p_collection_amount is null then '' else public.format_brl(p_collection_amount) end,
    'collection.due_date', case when p_due_date is null then '' else to_char(p_due_date, 'DD/MM/YYYY') end,
    'payment.pix_key', case when coalesce(v_settings.pix_enabled, false) then coalesce(v_settings.pix_key, '') else '' end,
    'payment.pix_holder_name', case when coalesce(v_settings.pix_enabled, false) then coalesce(v_settings.pix_holder_name, '') else '' end,
    'payment.payment_link', case when coalesce(v_settings.payment_link_enabled, false) then coalesce(v_settings.payment_link_url, '') else '' end,
    'payment.instructions', coalesce(v_instructions, ''),
    'support.phone', coalesce(v_settings.support_phone, ''),
    'support.email', coalesce(v_settings.support_email, '')
  );
end;
$function$;

-- Backfill: organizações que já rodaram o seed ANTES desta migration
-- (ex.: as QA orgs da sprint anterior) não tinham is_default/situation —
-- aplica a mesma associação por chave que o seed novo usaria, sem
-- alterar nenhum texto que a organização já possa ter editado.
update public.collection_message_templates set is_default = true where key = 'cobranca_inicial' and organization_id not in (select organization_id from public.collection_message_templates where is_default);
update public.collection_message_templates set situation = 'initial' where key = 'cobranca_inicial' and situation is null;
update public.collection_message_templates set situation = 'due_today' where key = 'vencimento_hoje' and situation is null;
update public.collection_message_templates set situation = 'overdue' where key = 'pagamento_atrasado' and situation is null;
update public.collection_message_templates set situation = 'paid' where key = 'confirmacao_pagamento' and situation is null;

-- Presets neutros reescritos com o texto simples/profissional do
-- briefing §7-11 (nenhuma linguagem jurídica, nenhum texto por ramo) e
-- {{payment.instructions}} no lugar de listar PIX/link manualmente.
-- Idempotente por (organization_id, key), igual à versão anterior:
-- "on conflict do nothing" nunca sobrescreve uma linha existente — uma
-- organização que já rodou o seed antes (com o texto antigo) não é
-- afetada por esta migration; só quem roda o seed pela primeira vez a
-- partir de agora recebe o texto novo.
create or replace function public.seed_default_collection_templates(p_organization_id uuid)
returns setof public.collection_message_templates
language plpgsql
security definer
set search_path to public
as $$
begin
  if not public.has_org_permission(p_organization_id, 'collections.configure') then
    raise exception 'forbidden';
  end if;

  insert into public.collection_message_templates (organization_id, name, key, channel, subject, body, is_default, situation)
  values
    (p_organization_id, 'Cobrança inicial', 'cobranca_inicial', 'generic',
     'Pagamento pendente — {{organization.name}}',
     E'Olá, {{customer.name}}!\n\nIdentificamos um pagamento pendente no valor de {{collection.amount}}, com vencimento em {{collection.due_date}}.\n\n{{payment.instructions}}\n\nSe precisar de ajuda, fale conosco.\n\n{{organization.name}}',
     true, 'initial'),
    (p_organization_id, 'Lembrete de vencimento', 'lembrete_antes_vencimento', 'generic',
     'Lembrete de pagamento — {{organization.name}}',
     E'Olá, {{customer.name}}!\n\nPassando para lembrar que o pagamento de {{collection.amount}} vence em {{collection.due_date}}.\n\n{{payment.instructions}}\n\nSe precisar de ajuda, fale conosco.\n\n{{organization.name}}',
     false, null),
    (p_organization_id, 'Vence hoje', 'vencimento_hoje', 'generic',
     'Pagamento vence hoje — {{organization.name}}',
     E'Olá, {{customer.name}}!\n\nPassando para lembrar que o pagamento de {{collection.amount}} vence hoje.\n\n{{payment.instructions}}\n\nSe o pagamento já foi realizado, pode desconsiderar esta mensagem.\n\n{{organization.name}}',
     false, 'due_today'),
    (p_organization_id, 'Pagamento atrasado', 'pagamento_atrasado', 'generic',
     'Pagamento em atraso — {{organization.name}}',
     E'Olá, {{customer.name}}!\n\nIdentificamos que o pagamento de {{collection.amount}}, com vencimento em {{collection.due_date}}, continua pendente.\n\n{{payment.instructions}}\n\nSe precisar falar conosco:\n\n{{support.phone}}\n{{support.email}}',
     false, 'overdue'),
    (p_organization_id, 'Segundo lembrete', 'segundo_lembrete', 'generic',
     'Ainda aguardamos seu pagamento — {{organization.name}}',
     E'Olá, {{customer.name}}.\n\nO pagamento de {{collection.amount}} ainda aparece como pendente.\n\n{{payment.instructions}}\n\nCaso já tenha realizado o pagamento, desconsidere esta mensagem.\n\nSe precisar de ajuda, estamos à disposição.',
     false, null),
    (p_organization_id, 'Pagamento confirmado', 'confirmacao_pagamento', 'generic',
     'Pagamento confirmado — {{organization.name}}',
     E'Olá, {{customer.name}}!\n\nPagamento de {{collection.amount}} confirmado.\n\nObrigado!\n\n{{organization.name}}',
     false, 'paid')
  on conflict (organization_id, key) do nothing;

  return query select * from public.collection_message_templates where organization_id = p_organization_id order by created_at asc;
end;
$$;

commit;
