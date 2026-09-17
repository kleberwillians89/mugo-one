begin;

-- ============================================================
-- MUGÔ ONE — Sprint 3 (CRM Commercial Foundation)
-- Conversão transacional e idempotente de lead.
-- Reaproveita associações existentes e dedupe conservador; qualquer
-- correspondência ambígua é recusada para revisão humana.
-- ============================================================

create or replace function public.convert_lead(
  p_lead_id uuid,
  p_create_customer boolean default false,
  p_create_company boolean default false,
  p_create_contact boolean default false,
  p_create_deal boolean default true,
  p_pipeline_id uuid default null,
  p_stage_id uuid default null,
  p_deal_title text default null,
  p_deal_value numeric default 0
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

  -- Segunda chamada devolve o resultado original e não duplica nada.
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

revoke execute on function public.convert_lead(uuid, boolean, boolean, boolean, boolean, uuid, uuid, text, numeric)
  from public, anon;
grant execute on function public.convert_lead(uuid, boolean, boolean, boolean, boolean, uuid, uuid, text, numeric)
  to authenticated;

commit;
