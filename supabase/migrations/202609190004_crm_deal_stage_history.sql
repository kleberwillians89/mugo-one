begin;

-- ============================================================
-- MUGÔ ONE — Sprint 3 (CRM Commercial Foundation)
-- Histórico de stage, movimentação transacional e timeline.
-- ============================================================

create table public.deal_stage_history (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  deal_id uuid not null references public.deals(id) on delete cascade,
  from_stage_id uuid not null references public.pipeline_stages(id),
  to_stage_id uuid not null references public.pipeline_stages(id),
  moved_by uuid references public.profiles(id) on delete set null,
  moved_at timestamptz not null default now(),
  check (from_stage_id <> to_stage_id)
);

create index deal_stage_history_org_deal_idx
  on public.deal_stage_history(organization_id, deal_id, moved_at desc);

alter table public.deal_stage_history enable row level security;
create policy deal_stage_history_org_select on public.deal_stage_history for select
using (
  organization_id in (select public.current_user_org_ids())
  and public.has_org_permission(organization_id, 'crm.deals.view')
);
grant select on public.deal_stage_history to authenticated;

create or replace function public.deals_record_stage_history()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.deal_stage_history(
    organization_id, deal_id, from_stage_id, to_stage_id, moved_by
  ) values (
    new.organization_id, new.id, old.stage_id, new.stage_id, auth.uid()
  );
  return new;
end;
$$;

create trigger deals_record_stage_history
after update of stage_id on public.deals
for each row
when (old.stage_id is distinct from new.stage_id)
execute function public.deals_record_stage_history();

create or replace function public.move_deal_stage(
  p_deal_id uuid,
  p_destination_stage_id uuid
)
returns public.deals
language plpgsql
security definer
set search_path = public
as $$
declare
  v_deal public.deals;
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

  if not exists (
    select 1 from public.pipeline_stages
    where id = p_destination_stage_id
      and organization_id = v_deal.organization_id
      and pipeline_id = v_deal.pipeline_id
      and active
  ) then raise exception 'invalid_destination_stage'; end if;

  if v_deal.stage_id = p_destination_stage_id then return v_deal; end if;

  update public.deals
  set stage_id = p_destination_stage_id
  where id = p_deal_id
  returning * into v_deal;

  return v_deal;
end;
$$;

revoke execute on function public.move_deal_stage(uuid, uuid)
  from public, anon;
grant execute on function public.move_deal_stage(uuid, uuid) to authenticated;

-- Amplia a camada polimórfica existente sem abrir o helper interno.
alter table public.entity_tags drop constraint if exists entity_tags_entity_type_check;
alter table public.entity_tags add constraint entity_tags_entity_type_check
  check (entity_type in ('customer', 'company', 'contact', 'lead', 'deal'));
alter table public.custom_fields drop constraint if exists custom_fields_entity_type_check;
alter table public.custom_fields add constraint custom_fields_entity_type_check
  check (entity_type in ('customer', 'company', 'contact', 'lead', 'deal'));
alter table public.custom_field_values drop constraint if exists custom_field_values_entity_type_check;
alter table public.custom_field_values add constraint custom_field_values_entity_type_check
  check (entity_type in ('customer', 'company', 'contact', 'lead', 'deal'));
alter table public.notes drop constraint if exists notes_entity_type_check;
alter table public.notes add constraint notes_entity_type_check
  check (entity_type in ('customer', 'company', 'contact', 'lead', 'deal'));
alter table public.activities drop constraint if exists activities_entity_type_check;
alter table public.activities add constraint activities_entity_type_check
  check (entity_type in ('customer', 'company', 'contact', 'lead', 'deal'));

create or replace function public.entity_belongs_to_organization(
  p_entity_type text,
  p_entity_id uuid,
  p_organization_id uuid
)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_found boolean;
begin
  case p_entity_type
    when 'customer' then
      select exists(select 1 from public.clients where id = p_entity_id and organization_id = p_organization_id)
        into v_found;
    when 'company' then
      select exists(select 1 from public.companies where id = p_entity_id and organization_id = p_organization_id)
        into v_found;
    when 'contact' then
      select exists(select 1 from public.contacts where id = p_entity_id and organization_id = p_organization_id)
        into v_found;
    when 'lead' then
      select exists(select 1 from public.leads where id = p_entity_id and organization_id = p_organization_id)
        into v_found;
    when 'deal' then
      select exists(select 1 from public.deals where id = p_entity_id and organization_id = p_organization_id)
        into v_found;
    else
      v_found := false;
  end case;
  return coalesce(v_found, false);
end;
$$;

revoke execute on function public.entity_belongs_to_organization(text, uuid, uuid)
  from public, anon, authenticated;

create or replace function public.leads_log_activity()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  perform public.log_activity(new.organization_id, 'lead', new.id, 'lead_created',
    new.created_by, new.name);
  return new;
end;
$$;
create trigger leads_log_activity after insert on public.leads
for each row execute function public.leads_log_activity();

create or replace function public.deals_log_activity()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  perform public.log_activity(new.organization_id, 'deal', new.id, 'deal_created',
    new.created_by, new.title, null,
    jsonb_build_object('pipeline_id', new.pipeline_id, 'stage_id', new.stage_id));
  return new;
end;
$$;
create trigger deals_log_activity after insert on public.deals
for each row execute function public.deals_log_activity();

create or replace function public.deals_log_stage_activity()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_from_name text;
  v_to_name text;
  v_stage_type text;
begin
  select name into v_from_name from public.pipeline_stages where id = old.stage_id;
  select name, stage_type into v_to_name, v_stage_type
    from public.pipeline_stages where id = new.stage_id;

  perform public.log_activity(new.organization_id, 'deal', new.id, 'deal_stage_changed',
    auth.uid(), 'Etapa alterada', coalesce(v_from_name, '') || ' → ' || coalesce(v_to_name, ''),
    jsonb_build_object('old_stage_id', old.stage_id, 'new_stage_id', new.stage_id));

  if v_stage_type = 'won' then
    perform public.log_activity(new.organization_id, 'deal', new.id, 'deal_won',
      auth.uid(), 'Negócio ganho');
  elsif v_stage_type = 'lost' then
    perform public.log_activity(new.organization_id, 'deal', new.id, 'deal_lost',
      auth.uid(), 'Negócio perdido', new.loss_reason);
  end if;
  return new;
end;
$$;
create trigger deals_log_stage_activity after update of stage_id on public.deals
for each row when (old.stage_id is distinct from new.stage_id)
execute function public.deals_log_stage_activity();

revoke execute on function public.deals_record_stage_history()
  from public, anon, authenticated;
revoke execute on function public.leads_log_activity()
  from public, anon, authenticated;
revoke execute on function public.deals_log_activity()
  from public, anon, authenticated;
revoke execute on function public.deals_log_stage_activity()
  from public, anon, authenticated;

commit;
