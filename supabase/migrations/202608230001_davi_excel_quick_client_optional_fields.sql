begin;

create or replace function public.davi_excel_create_client(
  p_organization_id uuid,
  p_payload jsonb,
  p_force_similar boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare
  v_uid uuid := auth.uid();
  v_name text := nullif(btrim(coalesce(p_payload->>'name', '')), '');
  v_normalized_name text := public.normalize_person_name(p_payload->>'name');
  v_phone text := nullif(public.normalize_br_phone(nullif(btrim(coalesce(p_payload->>'phone', '')), '')), '');
  v_email text := nullif(lower(btrim(coalesce(p_payload->>'email', ''))), '');
  v_cpf text := nullif(public.only_digits(nullif(btrim(coalesce(p_payload->>'cpf', '')), '')), '');
  v_candidates jsonb;
  v_hard_duplicate boolean;
  v_created public.clients;
begin
  if v_uid is null then raise exception 'authentication_required'; end if;
  if not public.has_org_permission(p_organization_id, 'clients.create') then raise exception 'permission_denied'; end if;
  if v_name is null or v_normalized_name is null or v_normalized_name = '' then raise exception 'client_name_required'; end if;
  if v_email is not null and v_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then raise exception 'invalid_email'; end if;
  if v_cpf is not null and length(v_cpf) <> 11 then raise exception 'invalid_cpf'; end if;
  if v_phone is not null and length(v_phone) not in (12, 13) then raise exception 'invalid_phone'; end if;

  select
    coalesce(jsonb_agg(jsonb_build_object(
      'id', c.id,
      'name', c.name,
      'reason', case
        when c.normalized_name = v_normalized_name then 'Mesmo nome'
        when v_cpf is not null and c.normalized_cpf = v_cpf then 'Mesmo CPF'
        when v_email is not null and c.normalized_email = v_email then 'Mesmo e-mail'
        when v_phone is not null and (c.normalized_phone = v_phone or c.normalized_whatsapp = v_phone) then 'Mesmo telefone'
        else 'Nome parecido'
      end,
      'exact', c.normalized_name = v_normalized_name
        or (v_cpf is not null and c.normalized_cpf = v_cpf)
        or (v_email is not null and c.normalized_email = v_email)
        or (v_phone is not null and (c.normalized_phone = v_phone or c.normalized_whatsapp = v_phone))
    ) order by c.normalized_name), '[]'::jsonb),
    coalesce(bool_or(
      c.normalized_name = v_normalized_name
      or (v_cpf is not null and c.normalized_cpf = v_cpf)
      or (v_email is not null and c.normalized_email = v_email)
      or (v_phone is not null and (c.normalized_phone = v_phone or c.normalized_whatsapp = v_phone))
    ), false)
  into v_candidates, v_hard_duplicate
  from public.clients as c
  where c.organization_id = p_organization_id
    and c.deleted_at is null
    and c.merged_into_id is null
    and (
      c.normalized_name = v_normalized_name
      or split_part(c.normalized_name, ' ', 1) = split_part(v_normalized_name, ' ', 1)
      or position(v_normalized_name in c.normalized_name) > 0
      or position(c.normalized_name in v_normalized_name) > 0
      or (v_cpf is not null and c.normalized_cpf = v_cpf)
      or (v_email is not null and c.normalized_email = v_email)
      or (v_phone is not null and (c.normalized_phone = v_phone or c.normalized_whatsapp = v_phone))
    );

  if jsonb_array_length(v_candidates) > 0 and (not p_force_similar or v_hard_duplicate) then
    return jsonb_build_object(
      'status', 'duplicate',
      'candidates', v_candidates,
      'force_allowed', not v_hard_duplicate
    );
  end if;

  insert into public.clients as c (
    organization_id, name, original_name, normalized_name, status, source, registration_origin,
    phone, whatsapp_phone, email, cpf, created_by
  ) values (
    p_organization_id, v_name, v_name, v_normalized_name, 'active', 'davi_excel', 'davi_excel',
    v_phone, v_phone, v_email, v_cpf, v_uid
  ) returning c.* into v_created;

  return jsonb_build_object(
    'status', 'created',
    'client', jsonb_build_object('id', v_created.id, 'name', v_created.name)
  );
exception when unique_violation then
  return jsonb_build_object(
    'status', 'duplicate',
    'candidates', coalesce(v_candidates, '[]'::jsonb),
    'force_allowed', false
  );
end;
$$;

revoke all on function public.davi_excel_create_client(uuid, jsonb, boolean) from public, anon;
grant execute on function public.davi_excel_create_client(uuid, jsonb, boolean) to authenticated;

commit;
