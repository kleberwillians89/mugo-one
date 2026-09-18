begin;

-- ============================================================
-- MUGÔ ONE — Sprint de Limpeza (Cobrança Universal + Zero Ruah)
--
-- collection_message_templates: modelo universal de texto de cobrança
-- (briefing §8-15). channel é só metadado de apresentação/roteamento —
-- o template NUNCA pertence a um provider (isso é trabalho do
-- Communication Hub, Sprint N). body é sempre TEXTO PURO: nunca
-- renderizado como HTML em lugar nenhum do produto (nem no preview,
-- nem no envio — send-email manda "text", não "html", ver
-- supabase/functions/_shared/email.ts) — isso é o que neutraliza
-- HTML/script malicioso no corpo sem precisar de um sanitizador
-- dedicado (briefing §33: nunca aceitar HTML/script não seguro).
-- ============================================================

create table public.collection_message_templates (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,

  name text not null check (btrim(name) <> ''),
  key text not null check (btrim(key) <> ''),
  channel text not null default 'generic' check (channel in ('email', 'whatsapp', 'sms', 'generic')),
  subject text,
  body text not null check (btrim(body) <> ''),
  active boolean not null default true,

  created_by uuid references public.profiles(id),
  updated_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  unique (organization_id, key)
);

create index collection_message_templates_org_idx on public.collection_message_templates(organization_id);

create or replace function public.collection_message_templates_set_audit()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    new.created_by := auth.uid();
    new.updated_by := auth.uid();
  else
    new.updated_by := auth.uid();
    new.created_by := old.created_by;
    new.created_at := old.created_at;
  end if;
  new.updated_at := now();
  return new;
end;
$$;

create trigger collection_message_templates_set_audit
before insert or update on public.collection_message_templates
for each row execute function public.collection_message_templates_set_audit();

create trigger collection_message_templates_prevent_organization_change
before update of organization_id on public.collection_message_templates
for each row execute function public.crm_prevent_organization_change();

alter table public.collection_message_templates enable row level security;

-- Select também para collections.send (não só collections.configure):
-- quem dispara um envio precisa ver os templates ativos para escolher
-- um, sem precisar de permissão de configuração.
create policy collection_message_templates_org_select on public.collection_message_templates for select
using (
  organization_id in (select public.current_user_org_ids())
  and (
    public.has_org_permission(organization_id, 'collections.configure')
    or public.has_org_permission(organization_id, 'collections.send')
  )
);
create policy collection_message_templates_org_insert on public.collection_message_templates for insert
with check (public.has_org_permission(organization_id, 'collections.configure'));
create policy collection_message_templates_org_update on public.collection_message_templates for update
using (public.has_org_permission(organization_id, 'collections.configure'))
with check (public.has_org_permission(organization_id, 'collections.configure'));
create policy collection_message_templates_org_delete on public.collection_message_templates for delete
using (public.has_org_permission(organization_id, 'collections.configure'));

grant select, insert, update, delete on public.collection_message_templates to authenticated;

commit;
