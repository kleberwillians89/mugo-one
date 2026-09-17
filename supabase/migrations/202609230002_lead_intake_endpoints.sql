begin;

-- ============================================================
-- MUGÔ ONE — Sprint M (Lead Intake + Source + Touchpoints + Dedupe)
--
-- lead_intake_endpoints: 1 organização pode ter N endpoints públicos
-- (ex.: "Site institucional", "Landing Tráfego Pago"). public_key é o
-- segredo em si (como um webhook token de Stripe/Zapier) — precisa
-- ser exibível de novo para o usuário colar em outra ferramenta, por
-- isso fica em texto pleno, não hash (ver docs/LEAD_INTAKE_MIGRATION_PLAN.md
-- §9). Protegido por: entropia alta, RLS, rotação/revogação, e nunca
-- aparecendo por inteiro em log/activity (§48).
-- ============================================================

create table public.lead_intake_endpoints (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,

  name text not null check (btrim(name) <> ''),
  public_key text not null unique default encode(gen_random_bytes(32), 'hex'),
  status text not null default 'active' check (status in ('active', 'disabled')),

  event_count integer not null default 0,
  last_event_at timestamptz,

  created_by_user_id uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  disabled_at timestamptz,
  disabled_by_user_id uuid references public.profiles(id)
);

create index lead_intake_endpoints_org_idx on public.lead_intake_endpoints(organization_id);

create or replace function public.lead_intake_endpoints_set_updated_at()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger lead_intake_endpoints_set_updated_at
before update on public.lead_intake_endpoints
for each row execute function public.lead_intake_endpoints_set_updated_at();

alter table public.lead_intake_endpoints enable row level security;

-- Leitura/escrita normal (autenticado, dono da organização): sempre via
-- has_org_permission. A leitura PÚBLICA por public_key nunca passa por
-- aqui — a Edge Function usa o client service_role, que ignora RLS.
create policy lead_intake_endpoints_org_select on public.lead_intake_endpoints for select
using (
  organization_id in (select public.current_user_org_ids())
  and public.has_org_permission(organization_id, 'lead_intake.view')
);
create policy lead_intake_endpoints_org_insert on public.lead_intake_endpoints for insert
with check (public.has_org_permission(organization_id, 'lead_intake.manage'));
create policy lead_intake_endpoints_org_update on public.lead_intake_endpoints for update
using (public.has_org_permission(organization_id, 'lead_intake.manage'))
with check (public.has_org_permission(organization_id, 'lead_intake.manage'));

grant select, insert, update on public.lead_intake_endpoints to authenticated;

create trigger lead_intake_endpoints_prevent_organization_change
before update of organization_id on public.lead_intake_endpoints
for each row execute function public.crm_prevent_organization_change();

-- ============================================================
-- RPCs de gestão (autenticadas, permission-gated — nunca usadas pelo
-- endpoint público em si).
-- ============================================================

create or replace function public.create_lead_intake_endpoint(
  p_organization_id uuid,
  p_name text
)
returns public.lead_intake_endpoints
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.lead_intake_endpoints;
begin
  if not public.has_org_permission(p_organization_id, 'lead_intake.manage') then
    raise exception 'permission_denied' using errcode = '42501';
  end if;
  if btrim(coalesce(p_name, '')) = '' then
    raise exception 'invalid_name' using errcode = '22023';
  end if;

  insert into public.lead_intake_endpoints (organization_id, name, created_by_user_id)
  values (p_organization_id, btrim(p_name), auth.uid())
  returning * into v_row;

  -- audit_logs (não activities/log_activity): endpoint não é uma
  -- entidade coberta por entity_belongs_to_organization, e este é um
  -- evento de configuração/segurança, não um evento de timeline de
  -- CRM — mesmo mecanismo usado por customer-registration-start/
  -- manychat-send. A chave em si nunca entra no metadata (§48).
  insert into public.audit_logs (organization_id, actor_id, action, entity_type, entity_id, metadata)
  values (p_organization_id, auth.uid(), 'lead_intake_endpoint_created', 'lead_intake_endpoint', v_row.id::text,
    jsonb_build_object('name', v_row.name));

  return v_row;
end;
$$;

revoke execute on function public.create_lead_intake_endpoint(uuid, text) from public, anon;
grant execute on function public.create_lead_intake_endpoint(uuid, text) to authenticated;

create or replace function public.rotate_lead_intake_endpoint_key(p_endpoint_id uuid)
returns public.lead_intake_endpoints
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.lead_intake_endpoints;
begin
  select * into v_row from public.lead_intake_endpoints where id = p_endpoint_id;
  if not found then
    raise exception 'endpoint_not_found';
  end if;
  if not public.has_org_permission(v_row.organization_id, 'lead_intake.manage') then
    raise exception 'permission_denied' using errcode = '42501';
  end if;

  update public.lead_intake_endpoints
  set public_key = encode(gen_random_bytes(32), 'hex')
  where id = p_endpoint_id
  returning * into v_row;

  insert into public.audit_logs (organization_id, actor_id, action, entity_type, entity_id, metadata)
  values (v_row.organization_id, auth.uid(), 'lead_intake_endpoint_key_rotated', 'lead_intake_endpoint', v_row.id::text,
    jsonb_build_object('name', v_row.name));

  return v_row;
end;
$$;

revoke execute on function public.rotate_lead_intake_endpoint_key(uuid) from public, anon;
grant execute on function public.rotate_lead_intake_endpoint_key(uuid) to authenticated;

create or replace function public.set_lead_intake_endpoint_status(p_endpoint_id uuid, p_status text)
returns public.lead_intake_endpoints
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.lead_intake_endpoints;
begin
  if p_status not in ('active', 'disabled') then
    raise exception 'invalid_status' using errcode = '22023';
  end if;

  select * into v_row from public.lead_intake_endpoints where id = p_endpoint_id;
  if not found then
    raise exception 'endpoint_not_found';
  end if;
  if not public.has_org_permission(v_row.organization_id, 'lead_intake.manage') then
    raise exception 'permission_denied' using errcode = '42501';
  end if;

  update public.lead_intake_endpoints
  set status = p_status,
      disabled_at = case when p_status = 'disabled' then now() else null end,
      disabled_by_user_id = case when p_status = 'disabled' then auth.uid() else null end
  where id = p_endpoint_id
  returning * into v_row;

  insert into public.audit_logs (organization_id, actor_id, action, entity_type, entity_id, metadata)
  values (
    v_row.organization_id, auth.uid(),
    case when p_status = 'disabled' then 'lead_intake_endpoint_disabled' else 'lead_intake_endpoint_enabled' end,
    'lead_intake_endpoint', v_row.id::text, jsonb_build_object('name', v_row.name)
  );

  return v_row;
end;
$$;

revoke execute on function public.set_lead_intake_endpoint_status(uuid, text) from public, anon;
grant execute on function public.set_lead_intake_endpoint_status(uuid, text) to authenticated;

commit;
