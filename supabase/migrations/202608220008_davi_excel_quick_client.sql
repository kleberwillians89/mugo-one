begin;

create or replace function public.davi_excel_create_client(
  p_organization_id uuid,
  p_payload jsonb,
  p_force_similar boolean default false
)
returns jsonb language plpgsql security definer set search_path=public as $$
declare
  uid uuid:=auth.uid();
  normalized text:=public.normalize_person_name(p_payload->>'name');
  phone text:=public.normalize_br_phone(p_payload->>'phone');
  email text:=nullif(lower(btrim(coalesce(p_payload->>'email',''))),'');
  cpf text:=public.only_digits(p_payload->>'cpf');
  candidates jsonb;
  hard_duplicate boolean;
  created public.clients;
begin
  if uid is null then raise exception 'authentication_required'; end if;
  if not public.has_org_permission(p_organization_id,'clients.create') then raise exception 'permission_denied'; end if;
  if normalized is null or normalized='' then raise exception 'client_name_required'; end if;
  if email is not null and email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then raise exception 'invalid_email'; end if;
  if cpf is not null and length(cpf)<>11 then raise exception 'invalid_cpf'; end if;
  if phone is not null and length(phone) not in(12,13) then raise exception 'invalid_phone'; end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id',c.id,'name',c.name,
    'reason',case
      when c.normalized_name=normalized then 'Mesmo nome'
      when cpf is not null and c.normalized_cpf=cpf then 'Mesmo CPF'
      when email is not null and c.normalized_email=email then 'Mesmo e-mail'
      when phone is not null and (c.normalized_phone=phone or c.normalized_whatsapp=phone) then 'Mesmo telefone'
      else 'Nome parecido' end,
    'exact',c.normalized_name=normalized
      or (cpf is not null and c.normalized_cpf=cpf)
      or (email is not null and c.normalized_email=email)
      or (phone is not null and (c.normalized_phone=phone or c.normalized_whatsapp=phone))
  ) order by c.normalized_name),'[]'::jsonb),
  coalesce(bool_or(
    c.normalized_name=normalized
    or (cpf is not null and c.normalized_cpf=cpf)
    or (email is not null and c.normalized_email=email)
    or (phone is not null and (c.normalized_phone=phone or c.normalized_whatsapp=phone))
  ),false)
  into candidates,hard_duplicate
  from public.clients c
  where c.organization_id=p_organization_id
    and c.deleted_at is null and c.merged_into_id is null
    and (
      c.normalized_name=normalized
      or split_part(c.normalized_name,' ',1)=split_part(normalized,' ',1)
      or position(normalized in c.normalized_name)>0
      or position(c.normalized_name in normalized)>0
      or (cpf is not null and c.normalized_cpf=cpf)
      or (email is not null and c.normalized_email=email)
      or (phone is not null and (c.normalized_phone=phone or c.normalized_whatsapp=phone))
    );

  if jsonb_array_length(candidates)>0 and (not p_force_similar or hard_duplicate) then
    return jsonb_build_object('status','duplicate','candidates',candidates,'force_allowed',not hard_duplicate);
  end if;

  insert into public.clients(
    organization_id,name,original_name,normalized_name,status,source,registration_origin,
    phone,whatsapp_phone,email,cpf,created_by
  ) values(
    p_organization_id,btrim(p_payload->>'name'),btrim(p_payload->>'name'),normalized,'active',
    'davi_excel','davi_excel',nullif(btrim(p_payload->>'phone'),''),nullif(btrim(p_payload->>'phone'),''),
    email,nullif(btrim(p_payload->>'cpf'),''),uid
  ) returning * into created;

  return jsonb_build_object('status','created','client',jsonb_build_object('id',created.id,'name',created.name));
exception when unique_violation then
  return jsonb_build_object('status','duplicate','candidates',coalesce(candidates,'[]'::jsonb),'force_allowed',false);
end;$$;

revoke all on function public.davi_excel_create_client(uuid,jsonb,boolean) from public,anon;
grant execute on function public.davi_excel_create_client(uuid,jsonb,boolean) to authenticated;

commit;
