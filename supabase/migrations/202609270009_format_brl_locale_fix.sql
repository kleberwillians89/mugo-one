begin;

-- ============================================================
-- MUGÔ ONE — Sprint de Limpeza (Cobrança Universal + Zero Ruah)
--
-- Bug achado na QA ao vivo: {{collection.amount}}/{{sale.total}}
-- renderizavam "R$ 3,000.00" (separadores americanos) em vez de
-- "R$ 3.000,00" — to_char('FM999G999G990D00') usa os separadores G/D
-- do locale do BANCO (lc_numeric), que não é pt-BR nesta instância do
-- Supabase, não o locale do produto. format_brl monta os separadores
-- manualmente (sempre '.' de milhar, ',' decimal), independente de
-- locale — mesmo resultado visual do helper brl() do frontend
-- (src/lib/format.ts), agora também disponível no servidor.
-- ============================================================

create or replace function public.format_brl(p_value numeric)
returns text
language plpgsql
immutable
as $$
declare
  v numeric := round(coalesce(p_value, 0), 2);
  v_neg boolean := v < 0;
  v_int text;
  v_dec text;
  v_grouped text := '';
  v_len integer;
  i integer;
begin
  v := abs(v);
  v_int := trunc(v)::bigint::text;
  v_dec := lpad(round((v - trunc(v)) * 100)::int::text, 2, '0');
  v_len := length(v_int);
  for i in 1..v_len loop
    v_grouped := substr(v_int, v_len - i + 1, 1) || v_grouped;
    if i % 3 = 0 and i <> v_len then v_grouped := '.' || v_grouped; end if;
  end loop;
  return (case when v_neg then '-' else '' end) || 'R$ ' || v_grouped || ',' || v_dec;
end;
$$;

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
    'sale.total', case when p_sale_total is null then '' else public.format_brl(p_sale_total) end,
    'collection.amount', case when p_collection_amount is null then '' else public.format_brl(p_collection_amount) end,
    'collection.due_date', case when p_due_date is null then '' else to_char(p_due_date, 'DD/MM/YYYY') end,
    'payment.pix_key', case when coalesce(v_settings.pix_enabled, false) then coalesce(v_settings.pix_key, '') else '' end,
    'payment.pix_holder_name', case when coalesce(v_settings.pix_enabled, false) then coalesce(v_settings.pix_holder_name, '') else '' end,
    'payment.payment_link', case when coalesce(v_settings.payment_link_enabled, false) then coalesce(v_settings.payment_link_url, '') else '' end,
    'support.phone', coalesce(v_settings.support_phone, ''),
    'support.email', coalesce(v_settings.support_email, '')
  );
end;
$$;

revoke all on function public.format_brl(numeric) from public, anon;
grant execute on function public.format_brl(numeric) to authenticated, service_role;

commit;
