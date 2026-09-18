begin;

-- ============================================================
-- MUGÔ ONE — Sprint O (Event Engine + Automation Engine)
--
-- domain_events: fato técnico imutável (diferente de activities —
-- histórico humano, ver docs/AUTOMATION_ENGINE_MIGRATION_PLAN.md §1).
-- causation_depth é calculado NA INSERÇÃO (0 se causation_id é nulo,
-- senão profundidade do pai + 1) — evita CTE recursiva a cada
-- avaliação de automação; é a base da prevenção de loop (briefing §24).
--
-- processing_status nasce 'processed' (otimista: a avaliação de
-- automações roda SÍNCRONA, na mesma transação de emit_domain_event) e
-- só sofre UM possível UPDATE, para 'failed', se a avaliação
-- estourar uma exceção inesperada — nunca deixamos uma automação
-- quebrada derrubar a operação de domínio que emitiu o evento. Fora
-- esse único caso, a linha nunca muda depois de inserida.
-- ============================================================

create table public.domain_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,

  event_type text not null check (btrim(event_type) <> ''),

  entity_type text,
  entity_id uuid,

  actor_user_id uuid references auth.users(id) on delete set null,

  occurred_at timestamptz not null default now(),
  payload jsonb not null default '{}'::jsonb,

  correlation_id uuid,
  causation_id uuid references public.domain_events(id) on delete set null,
  causation_depth integer not null default 0 check (causation_depth >= 0),

  source text not null check (btrim(source) <> ''),
  processing_status text not null default 'processed' check (processing_status in ('processed', 'failed')),

  created_at timestamptz not null default now()
);

create index domain_events_org_type_idx on public.domain_events(organization_id, event_type, created_at desc);
create index domain_events_org_entity_idx on public.domain_events(organization_id, entity_type, entity_id) where entity_type is not null;
create index domain_events_causation_idx on public.domain_events(causation_id) where causation_id is not null;
create index domain_events_correlation_idx on public.domain_events(correlation_id) where correlation_id is not null;

alter table public.domain_events enable row level security;

-- Só leitura autenticada (Event Viewer, briefing §44). Escrita
-- exclusiva via emit_domain_event (SECURITY DEFINER, nunca concedida
-- a authenticated/anon diretamente).
create policy domain_events_org_select on public.domain_events for select
using (
  organization_id in (select public.current_user_org_ids())
  and public.has_org_permission(organization_id, 'automations.view')
);

grant select on public.domain_events to authenticated;

-- ============================================================
-- emit_domain_event: único ponto de inserção em domain_events. Nunca
-- exposta a anon/authenticated — só chamável de dentro de outra
-- função SECURITY DEFINER que já fez sua própria checagem de
-- permissão sobre a operação de domínio real (briefing §6). A
-- avaliação de automações roda aqui dentro, na mesma transação
-- (briefing §7 — atomicidade mudança+evento).
-- ============================================================

create or replace function public.emit_domain_event(
  p_organization_id uuid,
  p_event_type text,
  p_entity_type text,
  p_entity_id uuid,
  p_payload jsonb default '{}'::jsonb,
  p_source text default 'unknown',
  p_actor_user_id uuid default null,
  p_correlation_id uuid default null,
  p_causation_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_event_id uuid;
  v_parent_depth integer := 0;
  v_depth integer;
begin
  if p_causation_id is not null then
    select causation_depth into v_parent_depth from public.domain_events where id = p_causation_id;
  end if;
  v_depth := coalesce(v_parent_depth, 0) + (case when p_causation_id is not null then 1 else 0 end);

  insert into public.domain_events (
    organization_id, event_type, entity_type, entity_id, actor_user_id,
    payload, correlation_id, causation_id, causation_depth, source
  ) values (
    p_organization_id, p_event_type, p_entity_type, p_entity_id, coalesce(p_actor_user_id, auth.uid()),
    coalesce(p_payload, '{}'::jsonb), p_correlation_id, p_causation_id, v_depth, p_source
  ) returning id into v_event_id;

  begin
    perform public.evaluate_and_run_automations(v_event_id);
  exception when others then
    update public.domain_events set processing_status = 'failed' where id = v_event_id;
  end;

  return v_event_id;
end;
$$;

revoke all on function public.emit_domain_event(uuid, text, text, uuid, jsonb, text, uuid, uuid, uuid) from public, anon, authenticated;

commit;
