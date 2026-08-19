begin;

-- RUAH — Módulo definitivo de Usuários e Permissões.
--
-- ARQUITETURA ATUAL (auditada antes de escrever esta migration):
-- public.member_role ('admin','manager','operator','viewer'),
-- public.organization_members(organization_id,user_id,role) com PK
-- composta, public.has_org_role(org_id,allowed[]) checando essa role, e
-- ~90 chamadas a has_org_role espalhadas pelas RPCs operacionais. Nada
-- disso é removido ou renomeado aqui — esta migration é PURAMENTE
-- ADITIVA por cima dela: novas colunas em organization_members, duas
-- tabelas novas (catálogo de permissões + concessões por membro), e um
-- novo helper canônico has_org_permission() que os RPCs críticos passam
-- a usar EM VEZ DE has_org_role (não além — evita duplo-gate confuso),
-- mas cujo resultado, para todo membro JÁ existente, é backfillado para
-- ser EXATAMENTE equivalente ao que has_org_role já concedia a ele hoje —
-- ninguém perde nem ganha acesso só por esta migration ter rodado.

-- ============================================================
-- 1. CATÁLOGO DE PERMISSÕES — auditado contra rotas/RPCs reais, não
--    inventado. Cada código é <módulo>.<ação>. Tabela de referência
--    (mesmo módulo em todo tenant), leitura liberada — não é dado
--    sensível, só nomeia o que existe.
-- ============================================================
create table public.permissions (
  code text primary key,
  module text not null,
  label text not null,
  sort_order integer not null default 0
);
alter table public.permissions enable row level security;
create policy permissions_select on public.permissions for select using (true);
revoke insert, update, delete on public.permissions from authenticated;

insert into public.permissions (code, module, label, sort_order) values
  ('dashboard.view','dashboard','Visualizar painel',10),
  ('clients.view','clients','Visualizar clientes',20),
  ('clients.create','clients','Cadastrar clientes',21),
  ('clients.edit','clients','Editar clientes',22),
  ('clients.export','clients','Exportar clientes',23),
  ('sales.view','sales','Visualizar vendas',30),
  ('sales.create','sales','Criar vendas',31),
  ('sales.edit','sales','Editar vendas',32),
  ('sales.validate','sales','Validar vendas',33),
  ('sales.cancel','sales','Cancelar vendas',34),
  ('inventory.view','inventory','Visualizar estoque',40),
  ('inventory.create','inventory','Cadastrar estoque',41),
  ('inventory.adjust','inventory','Ajustar saldo físico',42),
  ('inventory.identity','inventory','Gerar identidade física (frasco)',43),
  ('inventory.print','inventory','Imprimir etiqueta',44),
  ('inventory.scan','inventory','Ler código (câmera/scanner/manual)',45),
  ('inventory.conference','inventory','Conferir frasco',46),
  ('inventory.split','inventory','Criar split',47),
  ('shipping.view','shipping','Visualizar envios',50),
  ('shipping.prepare','shipping','Preparar separação',51),
  ('shipping.scan','shipping','Bipar frasco/split na separação',52),
  ('shipping.label','shipping','Gerenciar etiqueta de envio',53),
  ('shipping.post','shipping','Postar envio',54),
  ('radar.view','radar','Visualizar radar',60),
  ('radar.search','radar','Buscar no radar',61),
  ('radar.manage_suppliers','radar','Gerenciar fornecedores do radar',62),
  ('radar.manage_offers','radar','Gerenciar ofertas do radar',63),
  ('waitlist.view','waitlist','Visualizar lista de espera',70),
  ('waitlist.manage','waitlist','Gerenciar lista de espera',71),
  ('recovery.view','recovery','Visualizar recuperação de clientes',80),
  ('recovery.manage','recovery','Gerenciar recuperação de clientes',81),
  ('cost_margin.view','cost_margin','Visualizar custo e margem',90),
  ('cost_margin.edit','cost_margin','Editar custo',91),
  ('reports.view','reports','Visualizar relatórios',100),
  ('reports.export','reports','Exportar relatórios',101),
  ('ai_import.view','ai_import','Visualizar importação IA',110),
  ('ai_import.execute','ai_import','Executar importação IA',111),
  ('ai_import.confirm','ai_import','Confirmar importação IA',112),
  ('audit.view','audit','Visualizar auditoria',120),
  ('settings.view','settings','Visualizar configurações',130),
  ('team.view','team','Visualizar equipe',140),
  ('team.manage','team','Gerenciar usuários e permissões',141);

-- ============================================================
-- 2. PRESETS HUMANOS — o conjunto DEFAULT de permissões de cada preset.
--    'administrador' e 'visualizacao' não precisam de linhas aqui: eles
--    são implementados via os flags access_total/view_all (seção 3),
--    que já cobrem "tudo" e "todo .view" sem precisar enumerar ~40
--    códigos. 'personalizado' também fica vazio de propósito — Dona
--    Ilde monta do zero via overrides (seção 5).
-- ============================================================
create table public.preset_permissions (
  preset text not null,
  permission_code text not null references public.permissions(code),
  primary key (preset, permission_code)
);
alter table public.preset_permissions enable row level security;
create policy preset_permissions_select on public.preset_permissions for select using (true);
revoke insert, update, delete on public.preset_permissions from authenticated;

-- GESTOR: praticamente toda a operação, sem o único poder hoje
-- exclusivo de admin no schema atual (memberships_admin_write é
-- admin-only) — nunca escalar isso automaticamente.
insert into public.preset_permissions (preset, permission_code)
select 'gestor', code from public.permissions where code <> 'team.manage';

-- COMERCIAL: dashboard, clientes, vendas, recuperação, lista de espera,
-- leitura de estoque, leitura de envio. Explicitamente SEM ajuste físico,
-- postagem, custo/margem ou usuários (briefing seção "PRESETS").
insert into public.preset_permissions (preset, permission_code) values
  ('comercial','dashboard.view'),
  ('comercial','clients.view'),('comercial','clients.create'),('comercial','clients.edit'),('comercial','clients.export'),
  ('comercial','sales.view'),('comercial','sales.create'),('comercial','sales.edit'),('comercial','sales.validate'),('comercial','sales.cancel'),
  ('comercial','recovery.view'),('comercial','recovery.manage'),
  ('comercial','waitlist.view'),('comercial','waitlist.manage'),
  ('comercial','inventory.view'),
  ('comercial','shipping.view');

-- ENTREGAS/LOGÍSTICA: clientes/vendas só o necessário para separar e
-- entregar (leitura), estoque físico operacional completo (leitor,
-- conferência, etiqueta), envio ponta a ponta incl. postagem. SEM
-- custo/margem, usuários ou configurações administrativas.
insert into public.preset_permissions (preset, permission_code) values
  ('entregas','clients.view'),
  ('entregas','sales.view'),
  ('entregas','inventory.view'),('entregas','inventory.print'),('entregas','inventory.scan'),('entregas','inventory.conference'),
  ('entregas','shipping.view'),('entregas','shipping.prepare'),('entregas','shipping.scan'),('entregas','shipping.label'),('entregas','shipping.post');

-- ESTOQUE: módulo de estoque físico completo (frascos, splits,
-- etiquetas, scanner, conferência, inventário) — nada fora dele.
insert into public.preset_permissions (preset, permission_code)
select 'estoque', code from public.permissions where module = 'inventory';

-- ============================================================
-- 3. organization_members ganha status + camada de acesso amplo.
--    role (admin/manager/operator/viewer) PERMANECE — é a base legada
--    que RPCs ainda não migrados continuam lendo via has_org_role, e
--    também alimenta o mapeamento de compatibilidade abaixo.
-- ============================================================
alter table public.organization_members
  add column if not exists status text not null default 'active' check (status in ('active','inactive')),
  add column if not exists permission_preset text not null default 'personalizado'
    check (permission_preset in ('administrador','gestor','comercial','entregas','estoque','visualizacao','personalizado')),
  add column if not exists view_all boolean not null default false,
  add column if not exists access_total boolean not null default false;

-- ============================================================
-- 4. Concessões granulares por membro — o conjunto EFETIVO de
--    permissões de um membro fora do que access_total/view_all já
--    cobrem. Aplicar um preset grava aqui uma linha granted=true por
--    código do preset; "Personalizar Permissões" grava/atualiza linhas
--    individuais por cima. Nenhuma escrita direta do cliente — só via
--    RPC SECURITY DEFINER (mesmo padrão de toda escrita no app).
-- ============================================================
create table public.organization_member_permissions (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  permission_code text not null references public.permissions(code),
  granted boolean not null default true,
  updated_at timestamptz not null default now(),
  primary key (organization_id, user_id, permission_code),
  foreign key (organization_id, user_id) references public.organization_members(organization_id, user_id) on delete cascade
);
alter table public.organization_member_permissions enable row level security;
create policy organization_member_permissions_select on public.organization_member_permissions
  for select using (organization_id in (select public.current_user_org_ids()));
revoke insert, update, delete on public.organization_member_permissions from authenticated;

-- ============================================================
-- 5. HELPER CANÔNICO — autoridade real de backend (seção "BACKEND
--    AUTHORITY"). Deny by default. Ordem de resolução:
--    1. membro precisa existir e estar ativo, senão nega.
--    2. access_total concede tudo, sem exceção.
--    3. view_all concede todo código *.view — EXCETO team.view/audit.view
--       (briefing: o próprio exemplo de "Davi vê Dashboard/Clientes/
--       Vendas/Estoque/Envios/Radar/Relatórios" nunca inclui Equipe ou
--       Auditoria — "ver tudo" é sobre módulos operacionais, não sobre
--       administração da própria conta).
--    4. concessão explícita em organization_member_permissions (aplicada
--       por preset e/ou personalizada) — o que não está lá é negado.
-- ============================================================
create or replace function public.has_org_permission(org_id uuid, permission_code text)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_member public.organization_members;
  v_override boolean;
begin
  select * into v_member
  from public.organization_members
  where organization_id = org_id and user_id = auth.uid();

  if not found or v_member.status <> 'active' then
    return false;
  end if;

  if v_member.access_total then
    return true;
  end if;

  if v_member.view_all
     and permission_code like '%.view'
     and permission_code not in ('team.view', 'audit.view') then
    return true;
  end if;

  select granted into v_override
  from public.organization_member_permissions
  where organization_id = org_id and user_id = auth.uid()
    and permission_code = has_org_permission.permission_code;

  if found then
    return v_override;
  end if;

  return false;
end;
$$;
grant execute on function public.has_org_permission(uuid, text) to authenticated, service_role;

-- Conta quantos membros ATIVOS de uma organização efetivamente têm
-- team.manage agora — a base da proteção do último admin (seção
-- "ÚLTIMO ADMIN"). access_total conta (implica team.manage); view_all
-- NUNCA conta (team.manage não é um código *.view).
create or replace function public.org_admin_count(p_organization_id uuid)
returns integer
language sql
stable
security definer
set search_path = public
as $$
  select count(*)::integer
  from public.organization_members om
  where om.organization_id = p_organization_id
    and om.status = 'active'
    and (
      om.access_total
      or exists(
        select 1 from public.organization_member_permissions omp
        where omp.organization_id = om.organization_id and omp.user_id = om.user_id
          and omp.permission_code = 'team.manage' and omp.granted
      )
    );
$$;
grant execute on function public.org_admin_count(uuid) to authenticated, service_role;

-- ============================================================
-- 6. BACKFILL — todo membro já existente recebe, no sistema novo,
--    exatamente a capacidade que tinha no sistema antigo. Nunca mais,
--    nunca menos (briefing "COMPATIBILIDADE COM ROLES ATUAIS").
-- ============================================================
update public.organization_members set
  permission_preset = case role
    when 'admin' then 'administrador'
    when 'manager' then 'gestor'
    when 'viewer' then 'visualizacao'
    else 'personalizado'
  end,
  access_total = (role = 'admin'),
  view_all = (role in ('admin','viewer'));

-- Gestor legado: tudo que o preset 'gestor' já cobre (visto acima) —
-- populamos as linhas reais em vez de depender só do rótulo, para que
-- editar/copiar permissões desses usuários funcione normalmente.
insert into public.organization_member_permissions (organization_id, user_id, permission_code, granted)
select om.organization_id, om.user_id, pp.permission_code, true
from public.organization_members om
join public.preset_permissions pp on pp.preset = 'gestor'
where om.role = 'manager'
on conflict do nothing;

-- Operator legado: 'operator' hoje é um balde único que cobre vários
-- papéis operacionais reais — a única leitura segura é a UNIÃO de tudo
-- que has_org_role(['admin','manager','operator']) já deixava passar,
-- ou seja, tudo MENOS os gates hoje exclusivos de admin+manager
-- (inventory.split, shipping.post, cost_margin.edit) e menos as telas
-- novas que operator nunca teve (team.*, audit.view). Marcado como
-- 'personalizado' porque não corresponde a nenhum preset humano único —
-- Dona Ilde pode reclassificar cada um depois que ela auditar quem faz o quê.
insert into public.organization_member_permissions (organization_id, user_id, permission_code, granted)
select om.organization_id, om.user_id, p.code, true
from public.organization_members om
cross join public.permissions p
where om.role = 'operator'
  and p.code not in ('inventory.split','shipping.post','cost_margin.edit','team.view','team.manage','audit.view')
on conflict do nothing;

-- ============================================================
-- 7. REDE DE SEGURANÇA — o backfill acima é DML cru, não passa pelas
--    RPCs team_set_status/team_set_permissions (essas sim têm o guard de
--    org_admin_count). Se por qualquer motivo uma organização ficar com
--    ZERO membros com team.manage depois do backfill — por exemplo, o
--    único membro tinha role='manager'/'operator'/'viewer', não 'admin' —
--    ninguém mais consegue conceder team.manage a ninguém depois (as
--    duas RPCs exigem team.manage pra rodar: impasse sem saída via RPC).
--
--    Promove EXATAMENTE UM membro, nunca todos — promover todo mundo
--    numa organização com vários membros seria uma escalada de
--    privilégio em massa, o oposto de "rede de segurança". Escolha
--    determinística (nada de created_at — não confiar numa coluna que
--    esta migration não garante existir com essa semântica; user_id é
--    suficiente e sempre existe):
--      1. role='admin', 2. 'manager', 3. 'operator', 4. 'viewer'
--      empate: menor user_id (só para ser determinístico, não por
--      significado — qualquer critério estável serviria).
--    O escolhido vira equivalente a administrador de recuperação
--    (status já é 'active' pela própria seleção; preset/view_all/
--    access_total setados explicitamente). Ninguém mais na mesma
--    organização é tocado. Sem membro ativo nenhum: não promove
--    ninguém — não há para quem — só regista o fato via NOTICE.
--    RAISE NOTICE (não WARNING/EXCEPTION) em ambos os casos — a rede de
--    segurança nunca pode fazer o próprio push falhar.
-- ============================================================
do $$
declare
  v_org record;
  v_promote uuid;
begin
  for v_org in select id from public.organizations loop
    if public.org_admin_count(v_org.id) = 0 then
      select om.user_id into v_promote
      from public.organization_members om
      where om.organization_id = v_org.id and om.status = 'active'
      order by
        case om.role
          when 'admin' then 1
          when 'manager' then 2
          when 'operator' then 3
          when 'viewer' then 4
          else 5
        end,
        om.user_id
      limit 1;

      if v_promote is not null then
        raise notice 'org_admin_count=0 para organização % após backfill — promovendo o único membro escolhido (%) a administrador de recuperação (access_total=true).', v_org.id, v_promote;
        update public.organization_members set
          permission_preset = 'administrador',
          view_all = true,
          access_total = true
        where organization_id = v_org.id and user_id = v_promote;
      else
        raise notice 'org_admin_count=0 para organização % após backfill, e nenhum membro ativo existe — ninguém promovido (não há para quem).', v_org.id;
      end if;
    end if;
  end loop;
end $$;

commit;
