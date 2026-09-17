begin;

-- ============================================================
-- MUGÔ ONE — Sprint M (Lead Intake + Source + Touchpoints + Dedupe)
--
-- lead_intake_submit: único ponto de escrita para lead_intake_events/
-- touchpoints/leads a partir de uma entrada pública. SECURITY DEFINER,
-- chamável só por service_role (mesmo guard de
-- consume_public_endpoint_rate_limit) — nunca exposta a anon/
-- authenticated diretamente. A Edge Function lead-intake é a única
-- chamadora real (ver docs/LEAD_INTAKE_API.md).
--
-- Fluxo: valida endpoint pela public_key → valida payload → idempotência
-- (idempotency_key OU provider+external_id) → normaliza → identity
-- resolution conservadora contra clients (0=novo, 1=resolvido, 2+=
-- conflito, nunca escolhe) → cria lead_intake_events → cria Lead →
-- cria touchpoint → activities. NUNCA cria Company/Contact (isso
-- continua em convert_lead(), não duplicado aqui — ver docs §1).
-- ============================================================

create or replace function public.lead_intake_submit(
  p_public_key text,
  p_provider text,
  p_channel text,
  p_external_id text default null,
  p_idempotency_key text default null,
  p_name text default null,
  p_email text default null,
  p_phone text default null,
  p_document text default null,
  p_company_name text default null,
  p_interest_catalog_item_id uuid default null,
  p_interest_text text default null,
  p_source text default null,
  p_medium text default null,
  p_campaign_id text default null,
  p_campaign_name text default null,
  p_adset_id text default null,
  p_adset_name text default null,
  p_ad_id text default null,
  p_ad_name text default null,
  p_form_id text default null,
  p_form_name text default null,
  p_landing_page text default null,
  p_referrer text default null,
  p_utm_source text default null,
  p_utm_medium text default null,
  p_utm_campaign text default null,
  p_utm_term text default null,
  p_utm_content text default null,
  p_click_id text default null,
  p_click_id_type text default null,
  p_occurred_at timestamptz default now(),
  p_metadata jsonb default '{}'::jsonb,
  p_raw_payload jsonb default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_endpoint public.lead_intake_endpoints;
  v_organization_id uuid;
  v_existing public.lead_intake_events;
  v_event_id uuid;
  v_normalized_email text;
  v_normalized_phone text;
  v_normalized_document text;
  v_customer_ids uuid[];
  v_resolved_customer_id uuid;
  v_status text;
  v_lead_id uuid;
  v_name text;
  v_clean_raw_payload jsonb;
  v_clean_metadata jsonb;
begin
  if auth.role() <> 'service_role' then
    raise exception 'permission_denied' using errcode = '42501';
  end if;

  if p_public_key is null or btrim(p_public_key) = '' then
    return jsonb_build_object('status', 'invalid_key', 'error_code', 'INVALID_INTAKE_KEY');
  end if;

  select * into v_endpoint from public.lead_intake_endpoints where public_key = p_public_key;
  if not found then
    return jsonb_build_object('status', 'invalid_key', 'error_code', 'INVALID_INTAKE_KEY');
  end if;
  if v_endpoint.status <> 'active' then
    return jsonb_build_object('status', 'endpoint_disabled', 'error_code', 'ENDPOINT_DISABLED');
  end if;
  v_organization_id := v_endpoint.organization_id;

  if p_provider is null or btrim(p_provider) = '' or p_channel is null or btrim(p_channel) = '' then
    return jsonb_build_object('status', 'invalid_payload', 'error_code', 'INVALID_PAYLOAD', 'message', 'provider e channel são obrigatórios.');
  end if;
  if coalesce(btrim(p_name), '') = '' and coalesce(btrim(p_email), '') = '' and coalesce(btrim(p_phone), '') = '' then
    return jsonb_build_object('status', 'invalid_payload', 'error_code', 'INVALID_PAYLOAD', 'message', 'informe ao menos nome, e-mail ou telefone.');
  end if;
  if length(coalesce(p_name,'')) > 200 or length(coalesce(p_email,'')) > 320 or length(coalesce(p_phone,'')) > 40
     or length(coalesce(p_company_name,'')) > 200 or length(coalesce(p_interest_text,'')) > 500
     or length(coalesce(p_landing_page,'')) > 2000 or length(coalesce(p_referrer,'')) > 2000 then
    return jsonb_build_object('status', 'invalid_payload', 'error_code', 'INVALID_PAYLOAD', 'message', 'algum campo excede o tamanho máximo permitido.');
  end if;
  if pg_column_size(coalesce(p_metadata, '{}'::jsonb)) > 20000 or pg_column_size(coalesce(p_raw_payload, '{}'::jsonb)) > 65536 then
    return jsonb_build_object('status', 'invalid_payload', 'error_code', 'INVALID_PAYLOAD', 'message', 'payload excede o tamanho máximo permitido.');
  end if;
  if p_interest_catalog_item_id is not null
     and not public.entity_belongs_to_organization('catalog_item', p_interest_catalog_item_id, v_organization_id) then
    return jsonb_build_object('status', 'invalid_payload', 'error_code', 'TENANT_MISMATCH', 'message', 'interest_catalog_item_id não pertence a esta organização.');
  end if;

  -- Idempotência: mesma idempotency_key OU mesmo provider+external_id
  -- já visto antes → devolve o resultado anterior, nunca reprocessa
  -- nem duplica (briefing §16).
  if p_idempotency_key is not null then
    select * into v_existing from public.lead_intake_events
    where organization_id = v_organization_id and idempotency_key = p_idempotency_key;
  end if;
  if v_existing.id is null and p_external_id is not null then
    select * into v_existing from public.lead_intake_events
    where organization_id = v_organization_id and provider = p_provider and external_id = p_external_id;
  end if;
  if v_existing.id is not null then
    update public.lead_intake_endpoints set event_count = event_count + 1, last_event_at = now() where id = v_endpoint.id;
    return jsonb_build_object(
      'status', 'duplicate', 'event_id', v_existing.id, 'processing_status', v_existing.processing_status,
      'lead_id', v_existing.resolved_lead_id, 'customer_id', v_existing.resolved_customer_id
    );
  end if;

  v_normalized_email := public.normalize_email(p_email);
  v_normalized_phone := case when coalesce(btrim(p_phone), '') <> '' then public.normalize_br_phone(p_phone) else null end;
  v_normalized_document := public.normalize_document(p_document);

  -- Identity resolution conservadora contra clients (customer): junta
  -- candidatos por documento, e-mail e telefone/whatsapp. 0 = identidade
  -- nova, 1 = resolvida, 2+ = conflito — nunca escolhe entre
  -- identificadores diferentes nem dentro do mesmo identificador
  -- (briefing §13/§14/§15). companies/contacts ficam para convert_lead().
  select array_agg(distinct id) into v_customer_ids from (
    select id from public.clients
    where organization_id = v_organization_id and merged_into_id is null and deleted_at is null
      and v_normalized_document is not null and normalized_cpf = v_normalized_document
    union
    select id from public.clients
    where organization_id = v_organization_id and merged_into_id is null and deleted_at is null
      and v_normalized_email is not null and normalized_email = v_normalized_email
    union
    select id from public.clients
    where organization_id = v_organization_id and merged_into_id is null and deleted_at is null
      and v_normalized_phone is not null
      and (normalized_phone = v_normalized_phone or normalized_whatsapp = v_normalized_phone)
  ) matches;

  if v_customer_ids is null or array_length(v_customer_ids, 1) = 0 then
    v_resolved_customer_id := null;
    v_status := 'processed';
  elsif array_length(v_customer_ids, 1) = 1 then
    v_resolved_customer_id := v_customer_ids[1];
    v_status := 'processed';
  else
    v_resolved_customer_id := null;
    v_status := 'identity_conflict';
  end if;

  v_clean_metadata := coalesce(p_metadata, '{}'::jsonb);
  -- Nunca armazenar header/token/segredo, mesmo que tenha vindo junto
  -- (a Edge Function já não repassa headers — isto é defesa em
  -- profundidade sobre o corpo em si, briefing §4).
  v_clean_raw_payload := coalesce(p_raw_payload, '{}'::jsonb)
    - 'authorization' - 'Authorization' - 'token' - 'access_token' - 'refresh_token'
    - 'secret' - 'password' - 'cookie' - 'service_role' - 'service_role_key' - 'api_key';

  insert into public.lead_intake_events (
    organization_id, endpoint_id, provider, channel, external_id, idempotency_key,
    name, email, phone, document, company_name,
    interest_catalog_item_id, interest_text,
    source, medium, campaign_id, campaign_name, adset_id, adset_name, ad_id, ad_name,
    form_id, form_name, landing_page, referrer,
    utm_source, utm_medium, utm_campaign, utm_term, utm_content, click_id, click_id_type,
    normalized_email, normalized_phone, normalized_document,
    occurred_at, processing_status, resolved_customer_id, metadata, raw_payload
  ) values (
    v_organization_id, v_endpoint.id, p_provider, p_channel, p_external_id, p_idempotency_key,
    nullif(btrim(p_name), ''), nullif(btrim(p_email), ''), nullif(btrim(p_phone), ''), nullif(btrim(p_document), ''), nullif(btrim(p_company_name), ''),
    p_interest_catalog_item_id, nullif(btrim(p_interest_text), ''),
    p_source, p_medium, p_campaign_id, p_campaign_name, p_adset_id, p_adset_name, p_ad_id, p_ad_name,
    p_form_id, p_form_name, p_landing_page, p_referrer,
    p_utm_source, p_utm_medium, p_utm_campaign, p_utm_term, p_utm_content, p_click_id, p_click_id_type,
    v_normalized_email, v_normalized_phone, v_normalized_document,
    coalesce(p_occurred_at, now()), v_status, v_resolved_customer_id, v_clean_metadata, v_clean_raw_payload
  )
  returning id into v_event_id;

  if v_status = 'identity_conflict' then
    update public.lead_intake_endpoints set event_count = event_count + 1, last_event_at = now() where id = v_endpoint.id;
    return jsonb_build_object('status', 'identity_conflict', 'event_id', v_event_id, 'error_code', 'IDENTITY_CONFLICT');
  end if;

  v_name := coalesce(nullif(btrim(p_name), ''), nullif(split_part(coalesce(p_email,''), '@', 1), ''), 'Lead sem nome');

  -- Sempre cria um Lead novo por evento (nunca assume "1 pessoa = 1
  -- lead pra sempre" — briefing §17); quando a identidade já resolveu
  -- um customer, o Lead nasce vinculado a ele (customer_id), nunca cria
  -- Company/Contact/Customer novos aqui.
  insert into public.leads (
    organization_id, name, email, phone, company_name, customer_id,
    source, source_channel, source_medium, source_campaign, source_external_id,
    attribution_metadata, status, metadata
  ) values (
    v_organization_id, v_name, nullif(btrim(p_email), ''), nullif(btrim(p_phone), ''), nullif(btrim(p_company_name), ''), v_resolved_customer_id,
    'lead_intake', p_channel, p_medium, coalesce(p_campaign_name, p_campaign_id), p_external_id,
    jsonb_strip_nulls(jsonb_build_object(
      'provider', p_provider, 'utm_source', p_utm_source, 'utm_medium', p_utm_medium, 'utm_campaign', p_utm_campaign,
      'utm_term', p_utm_term, 'utm_content', p_utm_content, 'click_id', p_click_id, 'click_id_type', p_click_id_type,
      'landing_page', p_landing_page, 'referrer', p_referrer, 'form_id', p_form_id, 'form_name', p_form_name,
      'adset_id', p_adset_id, 'adset_name', p_adset_name, 'ad_id', p_ad_id, 'ad_name', p_ad_name
    )),
    'new',
    jsonb_strip_nulls(jsonb_build_object('interest_catalog_item_id', p_interest_catalog_item_id, 'interest_text', nullif(btrim(p_interest_text), ''), 'intake_event_id', v_event_id))
  )
  returning id into v_lead_id;

  update public.lead_intake_events
  set resolved_lead_id = v_lead_id, processing_status = 'processed'
  where id = v_event_id;

  insert into public.touchpoints (
    organization_id, entity_type, entity_id, lead_id, intake_event_id,
    channel, provider, event_type, source, medium, campaign, external_id,
    utm_source, utm_medium, utm_campaign, utm_term, utm_content, click_id, click_id_type,
    occurred_at, metadata
  ) values (
    v_organization_id,
    case when v_resolved_customer_id is not null then 'customer' else 'lead' end,
    coalesce(v_resolved_customer_id, v_lead_id),
    v_lead_id, v_event_id,
    p_channel, p_provider, 'inbound', p_source, p_medium, coalesce(p_campaign_name, p_campaign_id), p_external_id,
    p_utm_source, p_utm_medium, p_utm_campaign, p_utm_term, p_utm_content, p_click_id, p_click_id_type,
    coalesce(p_occurred_at, now()), v_clean_metadata
  );

  perform public.log_activity(
    v_organization_id, 'lead', v_lead_id, 'lead_created', null,
    'Novo lead via ' || p_channel, null,
    jsonb_build_object('provider', p_provider, 'channel', p_channel, 'intake_event_id', v_event_id)
  );

  -- Só loga na timeline do customer quando a identidade JÁ era
  -- conhecida (senão "lead_created" acima já cobre a novidade) — evita
  -- spam de touchpoint em toda entrada nova (briefing §33).
  if v_resolved_customer_id is not null then
    perform public.log_activity(
      v_organization_id, 'customer', v_resolved_customer_id, 'new_inbound_touchpoint', null,
      'Novo contato via ' || p_channel, null,
      jsonb_build_object('provider', p_provider, 'channel', p_channel, 'lead_id', v_lead_id, 'intake_event_id', v_event_id)
    );
  end if;

  update public.lead_intake_endpoints set event_count = event_count + 1, last_event_at = now() where id = v_endpoint.id;

  return jsonb_build_object(
    'status', 'processed', 'event_id', v_event_id, 'lead_id', v_lead_id, 'customer_id', v_resolved_customer_id
  );
exception when others then
  if v_event_id is not null then
    begin
      update public.lead_intake_events set processing_status = 'failed', error_code = sqlstate where id = v_event_id;
    exception when others then null;
    end;
  end if;
  if v_endpoint.id is not null then
    update public.lead_intake_endpoints set event_count = event_count + 1, last_event_at = now() where id = v_endpoint.id;
  end if;
  return jsonb_build_object('status', 'failed', 'error_code', 'PROCESSING_ERROR', 'event_id', v_event_id);
end;
$$;

revoke all on function public.lead_intake_submit(
  text, text, text, text, text, text, text, text, text, text, uuid, text, text, text, text, text,
  text, text, text, text, text, text, text, text, text, text, text, text, text, text, text,
  timestamptz, jsonb, jsonb
) from public, anon, authenticated;
grant execute on function public.lead_intake_submit(
  text, text, text, text, text, text, text, text, text, text, uuid, text, text, text, text, text,
  text, text, text, text, text, text, text, text, text, text, text, text, text, text, text,
  timestamptz, jsonb, jsonb
) to service_role;

commit;
