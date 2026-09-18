begin;

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
    perform public.emit_domain_event(
      v_organization_id, 'identity.conflict', 'lead_intake_event', v_event_id,
      jsonb_build_object('event_id', v_event_id, 'provider', p_provider, 'channel', p_channel),
      'lead_intake_submit', null, v_event_id, null
    );
    return jsonb_build_object('status', 'identity_conflict', 'event_id', v_event_id, 'error_code', 'IDENTITY_CONFLICT');
  end if;

  v_name := coalesce(nullif(btrim(p_name), ''), nullif(split_part(coalesce(p_email,''), '@', 1), ''), 'Lead sem nome');

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

  if v_resolved_customer_id is not null then
    perform public.log_activity(
      v_organization_id, 'customer', v_resolved_customer_id, 'new_inbound_touchpoint', null,
      'Novo contato via ' || p_channel, null,
      jsonb_build_object('provider', p_provider, 'channel', p_channel, 'lead_id', v_lead_id, 'intake_event_id', v_event_id)
    );
  end if;

  update public.lead_intake_endpoints set event_count = event_count + 1, last_event_at = now() where id = v_endpoint.id;

  -- Payload mínimo (briefing §42) — sem telefone/documento/payload
  -- bruto, só o suficiente para condições de automação úteis
  -- (interesse, canal de origem).
  perform public.emit_domain_event(
    v_organization_id, 'lead.created', 'lead', v_lead_id,
    jsonb_build_object('lead_id', v_lead_id, 'customer_id', v_resolved_customer_id, 'name', v_name, 'interest', p_interest_text, 'source_channel', p_channel),
    'lead_intake_submit', null, v_event_id, null
  );
  perform public.emit_domain_event(
    v_organization_id, 'lead_intake.processed', 'lead_intake_event', v_event_id,
    jsonb_build_object('event_id', v_event_id, 'lead_id', v_lead_id, 'status', 'processed'),
    'lead_intake_submit', null, v_event_id, null
  );

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

create or replace function public.convert_lead(
  p_lead_id uuid, p_create_customer boolean default false, p_create_company boolean default false,
  p_create_contact boolean default false, p_create_deal boolean default true,
  p_pipeline_id uuid default null, p_stage_id uuid default null, p_deal_title text default null, p_deal_value numeric default 0
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_lead public.leads;
  v_customer_id uuid;
  v_company_id uuid;
  v_contact_id uuid;
  v_deal_id uuid;
  v_pipeline_id uuid;
  v_stage_id uuid;
  v_match_count integer;
  v_normalized_name text;
  v_normalized_email text;
  v_normalized_phone text;
begin
  select * into v_lead
  from public.leads
  where id = p_lead_id
    and organization_id in (select public.current_user_org_ids())
  for update;
  if not found then raise exception 'lead_not_found'; end if;

  if not public.has_org_permission(v_lead.organization_id, 'crm.leads.manage') then
    raise exception 'forbidden';
  end if;
  if p_create_deal and not public.has_org_permission(v_lead.organization_id, 'crm.deals.manage') then
    raise exception 'forbidden';
  end if;

  if v_lead.converted_at is not null then
    return jsonb_build_object(
      'lead_id', v_lead.id,
      'customer_id', coalesce(v_lead.converted_customer_id, v_lead.customer_id),
      'company_id', v_lead.company_id,
      'contact_id', v_lead.contact_id,
      'deal_id', v_lead.converted_deal_id,
      'already_converted', true
    );
  end if;

  v_customer_id := v_lead.customer_id;
  v_company_id := v_lead.company_id;
  v_contact_id := v_lead.contact_id;
  v_normalized_name := public.normalize_person_name(v_lead.name);
  v_normalized_email := nullif(lower(btrim(coalesce(v_lead.email, ''))), '');
  v_normalized_phone := public.normalize_br_phone(coalesce(v_lead.whatsapp, v_lead.phone));

  if p_create_customer and v_customer_id is null then
    select count(*)::integer, (array_agg(c.id order by c.id))[1]
      into v_match_count, v_customer_id
    from public.clients c
    where c.organization_id = v_lead.organization_id
      and c.deleted_at is null
      and c.merged_into_id is null
      and (
        (v_normalized_email is not null and c.normalized_email = v_normalized_email)
        or (v_normalized_phone is not null and (c.normalized_phone = v_normalized_phone or c.normalized_whatsapp = v_normalized_phone))
        or (v_normalized_email is null and v_normalized_phone is null and c.normalized_name = v_normalized_name)
      );
    if v_match_count > 1 then raise exception 'lead_customer_match_ambiguous'; end if;

    if v_match_count = 0 then
      insert into public.clients(
        organization_id, name, original_name, normalized_name, email, phone, whatsapp_phone,
        status, source, registration_origin, owner_user_id, source_channel, source_medium,
        source_campaign, source_external_id, attribution_metadata, metadata, created_by
      ) values (
        v_lead.organization_id, v_lead.name, v_lead.name, v_normalized_name,
        v_lead.email, v_lead.phone, v_lead.whatsapp, 'active', v_lead.source,
        'lead_conversion', v_lead.owner_user_id, v_lead.source_channel, v_lead.source_medium,
        v_lead.source_campaign, v_lead.source_external_id, v_lead.attribution_metadata,
        v_lead.metadata, coalesce(v_lead.created_by, auth.uid())
      ) returning id into v_customer_id;
    end if;
  end if;

  if p_create_company and v_company_id is null then
    if nullif(btrim(coalesce(v_lead.company_name, '')), '') is null then
      raise exception 'lead_company_name_required';
    end if;
    v_normalized_name := public.normalize_person_name(v_lead.company_name);
    select count(*)::integer, (array_agg(c.id order by c.id))[1]
      into v_match_count, v_company_id
    from public.companies c
    where c.organization_id = v_lead.organization_id
      and c.deleted_at is null
      and c.normalized_name = v_normalized_name;
    if v_match_count > 1 then raise exception 'lead_company_match_ambiguous'; end if;
    if v_match_count = 0 then
      insert into public.companies(
        organization_id, name, normalized_name, email, phone, owner_user_id,
        status, source_channel, source_medium, source_campaign, source_external_id,
        attribution_metadata, metadata, created_by
      ) values (
        v_lead.organization_id, btrim(v_lead.company_name), v_normalized_name,
        v_lead.email, v_lead.phone, v_lead.owner_user_id, 'active',
        v_lead.source_channel, v_lead.source_medium, v_lead.source_campaign,
        v_lead.source_external_id, v_lead.attribution_metadata, v_lead.metadata,
        coalesce(v_lead.created_by, auth.uid())
      ) returning id into v_company_id;
    end if;
  end if;

  if p_create_contact and v_contact_id is null then
    v_normalized_name := public.normalize_person_name(v_lead.name);
    select count(*)::integer, (array_agg(c.id order by c.id))[1]
      into v_match_count, v_contact_id
    from public.contacts c
    where c.organization_id = v_lead.organization_id
      and c.deleted_at is null
      and (
        (v_normalized_email is not null and lower(btrim(c.email)) = v_normalized_email)
        or (v_normalized_phone is not null and public.normalize_br_phone(coalesce(c.whatsapp_phone, c.phone)) = v_normalized_phone)
        or (v_normalized_email is null and v_normalized_phone is null and c.normalized_name = v_normalized_name)
      );
    if v_match_count > 1 then raise exception 'lead_contact_match_ambiguous'; end if;
    if v_match_count = 0 then
      insert into public.contacts(
        organization_id, company_id, customer_id, name, normalized_name, email, phone,
        whatsapp_phone, is_primary, owner_user_id, metadata, created_by
      ) values (
        v_lead.organization_id, v_company_id, v_customer_id, v_lead.name,
        v_normalized_name, v_lead.email, v_lead.phone, v_lead.whatsapp,
        true, v_lead.owner_user_id, v_lead.metadata, coalesce(v_lead.created_by, auth.uid())
      ) returning id into v_contact_id;
    end if;
  end if;

  if p_create_deal then
    if p_stage_id is not null then
      select ps.pipeline_id, ps.id into v_pipeline_id, v_stage_id
      from public.pipeline_stages ps
      join public.pipelines p on p.id = ps.pipeline_id
      where ps.id = p_stage_id
        and ps.organization_id = v_lead.organization_id
        and ps.active and p.active
        and (p_pipeline_id is null or p.id = p_pipeline_id);
      if not found then raise exception 'invalid_conversion_stage'; end if;
    else
      v_pipeline_id := p_pipeline_id;
      if v_pipeline_id is null then
        select id into v_pipeline_id from public.pipelines
        where organization_id = v_lead.organization_id and is_default and active;
      end if;
      if v_pipeline_id is null then raise exception 'default_pipeline_not_found'; end if;

      select id into v_stage_id from public.pipeline_stages
      where organization_id = v_lead.organization_id
        and pipeline_id = v_pipeline_id and active and stage_type = 'open'
      order by position, created_at limit 1;
      if v_stage_id is null then raise exception 'open_pipeline_stage_not_found'; end if;
    end if;

    insert into public.deals(
      organization_id, pipeline_id, stage_id, customer_id, company_id, contact_id, lead_id,
      title, value, owner_user_id, source, source_channel, source_medium, source_campaign,
      source_external_id, attribution_metadata, metadata, created_by
    ) values (
      v_lead.organization_id, v_pipeline_id, v_stage_id, v_customer_id, v_company_id,
      v_contact_id, v_lead.id, coalesce(nullif(btrim(p_deal_title), ''), v_lead.name),
      coalesce(p_deal_value, 0), v_lead.owner_user_id, v_lead.source,
      v_lead.source_channel, v_lead.source_medium, v_lead.source_campaign,
      v_lead.source_external_id, v_lead.attribution_metadata, v_lead.metadata,
      coalesce(v_lead.created_by, auth.uid())
    ) returning id into v_deal_id;
  end if;

  update public.leads set
    customer_id = v_customer_id,
    company_id = v_company_id,
    contact_id = v_contact_id,
    status = 'converted',
    converted_at = now(),
    converted_customer_id = v_customer_id,
    converted_deal_id = v_deal_id
  where id = v_lead.id;

  perform public.emit_domain_event(
    v_lead.organization_id, 'lead.converted', 'lead', v_lead.id,
    jsonb_build_object('lead_id', v_lead.id, 'customer_id', v_customer_id, 'company_id', v_company_id, 'contact_id', v_contact_id, 'deal_id', v_deal_id),
    'convert_lead', auth.uid(), null, null
  );

  return jsonb_build_object(
    'lead_id', v_lead.id,
    'customer_id', v_customer_id,
    'company_id', v_company_id,
    'contact_id', v_contact_id,
    'deal_id', v_deal_id,
    'already_converted', false
  );
end;
$$;

create or replace function public.move_deal_stage(p_deal_id uuid, p_destination_stage_id uuid)
returns public.deals
language plpgsql
security definer
set search_path = public
as $$
declare
  v_deal public.deals;
  v_from_stage_id uuid;
  v_destination_stage_type text;
begin
  select * into v_deal
  from public.deals
  where id = p_deal_id
    and organization_id in (select public.current_user_org_ids())
  for update;
  if not found then raise exception 'deal_not_found'; end if;

  if not public.has_org_permission(v_deal.organization_id, 'crm.deals.manage') then
    raise exception 'forbidden';
  end if;

  select stage_type into v_destination_stage_type
  from public.pipeline_stages
  where id = p_destination_stage_id
    and organization_id = v_deal.organization_id
    and pipeline_id = v_deal.pipeline_id
    and active;
  if not found then raise exception 'invalid_destination_stage'; end if;

  if v_deal.stage_id = p_destination_stage_id then return v_deal; end if;

  v_from_stage_id := v_deal.stage_id;

  update public.deals
  set stage_id = p_destination_stage_id
  where id = p_deal_id
  returning * into v_deal;

  perform public.emit_domain_event(
    v_deal.organization_id, 'deal.stage_changed', 'deal', v_deal.id,
    jsonb_build_object('deal_id', v_deal.id, 'from_stage_id', v_from_stage_id, 'to_stage_id', p_destination_stage_id),
    'move_deal_stage', auth.uid(), null, null
  );
  if v_destination_stage_type = 'won' then
    perform public.emit_domain_event(
      v_deal.organization_id, 'deal.won', 'deal', v_deal.id,
      jsonb_build_object('deal_id', v_deal.id, 'stage_id', p_destination_stage_id, 'value', v_deal.value),
      'move_deal_stage', auth.uid(), null, null
    );
  elsif v_destination_stage_type = 'lost' then
    perform public.emit_domain_event(
      v_deal.organization_id, 'deal.lost', 'deal', v_deal.id,
      jsonb_build_object('deal_id', v_deal.id, 'stage_id', p_destination_stage_id, 'value', v_deal.value),
      'move_deal_stage', auth.uid(), null, null
    );
  end if;

  return v_deal;
end;
$$;

create or replace function public.create_sale_with_items(
  p_organization_id uuid, p_client_id uuid, p_items jsonb, p_sale_date date default current_date,
  p_payment_status text default 'unknown', p_payment_method text default null, p_paid_at date default null,
  p_owner_user_id uuid default null, p_source text default 'manual', p_source_channel text default null,
  p_source_medium text default null, p_source_campaign text default null, p_source_external_id text default null,
  p_attribution_metadata jsonb default '{}'::jsonb, p_notes text default null, p_metadata jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_item jsonb;
  v_item_count integer := 0;
  v_position integer := 0;
  v_catalog_item_id uuid;
  v_description text;
  v_quantity numeric;
  v_unit text;
  v_unit_price numeric;
  v_discount numeric;
  v_line_total numeric(14,2);
  v_subtotal numeric(14,2) := 0;
  v_discount_total numeric(14,2) := 0;
  v_total numeric(14,2) := 0;
  v_sale_id uuid;
  v_actor uuid := auth.uid();
begin
  if not public.has_org_permission(p_organization_id, 'sales.create') then
    raise exception 'forbidden';
  end if;

  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) < 1 then
    raise exception 'sale_requires_at_least_one_item';
  end if;

  if not exists (
    select 1 from public.clients
    where id = p_client_id and organization_id = p_organization_id and deleted_at is null
  ) then
    raise exception 'sale_client_organization_mismatch';
  end if;

  if p_owner_user_id is not null and not exists (
    select 1 from public.organization_members
    where organization_id = p_organization_id and user_id = p_owner_user_id and status = 'active'
  ) then
    raise exception 'sale_owner_not_a_member';
  end if;

  for v_item in select * from jsonb_array_elements(p_items) loop
    v_catalog_item_id := nullif(v_item->>'catalog_item_id', '')::uuid;
    v_description := btrim(coalesce(v_item->>'description', ''));
    v_quantity := (v_item->>'quantity')::numeric;
    v_unit := coalesce(nullif(btrim(coalesce(v_item->>'unit', '')), ''), 'un');
    v_unit_price := (v_item->>'unit_price')::numeric;
    v_discount := coalesce((v_item->>'discount_amount')::numeric, 0);

    if v_catalog_item_id is not null and not exists (
      select 1 from public.catalog_items
      where id = v_catalog_item_id and organization_id = p_organization_id and active
    ) then
      raise exception 'sale_item_catalog_item_invalid';
    end if;
    if v_description = '' then raise exception 'sale_item_description_required'; end if;
    if v_quantity is null or v_quantity <= 0 then raise exception 'sale_item_quantity_invalid'; end if;
    if v_unit_price is null or v_unit_price < 0 then raise exception 'sale_item_unit_price_invalid'; end if;
    if v_discount < 0 then raise exception 'sale_item_discount_invalid'; end if;

    v_line_total := round(v_quantity * v_unit_price - v_discount, 2);
    if v_line_total < 0 then raise exception 'sale_item_discount_exceeds_line_value'; end if;

    v_subtotal := v_subtotal + round(v_quantity * v_unit_price, 2);
    v_discount_total := v_discount_total + v_discount;
    v_total := v_total + v_line_total;
    v_item_count := v_item_count + 1;
  end loop;

  insert into public.sales (
    organization_id, client_id, sale_date, amount, payment_status, payment_method, paid_at,
    status, subtotal, discount_total, total_amount, owner_user_id, source, source_channel,
    source_medium, source_campaign, source_external_id, attribution_metadata, notes, metadata,
    created_by
  ) values (
    p_organization_id, p_client_id, p_sale_date, v_total, p_payment_status::payment_status, p_payment_method, p_paid_at,
    'open', v_subtotal, v_discount_total, v_total, p_owner_user_id, p_source, p_source_channel,
    p_source_medium, p_source_campaign, p_source_external_id, coalesce(p_attribution_metadata, '{}'::jsonb),
    p_notes, coalesce(p_metadata, '{}'::jsonb), coalesce(v_actor, auth.uid())
  ) returning id into v_sale_id;

  for v_item in select * from jsonb_array_elements(p_items) loop
    v_catalog_item_id := nullif(v_item->>'catalog_item_id', '')::uuid;
    v_description := btrim(v_item->>'description');
    v_quantity := (v_item->>'quantity')::numeric;
    v_unit := coalesce(nullif(btrim(coalesce(v_item->>'unit', '')), ''), 'un');
    v_unit_price := (v_item->>'unit_price')::numeric;
    v_discount := coalesce((v_item->>'discount_amount')::numeric, 0);
    v_line_total := round(v_quantity * v_unit_price - v_discount, 2);

    insert into public.sale_items (
      organization_id, sale_id, catalog_item_id, description, quantity, unit,
      unit_price, discount_amount, total_amount, position
    ) values (
      p_organization_id, v_sale_id, v_catalog_item_id, v_description,
      v_quantity, v_unit, v_unit_price, v_discount, v_line_total, v_position
    );
    v_position := v_position + 1;
  end loop;

  perform public.log_activity(
    p_organization_id, 'sale', v_sale_id, 'sale_created', v_actor,
    'Venda criada', format('%s item(ns) · total %s', v_item_count, v_total),
    jsonb_build_object('item_count', v_item_count, 'total_amount', v_total)
  );

  perform public.emit_domain_event(
    p_organization_id, 'sale.created', 'sale', v_sale_id,
    jsonb_build_object('sale_id', v_sale_id, 'client_id', p_client_id, 'total_amount', v_total, 'item_count', v_item_count),
    'create_sale_with_items', v_actor, null, null
  );

  return jsonb_build_object(
    'sale_id', v_sale_id,
    'subtotal', v_subtotal,
    'discount_total', v_discount_total,
    'total_amount', v_total,
    'item_count', v_item_count
  );
end;
$$;

commit;
