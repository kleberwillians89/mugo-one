begin;

-- ============================================================
-- MUGÔ ONE — Sprint N (Communication Hub Universal)
--
-- communication_identities: identidade DE CANAL (telefone/e-mail/ID de
-- provider ligado a uma entidade) — briefing §10. NÃO substitui a
-- Identity Resolution da Sprint M (match contra clients.normalized_*
-- continua sendo o mecanismo real de "esse telefone é de qual
-- customer"). Esta tabela responde "quais canais esta entidade já
-- usou", não "quem é essa pessoa" — ver
-- docs/COMMUNICATION_HUB_MIGRATION_PLAN.md §6.
--
-- Sem unicidade rígida em (channel, normalized_value): mesmo padrão
-- "dedupe conservador, sem unicidade forçada" já usado em
-- clients.normalized_* (índices não-únicos) — dois registros podem,
-- por um tempo, apontar identidades diferentes até revisão.
-- ============================================================

create table public.communication_identities (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,

  entity_type text not null check (entity_type in ('customer', 'company', 'contact', 'lead')),
  entity_id uuid not null,

  channel text not null check (btrim(channel) <> ''),
  identity_value text not null check (btrim(identity_value) <> ''),
  normalized_value text not null,

  provider text,
  provider_external_id text,

  is_primary boolean not null default false,
  verified_at timestamptz,

  metadata jsonb not null default '{}'::jsonb,

  created_at timestamptz not null default now()
);

create index communication_identities_org_entity_idx
  on public.communication_identities(organization_id, entity_type, entity_id);
create index communication_identities_org_lookup_idx
  on public.communication_identities(organization_id, channel, normalized_value);

create or replace function public.communication_identities_validate_tenant_refs()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.entity_belongs_to_organization(new.entity_type, new.entity_id, new.organization_id) then
    raise exception 'communication_identity_entity_organization_mismatch';
  end if;
  return new;
end;
$$;

create trigger communication_identities_validate_tenant_refs
before insert or update
on public.communication_identities
for each row execute function public.communication_identities_validate_tenant_refs();

alter table public.communication_identities enable row level security;

create policy communication_identities_org_select on public.communication_identities for select
using (
  organization_id in (select public.current_user_org_ids())
  and public.has_org_permission(organization_id, 'communications.view')
);

grant select on public.communication_identities to authenticated;

revoke execute on function public.communication_identities_validate_tenant_refs() from public, anon, authenticated;

commit;
