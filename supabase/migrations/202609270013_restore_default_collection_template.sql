begin;

-- ============================================================
-- MUGÔ ONE — Sprint Final de Produto (Cobranças Simples + Zero Ruah + UX Apple)
--
-- "Restaurar padrão" (briefing §1, menu secundário do template gallery)
-- precisa do MESMO texto que seed_default_collection_templates usa —
-- extraído aqui para uma função só, nunca duplicado entre as duas.
-- ============================================================

create or replace function public.collection_template_presets()
returns table(key text, name text, channel text, subject text, body text, is_default boolean, situation text)
language sql
immutable
as $$
  values
    ('cobranca_inicial', 'Cobrança inicial', 'generic',
     'Pagamento pendente — {{organization.name}}',
     E'Olá, {{customer.name}}!\n\nIdentificamos um pagamento pendente no valor de {{collection.amount}}, com vencimento em {{collection.due_date}}.\n\n{{payment.instructions}}\n\nSe precisar de ajuda, fale conosco.\n\n{{organization.name}}',
     true, 'initial'),
    ('lembrete_antes_vencimento', 'Lembrete de vencimento', 'generic',
     'Lembrete de pagamento — {{organization.name}}',
     E'Olá, {{customer.name}}!\n\nPassando para lembrar que o pagamento de {{collection.amount}} vence em {{collection.due_date}}.\n\n{{payment.instructions}}\n\nSe precisar de ajuda, fale conosco.\n\n{{organization.name}}',
     false, null),
    ('vencimento_hoje', 'Vence hoje', 'generic',
     'Pagamento vence hoje — {{organization.name}}',
     E'Olá, {{customer.name}}!\n\nPassando para lembrar que o pagamento de {{collection.amount}} vence hoje.\n\n{{payment.instructions}}\n\nSe o pagamento já foi realizado, pode desconsiderar esta mensagem.\n\n{{organization.name}}',
     false, 'due_today'),
    ('pagamento_atrasado', 'Pagamento atrasado', 'generic',
     'Pagamento em atraso — {{organization.name}}',
     E'Olá, {{customer.name}}!\n\nIdentificamos que o pagamento de {{collection.amount}}, com vencimento em {{collection.due_date}}, continua pendente.\n\n{{payment.instructions}}\n\nSe precisar falar conosco:\n\n{{support.phone}}\n{{support.email}}',
     false, 'overdue'),
    ('segundo_lembrete', 'Segundo lembrete', 'generic',
     'Ainda aguardamos seu pagamento — {{organization.name}}',
     E'Olá, {{customer.name}}.\n\nO pagamento de {{collection.amount}} ainda aparece como pendente.\n\n{{payment.instructions}}\n\nCaso já tenha realizado o pagamento, desconsidere esta mensagem.\n\nSe precisar de ajuda, estamos à disposição.',
     false, null),
    ('confirmacao_pagamento', 'Pagamento confirmado', 'generic',
     'Pagamento confirmado — {{organization.name}}',
     E'Olá, {{customer.name}}!\n\nPagamento de {{collection.amount}} confirmado.\n\nObrigado!\n\n{{organization.name}}',
     false, 'paid')
$$;

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
  select p_organization_id, p.name, p.key, p.channel, p.subject, p.body, p.is_default, p.situation
  from public.collection_template_presets() p
  on conflict (organization_id, key) do nothing;

  return query select * from public.collection_message_templates where organization_id = p_organization_id order by created_at asc;
end;
$$;

-- Restaura NOME/CORPO/ASSUNTO de um template existente para o preset da
-- própria chave — nunca mexe em is_default/situation/active (a
-- organização pode ter reorganizado essas associações por conta própria;
-- "restaurar padrão" é só sobre o TEXTO).
create or replace function public.restore_default_collection_template(p_template_id uuid)
returns public.collection_message_templates
language plpgsql
security definer
set search_path to public
as $$
declare
  v_org uuid; v_key text; v_preset record; v_row public.collection_message_templates;
begin
  select organization_id, key into v_org, v_key from public.collection_message_templates where id = p_template_id;
  if v_org is null then raise exception 'template_not_found'; end if;
  if not public.has_org_permission(v_org, 'collections.configure') then raise exception 'forbidden'; end if;

  select * into v_preset from public.collection_template_presets() where key = v_key;
  if v_preset.key is null then raise exception 'no_preset_for_this_template'; end if;

  update public.collection_message_templates
  set name = v_preset.name, subject = v_preset.subject, body = v_preset.body
  where id = p_template_id
  returning * into v_row;
  return v_row;
end;
$$;

revoke all on function public.restore_default_collection_template(uuid) from public, anon;
grant execute on function public.restore_default_collection_template(uuid) to authenticated;

commit;
