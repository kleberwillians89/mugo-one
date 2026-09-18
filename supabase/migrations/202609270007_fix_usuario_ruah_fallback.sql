begin;

-- ============================================================
-- MUGÔ ONE — Sprint de Limpeza (Cobrança Universal + Zero Ruah)
--
-- 'Usuário RUAH' era o fallback de nome exibido quando um perfil não
-- tem full_name preenchido — usado em 4 funções (auditoria ampla
-- encontrou uma a mais que a busca textual inicial:
-- assume_shipment_conference, prevent_conference_owner_change (mesmo
-- fallback duplicado, um para o caminho normal e outro para o
-- trigger que bloqueia edição direta da coluna), task_assign e
-- sale_payment_attachments_list). Nenhuma muda de assinatura — só o
-- literal do fallback, via CREATE OR REPLACE, sem risco de overload
-- (ver docs/ACTIVE_LEGACY_COLLECTIONS_AUDIT.md).
-- ============================================================

create or replace function public.assume_shipment_conference(p_shipment_id uuid)
returns shipments
language plpgsql
security definer
set search_path = 'public'
as $function$
declare v public.shipments; actor_name text;
begin
  select * into v from public.shipments where id=p_shipment_id for update;
  if v.id is null or not public.has_org_role(v.organization_id,array['admin','manager','operator']::public.member_role[]) then raise exception 'forbidden'; end if;
  if v.conference_owner_user_id is not null then
    if v.conference_owner_user_id<>auth.uid() then raise exception 'conference_already_owned'; end if;
    return v;
  end if;
  select coalesce((select nullif(btrim(full_name),'') from public.profiles where id=auth.uid()),'Usuário do sistema') into actor_name;
  update public.shipments set conference_owner_user_id=auth.uid(),conference_owner_name_snapshot=actor_name,
    conference_started_at=now(),updated_at=now() where id=v.id returning * into v;
  insert into public.shipment_events(organization_id,shipment_id,event_type,metadata,actor_id)
    values(v.organization_id,v.id,'conference_assumed',jsonb_build_object('owner_name',actor_name),auth.uid());
  return v;
end;$function$;

create or replace function public.prevent_conference_owner_change()
returns trigger
language plpgsql
set search_path = 'public'
as $function$
declare actor_name text;
begin
  if old.conference_owner_user_id is null and new.conference_owner_user_id is not null then
    if auth.uid() is null or new.conference_owner_user_id<>auth.uid() then raise exception 'conference_owner_must_be_authenticated_user'; end if;
    select coalesce((select nullif(btrim(full_name),'') from public.profiles where id=auth.uid()),'Usuário do sistema') into actor_name;
    new.conference_owner_name_snapshot:=actor_name;
    new.conference_started_at:=now();
  elsif old.conference_owner_user_id is not null and
     (new.conference_owner_user_id is distinct from old.conference_owner_user_id or
      new.conference_owner_name_snapshot is distinct from old.conference_owner_name_snapshot or
      new.conference_started_at is distinct from old.conference_started_at) then
    raise exception 'conference_owner_immutable';
  end if;
  if new.conference_completed_at is distinct from old.conference_completed_at then
    if old.conference_completed_at is not null then raise exception 'conference_completion_immutable'; end if;
    if new.conference_completed_at is null or new.conference_owner_user_id is null or new.conference_owner_user_id<>auth.uid() then raise exception 'conference_completion_forbidden'; end if;
    if not public.has_org_role(new.organization_id,array['admin','manager','operator']::public.member_role[]) then raise exception 'forbidden'; end if;
    if not exists(select 1 from public.shipment_items where shipment_id=new.id and removed_at is null) then raise exception 'conference_items_required'; end if;
    if exists(select 1 from public.shipment_items where shipment_id=new.id and removed_at is null and (checked_at is null or divergence_note is not null)) then raise exception 'conference_items_incomplete'; end if;
    new.conference_completed_at:=now();
  end if;
  return new;
end;$function$;

create or replace function public.task_assign(p_entity_type text, p_entity_id uuid, p_assigned_to uuid DEFAULT NULL::uuid)
returns task_assignments
language plpgsql
security definer
set search_path = 'public'
as $function$
declare
  v_org uuid;
  v_target uuid;
  v_name text;
  v_existing public.task_assignments;
  v_row public.task_assignments;
begin
  select organization_id
    into v_org
  from public.organization_members
  where user_id = auth.uid()
  limit 1;

  if v_org is null then
    raise exception 'forbidden';
  end if;

  if not public.has_org_role(
    v_org,
    array['admin','manager','operator']::public.member_role[]
  ) then
    raise exception 'forbidden';
  end if;

  v_target := coalesce(p_assigned_to, auth.uid());

  -- Só admin/manager podem atribuir a outra pessoa.
  -- Operator só pode reivindicar para si.
  if v_target <> auth.uid()
     and not public.has_org_role(
       v_org,
       array['admin','manager']::public.member_role[]
     ) then
    raise exception 'forbidden';
  end if;

  if not exists (
    select 1
    from public.organization_members
    where organization_id = v_org
      and user_id = v_target
  ) then
    raise exception 'assignee_not_in_organization';
  end if;

  select *
    into v_existing
  from public.task_assignments
  where organization_id = v_org
    and entity_type = p_entity_type
    and entity_id = p_entity_id
    and resolved_at is null;

  if v_existing.id is not null then
    if v_existing.assigned_to = v_target then
      return v_existing;
    end if;

    raise exception 'already_assigned_to_someone_else';
  end if;

  select coalesce(
    nullif(btrim(full_name), ''),
    'Usuário do sistema'
  )
    into v_name
  from public.profiles
  where id = v_target;

  insert into public.task_assignments (
    organization_id,
    entity_type,
    entity_id,
    assigned_to,
    assigned_to_name_snapshot,
    assigned_by
  )
  values (
    v_org,
    p_entity_type,
    p_entity_id,
    v_target,
    coalesce(v_name, 'Usuário do sistema'),
    auth.uid()
  )
  returning *
    into v_row;

  insert into public.audit_logs (
    organization_id,
    actor_id,
    action,
    entity_type,
    entity_id,
    metadata
  )
  values (
    v_org,
    auth.uid(),
    'task_assigned',
    p_entity_type,
    p_entity_id::text,
    jsonb_build_object(
      'assigned_to', v_target,
      'assignment_id', v_row.id
    )
  );

  return v_row;
end;
$function$;

create or replace function public.sale_payment_attachments_list(p_sale_id uuid)
returns table(id uuid, sale_id uuid, storage_path text, original_file_name text, mime_type text, file_size bigint, notes text, uploaded_by uuid, uploaded_by_name text, created_at timestamp with time zone)
language sql
stable security definer
set search_path = 'public'
as $function$
 select a.id,a.sale_id,a.storage_path,a.original_file_name,a.mime_type,a.file_size,a.notes,a.uploaded_by,coalesce(p.full_name,'Usuário do sistema'),a.created_at
 from public.sale_payment_attachments a left join public.profiles p on p.id=a.uploaded_by
 where a.sale_id=p_sale_id and a.deleted_at is null and public.has_org_permission(a.organization_id,'sales.edit')
 order by a.created_at desc;
$function$;

commit;
