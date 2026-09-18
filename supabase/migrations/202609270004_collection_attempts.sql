begin;

-- ============================================================
-- MUGÔ ONE — Sprint de Limpeza (Cobrança Universal + Zero Ruah)
--
-- collection_attempts: histórico de tentativa de cobrança via
-- Communication Hub (briefing §26-27). O conteúdo da mensagem
-- continua vivendo só em public.messages (Communication Core, Sprint
-- N) — aqui só a referência (message_id/conversation_id), nunca uma
-- cópia do corpo. client_id no lugar do "collection_id" conceitual do
-- briefing: auditoria confirmou que não existe (e esta sprint não cria)
-- uma tabela "collections" — cobrança é o conjunto de vendas pendentes
-- de um cliente (ver collections_pending_sales), então o cliente é a
-- chave estável real para o histórico (ver
-- docs/ACTIVE_LEGACY_COLLECTIONS_AUDIT.md).
--
-- Escrita só via RPC (send_collection_message, SECURITY DEFINER) —
-- nenhum insert/update/delete direto concedido a authenticated, mesmo
-- padrão de fiscal_documents/domain_events (histórico não deve ser
-- editável por fora do fluxo que o gera).
-- ============================================================

create table public.collection_attempts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  client_id uuid not null references public.clients(id) on delete cascade,
  template_id uuid references public.collection_message_templates(id) on delete set null,

  channel text not null check (btrim(channel) <> ''),
  conversation_id uuid references public.conversations(id) on delete set null,
  message_id uuid references public.messages(id) on delete set null,

  status text not null check (status in ('sent', 'failed')),
  sent_by_user_id uuid references public.profiles(id),
  sent_at timestamptz,

  error_code text,
  error_message text,

  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index collection_attempts_org_idx on public.collection_attempts(organization_id);
create index collection_attempts_client_idx on public.collection_attempts(organization_id, client_id, created_at desc);

alter table public.collection_attempts enable row level security;

create policy collection_attempts_org_select on public.collection_attempts for select
using (
  organization_id in (select public.current_user_org_ids())
  and (
    public.has_org_permission(organization_id, 'sales.view')
    or public.has_org_permission(organization_id, 'collections.configure')
  )
);

-- Sem policy de insert/update/delete para authenticated — histórico só
-- é escrito pela RPC send_collection_message (SECURITY DEFINER, roda
-- como dono da função, não sujeito a RLS de authenticated).
revoke insert, update, delete on public.collection_attempts from authenticated;
grant select on public.collection_attempts to authenticated;

commit;
