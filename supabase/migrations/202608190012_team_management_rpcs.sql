begin;

-- RUAH — RPCs de gestão de equipe, sobre o helper has_org_permission
-- criado em 202608190011. Nenhuma tabela nova aqui.

-- ---------------------------------------------------------------------
-- 1. Resumo de permissões do PRÓPRIO caller — usado pelo frontend logo
--    após login para montar menu/rotas (seção "BACKEND AUTHORITY": "Não
--    usar somente localStorage/context React" — o frontend consome isto,
--    nunca decide sozinho).
-- ---------------------------------------------------------------------
create or replace function public.my_permission_summary(org_id uuid)
returns table(permission_code text, granted boolean)
language sql
stable
security definer
set search_path = public
as $$
  select p.code, public.has_org_permission(org_id, p.code)
  from public.permissions p
  order by p.sort_order;
$$;
grant execute on function public.my_permission_summary(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------
-- 2. Listagem da equipe (Configurações → Equipe e acessos). auth.users
--    só é legível de dentro de uma função SECURITY DEFINER — é o único
--    lugar do app que precisa do e-mail/username interno para exibição.
-- ---------------------------------------------------------------------
create or replace function public.team_members(org_id uuid)
returns table(
  user_id uuid, full_name text, email text, role public.member_role,
  permission_preset text, view_all boolean, access_total boolean, status text,
  permission_overrides integer, created_at timestamptz
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.has_org_permission(org_id, 'team.view') then
    raise exception 'forbidden';
  end if;
  return query
    select om.user_id, coalesce(nullif(btrim(p.full_name), ''), 'Sem nome'), u.email::text, om.role,
      om.permission_preset, om.view_all, om.access_total, om.status,
      (select count(*)::integer from public.organization_member_permissions omp
        where omp.organization_id = om.organization_id and omp.user_id = om.user_id),
      om.created_at
    from public.organization_members om
    join public.profiles p on p.id = om.user_id
    join auth.users u on u.id = om.user_id
    where om.organization_id = org_id
    order by p.full_name nulls last;
end;
$$;
grant execute on function public.team_members(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------
-- 2b. Concessões granulares de UM membro específico — usado só para
--     pré-preencher a grade de checkboxes ao editar (team_members acima
--     só devolve a CONTAGEM, não os códigos). Mesma exigência de
--     team.view do caller; nunca expõe permissões de outra organização
--     (o join já escopa por organization_id).
-- ---------------------------------------------------------------------
create or replace function public.team_member_permissions(org_id uuid, target_user_id uuid)
returns table(permission_code text, granted boolean)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.has_org_permission(org_id, 'team.view') then
    raise exception 'forbidden';
  end if;
  return query
    select omp.permission_code, omp.granted
    from public.organization_member_permissions omp
    where omp.organization_id = org_id and omp.user_id = target_user_id;
end;
$$;
grant execute on function public.team_member_permissions(uuid, uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------
-- 3. Aplicar preset + flags + overrides pessoais num membro existente.
--    Overrides substituem por completo o conjunto anterior de concessões
--    granulares (o preset é reaplicado do zero, depois os overrides
--    explícitos entram por cima) — evita "lixo" de permissões de um
--    preset anterior sobrevivendo à troca de preset.
--
--    AUTOESCALAÇÃO: só quem já tem team.manage pode chamar isto —
--    inclusive para editar A SI MESMO. Ninguém sem team.manage consegue
--    se autoconceder nada por este caminho (a própria checagem de
--    entrada barra).
--
--    ÚLTIMO ADMIN: a mudança é aplicada e só DEPOIS verificada — se
--    zerar quem tem team.manage na organização, a função inteira levanta
--    exceção e o Postgres desfaz tudo (mesma transação implícita da
--    chamada).
-- ---------------------------------------------------------------------
create or replace function public.team_set_permissions(
  p_organization_id uuid,
  p_target_user_id uuid,
  p_preset text,
  p_view_all boolean,
  p_access_total boolean,
  p_overrides jsonb default '[]'::jsonb
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_item jsonb;
begin
  if not public.has_org_permission(p_organization_id, 'team.manage') then
    raise exception 'forbidden';
  end if;

  perform 1 from public.organization_members
    where organization_id = p_organization_id and user_id = p_target_user_id for update;
  if not found then
    raise exception 'member_not_found';
  end if;

  if p_preset not in ('administrador','gestor','comercial','entregas','estoque','visualizacao','personalizado') then
    raise exception 'invalid_preset';
  end if;

  delete from public.organization_member_permissions
    where organization_id = p_organization_id and user_id = p_target_user_id;

  insert into public.organization_member_permissions(organization_id, user_id, permission_code, granted)
  select p_organization_id, p_target_user_id, pp.permission_code, true
  from public.preset_permissions pp
  where pp.preset = p_preset;

  for v_item in select * from jsonb_array_elements(coalesce(p_overrides, '[]'::jsonb)) loop
    insert into public.organization_member_permissions(organization_id, user_id, permission_code, granted)
    values (p_organization_id, p_target_user_id, v_item->>'code', (v_item->>'granted')::boolean)
    on conflict (organization_id, user_id, permission_code)
    do update set granted = excluded.granted, updated_at = now();
  end loop;

  update public.organization_members set
    permission_preset = p_preset,
    view_all = p_view_all,
    access_total = p_access_total
  where organization_id = p_organization_id and user_id = p_target_user_id;

  if public.org_admin_count(p_organization_id) = 0 then
    raise exception 'cannot_remove_last_admin';
  end if;

  insert into public.audit_logs(organization_id, actor_id, action, entity_type, entity_id, metadata)
  values (
    p_organization_id, auth.uid(), 'user_permissions_changed', 'organization_member', p_target_user_id::text,
    jsonb_build_object('preset', p_preset, 'view_all', p_view_all, 'access_total', p_access_total, 'overrides', p_overrides)
  );
end;
$$;
grant execute on function public.team_set_permissions(uuid, uuid, text, boolean, boolean, jsonb) to authenticated, service_role;

-- ---------------------------------------------------------------------
-- 4. Ativar/desativar membro. Nunca apaga nada — histórico e auditoria
--    permanecem intactos, só o acesso é bloqueado (has_org_permission
--    já nega tudo para status<>'active').
-- ---------------------------------------------------------------------
create or replace function public.team_set_status(
  p_organization_id uuid,
  p_target_user_id uuid,
  p_status text
) returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.has_org_permission(p_organization_id, 'team.manage') then
    raise exception 'forbidden';
  end if;
  if p_status not in ('active','inactive') then
    raise exception 'invalid_status';
  end if;

  update public.organization_members set status = p_status
    where organization_id = p_organization_id and user_id = p_target_user_id;
  if not found then
    raise exception 'member_not_found';
  end if;

  if public.org_admin_count(p_organization_id) = 0 then
    raise exception 'cannot_remove_last_admin';
  end if;

  insert into public.audit_logs(organization_id, actor_id, action, entity_type, entity_id, metadata)
  values (
    p_organization_id, auth.uid(),
    case when p_status = 'active' then 'user_reactivated' else 'user_deactivated' end,
    'organization_member', p_target_user_id::text, jsonb_build_object('status', p_status)
  );
end;
$$;
grant execute on function public.team_set_status(uuid, uuid, text) to authenticated, service_role;

-- ---------------------------------------------------------------------
-- 5. Provisionamento pós-criação do usuário no Supabase Auth. SÓ
--    service_role pode chamar (grant abaixo NUNCA inclui authenticated)
--    — a única forma de invocar isto é a Edge Function admin-create-user,
--    depois de já ter verificado team.manage do caller usando o client
--    do PRÓPRIO caller (RLS real), e já ter criado o usuário via Admin
--    API. Esta função nunca reavalia autorização: nesse ponto a
--    autoridade já foi checada, ela só grava.
-- ---------------------------------------------------------------------
create or replace function public.team_provision_member(
  p_organization_id uuid,
  p_user_id uuid,
  p_full_name text,
  p_preset text,
  p_view_all boolean,
  p_access_total boolean,
  p_actor_id uuid
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role public.member_role;
begin
  if p_preset not in ('administrador','gestor','comercial','entregas','estoque','visualizacao','personalizado') then
    raise exception 'invalid_preset';
  end if;

  v_role := case p_preset
    when 'administrador' then 'admin'
    when 'gestor' then 'manager'
    when 'visualizacao' then 'viewer'
    else 'operator'
  end;

  -- handle_new_user() já deve ter criado a linha (trigger em auth.users),
  -- mas o upsert é defensivo — nunca confiar cegamente que rodou antes.
  insert into public.profiles(id, full_name) values (p_user_id, p_full_name)
  on conflict (id) do update set full_name = excluded.full_name;

  insert into public.organization_members(
    organization_id, user_id, role, status, permission_preset, view_all, access_total
  ) values (
    p_organization_id, p_user_id, v_role, 'active', p_preset, p_view_all, p_access_total
  );

  insert into public.organization_member_permissions(organization_id, user_id, permission_code, granted)
  select p_organization_id, p_user_id, pp.permission_code, true
  from public.preset_permissions pp
  where pp.preset = p_preset;

  insert into public.audit_logs(organization_id, actor_id, action, entity_type, entity_id, metadata)
  values (
    p_organization_id, p_actor_id, 'user_created', 'organization_member', p_user_id::text,
    jsonb_build_object('preset', p_preset, 'view_all', p_view_all, 'access_total', p_access_total)
  );
end;
$$;
grant execute on function public.team_provision_member(uuid, uuid, text, text, boolean, boolean, uuid) to service_role;

commit;
