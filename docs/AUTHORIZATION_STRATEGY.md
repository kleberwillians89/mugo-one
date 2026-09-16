# Estratégia de autorização — Mugô One

Documento pedido pela sprint 1 de productização (item 5 — Autorização):
direção única para autorização daqui para frente, sem criar um terceiro
sistema além dos dois que já existem no legado.

## Situação herdada

Dois mecanismos de autorização coexistem hoje:

1. **Roles fixas** — `organization_members.role` (`admin`/`manager`/`operator`/`viewer`),
   checadas via `public.has_org_role(organization_id, roles[])`. É o
   mecanismo original (`202607290002_rls_and_audit.sql`), usado em ~90
   RPCs/policies. Vários domínios nunca migraram para o mecanismo mais
   novo: radar, waitlist, boa parte de SuperFrete.
2. **Permissões granulares** — `permissions` / `preset_permissions` /
   `organization_member_permissions`, checadas via
   `public.has_org_permission(organization_id, code)` no banco e
   `computeCan()` (`src/lib/permissions.ts`) no frontend. Mecanismo mais
   novo (a partir de `202608190011_team_permissions.sql`), com presets,
   `access_total` e `view_all`. `202608190013_permission_gate_critical_rpcs.sql`
   já migrou os RPCs mais críticos (estoque, split, conferência de
   frasco), mas a migração está incompleta.

## Padrão daqui para frente

**Não criamos um terceiro sistema.** A partir desta sprint:

- Todo código **novo** autoriza exclusivamente via `has_org_permission`
  (banco) e `computeCan` / `useHasPermission` (frontend). Nunca introduzir
  uma checagem nova baseada só em `has_org_role`.
- O modelo conceitual final é **owner/admin/manager/operator/viewer como
  papel de base** + **permissões granulares por módulo** sobrepostas a
  esse papel — é exatamente o desenho que já existe em
  `permissions.ts` / `organization_member_permissions`; falta terminar de
  aplicá-lo a todos os domínios, não desenhar algo novo.
- Migrar um domínio de `has_org_role` para `has_org_permission` continua
  sendo trabalho válido a qualquer momento (reduz dívida), mas **não é
  escopo obrigatório desta sprint** — radar/waitlist/SuperFrete não foram
  tocados agora.
- `feat/core-foundation` já modela `owner/admin/manager/operator/viewer`
  como enum de primeira classe (`organization_role`), com `owner`
  distinto de `admin`. O legado ainda não tem o papel `owner` separado
  (`member_role` vai só até `admin`) — quando essa lacuna for fechada, o
  enum de `feat/core-foundation` é a referência a seguir (ver riscos no
  relatório de entrega).

## O que esta sprint mudou e o que não mudou

Nenhuma policy RLS nem nenhuma checagem de permissão **existente** foi
alterada. As duas tabelas novas (`organization_settings`,
`organization_features`, ver `202609170001_organization_settings_and_features.sql`)
usam apenas `has_org_role(organization_id, array['admin'])` — o padrão
mais simples já testado — por serem tabelas de configuração de baixo
volume e baixa frequência de escrita, não o padrão de permissão
granular (mais apropriado para módulos operacionais de alto volume como
vendas/estoque). Se no futuro for preciso permitir que alguém sem o
papel `admin` edite uma configuração específica (ex: só `billing`), vale
introduzir um código de permissão granular dedicado para isso — não
generalizar a checagem hoje sem um caso de uso real.
