begin;

insert into public.permissions(code,module,label,sort_order) values
  ('tasks.sales','tasks','Tarefas de vendas',121),
  ('tasks.split','tasks','Tarefas de split',122),
  ('tasks.shipping','tasks','Tarefas de entregas',123),
  ('tasks.management','tasks','Tarefas de gestão',124)
on conflict(code) do update set module=excluded.module,label=excluded.label,sort_order=excluded.sort_order;

insert into public.preset_permissions(preset,permission_code) values
  ('comercial','tasks.sales'),('entregas','tasks.shipping'),('gestor','tasks.management')
on conflict do nothing;

do $$
declare org uuid;expected integer;
begin
  select organization_id into org from public.organization_members where user_id='3f34fe2b-87c4-466c-8f4c-71400efa8fed'::uuid;
  select count(*) into expected from public.organization_members om join public.profiles p on p.id=om.user_id
   where om.organization_id=org and (
    (om.user_id='13656252-6409-4af3-beb6-542961ef6739'::uuid and lower(p.full_name)='davi' and om.status='active') or
    (om.user_id='5ac41b3d-f821-4644-a5c8-731967d14474'::uuid and lower(p.full_name)='emily' and om.status='active') or
    (om.user_id='9cd6b01c-08b6-47ff-8ed0-699beade1306'::uuid and lower(p.full_name)='ilde' and om.status='active') or
    (om.user_id='3c065c51-8aa2-49a2-a956-bf78bd8d0e8e'::uuid and lower(p.full_name)='gabriel' and om.status='active') or
    (om.user_id='bae5c132-1618-4da2-940b-be84dcae4bb4'::uuid and lower(p.full_name)='gabriel' and om.status='inactive')
   );
  if org is null or expected<>5 then raise exception 'task_role_identity_check_failed';end if;

  delete from public.organization_member_permissions where organization_id=org and user_id=any(array[
    '13656252-6409-4af3-beb6-542961ef6739'::uuid,'5ac41b3d-f821-4644-a5c8-731967d14474'::uuid,
    '9cd6b01c-08b6-47ff-8ed0-699beade1306'::uuid,'3c065c51-8aa2-49a2-a956-bf78bd8d0e8e'::uuid,
    'bae5c132-1618-4da2-940b-be84dcae4bb4'::uuid]);

  update public.organization_members set role='operator',permission_preset='comercial',view_all=false,access_total=false
   where organization_id=org and user_id='13656252-6409-4af3-beb6-542961ef6739'::uuid;
  insert into public.organization_member_permissions(organization_id,user_id,permission_code,granted)
   select org,'13656252-6409-4af3-beb6-542961ef6739'::uuid,permission_code,true from public.preset_permissions where preset='comercial';

  update public.organization_members set role='operator',permission_preset='entregas',view_all=false,access_total=false
   where organization_id=org and user_id=any(array['5ac41b3d-f821-4644-a5c8-731967d14474'::uuid,'9cd6b01c-08b6-47ff-8ed0-699beade1306'::uuid]);
  insert into public.organization_member_permissions(organization_id,user_id,permission_code,granted)
   select org,target.user_id,pp.permission_code,true
   from unnest(array['5ac41b3d-f821-4644-a5c8-731967d14474'::uuid,'9cd6b01c-08b6-47ff-8ed0-699beade1306'::uuid]) as target(user_id)
   cross join public.preset_permissions pp where pp.preset='entregas';

  update public.organization_members set role='operator',permission_preset='personalizado',view_all=false,access_total=false
   where organization_id=org and user_id='3c065c51-8aa2-49a2-a956-bf78bd8d0e8e'::uuid;
  insert into public.organization_member_permissions(organization_id,user_id,permission_code,granted) values
   (org,'3c065c51-8aa2-49a2-a956-bf78bd8d0e8e','tasks.split',true),
   (org,'3c065c51-8aa2-49a2-a956-bf78bd8d0e8e','sales.view',true),
   (org,'3c065c51-8aa2-49a2-a956-bf78bd8d0e8e','sales.edit',true);

  update public.organization_members set role='operator',permission_preset='personalizado',view_all=false,access_total=false
   where organization_id=org and user_id='bae5c132-1618-4da2-940b-be84dcae4bb4'::uuid and status='inactive';

  insert into public.audit_logs(organization_id,actor_id,action,entity_type,entity_id,metadata)
  values(org,null,'team_task_responsibilities_configured','organization','task-access-2026-09-12',
   jsonb_build_object('davi','sales','emily','shipping','ilde','shipping','gabriel','split','inactive_gabriel_preserved',true));
end;
$$;

notify pgrst,'reload schema';
commit;
