# Plano de migração — Catálogo Universal + Sale Items (Fase E/F)

Auditoria prévia obrigatória antes de qualquer schema novo, per o
briefing "SPRINT PESADA — FASE E + F".

## 1. O que existe hoje (auditoria)

### `public.sales` (schema real, introspeccionado no banco de staging)

Colunas **obrigatórias hoje**: `id`, `organization_id`, `client_id`,
`amount`, `payment_status`, `source`, `created_at`, `updated_at`.
`perfume_id` já é **nullable** no schema — a obrigatoriedade de perfume
é imposta pela camada de aplicação (`createSale()` em
`src/lib/records.ts`, que faz `.eq('id',input.perfumeId).single()` e
lança erro se não achar), não pelo banco. Isso é uma boa notícia: o
schema físico já tolera um sale sem perfume.

Colunas genéricas reaproveitáveis: `organization_id`, `client_id`,
`sale_date`, `amount`, `payment_status`, `payment_method`, `paid_at`,
`notes`, `source`, `created_by`, `created_at`, `updated_at`,
`deleted_at`, `import_batch_id`.

Colunas explicitamente verticais (ficam como LEGACY, não tocadas):
`perfume_id`, `perfume_name_raw`, `perfume_base_name`, `volume_ml`,
`volume_ml_raw`, `bottle_identifier`, `sale_type`, `split_status`,
`split_completed_at`, `split_completed_by`, `apc_separation_status`,
`apc_separated_at`, `apc_separated_by`, `inventory_allocation_eligible`,
`inventory_item_id`, `credit_reference_amount`, e todos os campos
`shipping_*`/`legacy_shipping_*` (logística é responsabilidade de
`shipments`/`shipment_items`, já isolável por feature flag desde a
Fase B).

RLS atual em `sales`: `sales_org_select` (SELECT por
`current_user_org_ids()`) e `sales_org_write` (ALL por
`has_org_role(organization_id, admin|manager|operator)`) — sistema
**baseado em role**, não no sistema de permissões granular
(`has_org_permission`) usado por `sales.view`/`sales.create`/
`sales.edit` no frontend (`src/lib/permissions.ts`, já existentes,
`module: 'sales'`) nem pelo CRM novo (companies/leads/deals). Ou seja,
hoje há DUAS camadas de autorização coexistindo em `sales`: role (RLS)
+ permission (checagem de aplicação/RPCs específicas como
`davi_excel_update_sale_with_bottle`, que já valida
`has_org_permission(...,'sales.edit')` internamente). `catalog_items`
e `sale_items` vão seguir o padrão **mais novo e mais granular**
(`has_org_permission`), igual a `companies`/`leads`/`deals` — é o que
o resto do Core já usa e o briefing pede para não criar um terceiro
sistema.

### `public.perfumes`

100% vertical (`full_name_raw`, `brand_house`, `bottle_identifier`,
`average_cost_per_ml`, `operational_code`). **Não reaproveitável** como
catálogo genérico — confirma a preferência do briefing por uma tabela
nova `catalog_items`, não uma generalização de `perfumes`.

### `src/lib/records.ts` — `createSale()`

Dois caminhos: (a) `source==='davi_excel'` → RPC
`davi_excel_create_sale_with_bottle` (legado, intocado); (b) caminho
"Nova venda" do `SaleModal` ativo → INSERT direto client-side em
`sales`, exige `perfume_id` válido da organização. É este segundo
caminho que a Fase F substitui por uma RPC transacional genérica.

### `RecordModals.tsx::SaleModal` / `SalesPage.tsx` / `SaleDetailsPage.tsx`

Já mapeados nas Fases C/D. `SaleModal` pede Perfume/Tipo
(APC/SPLIT)/ML/Frasco — é o alvo da Fase F (isolar em legacy, novo
formulário genérico). `SalesPage.tsx` já foi generalizado na Fase D
(consome `CommercialSale`/`fetchSalesPage`, ainda sem `sale_items`).
`SaleDetailsPage.tsx` ainda mistura Produto (Perfume/Frasco/Tipo/ML)
com Custódia/Estoque/Logística — vira universal na Fase F, com
Logística/Estoque condicionados a `hasFeature('shipping'|'inventory')`.

### Pagamentos / anexos / importação / customer portal

`sale-payment-attachments.ts` + `SalePaymentAttachmentsModal.tsx`: já
genéricos o bastante (chave é `sale_id`, sem campo de perfume na
tabela de anexos) — reaproveitados sem alteração. Importação
(`importer.ts`, scripts): mantém-se como legado por enquanto; só
preparamos o contrato de mapeamento (`catalog_items`/`sale_items`
como destino possível), sem reescrever a UI, per o próprio briefing
(§27, "não implementar toda UI nova de mapping se isso estourar
escopo"). Customer portal: fora do escopo desta sprint (não toca
`sales` diretamente para o cliente final hoje).

### Padrão de RLS/trigger a seguir

`supabase/migrations/202609190003_crm_deals.sql` é o template: tabela
com `unique(id, organization_id)`, trigger `before insert or update`
fazendo validação de tenant nos FKs (`..._validate_tenant_refs`,
`security definer`, `revoke execute from public/anon/authenticated`),
`crm_set_updated_at()`/`crm_prevent_organization_change()` reaproveitados,
RLS via `has_org_permission`. `202609190005_crm_lead_conversion.sql` é
o template para a RPC transacional (`FOR UPDATE`, checagem de
permissão explícita, `SECURITY DEFINER`, `search_path` fixo,
`revoke ... grant to authenticated`).

`entity_belongs_to_organization()` (função polimórfica usada por
`activities`/`notes`/`entity_tags`/`custom_field_values`) precisa
ganhar o case `'sale'` (aditivo, `create or replace`) para que
`log_activity()` funcione para vendas — sem isso, todo `log_activity`
para uma venda falharia com `entity_organization_mismatch`.

## 2. Modelo escolhido

`catalog_items` (não `products`+`services` separados), conforme
preferência do briefing. `type` distingue `product`/`service` dentro
da mesma tabela — evita duplicar RLS/índices/UI para o mesmo conceito.

## 3. Unidades

`unit text` livre (não enum SQL rígido) — a constraint fica só no
frontend (lista de sugestões), para não travar um tenant futuro com
uma unidade que ainda não pensamos. Documentado explicitamente: `ml` é
uma opção entre outras, nunca uma regra estrutural.

## 4. Legacy adapter

Vendas históricas (com `perfume_id`/`volume_ml`/etc. preenchidos e
nenhuma linha em `sale_items`) são lidas via `src/lib/sale-items-adapter.ts`:
se uma venda não tem `sale_items`, o adapter sintetiza **em memória, na
leitura** (nunca grava no banco) uma linha única a partir dos campos
legados (`description = perfume_name_raw`, `quantity = 1`,
`unit = 'ml'` quando `volume_ml` existir, senão `null`,
`unit_price = amount`, `total_amount = amount`), marcada
`metadata: { legacy: true }`. Sem backfill destrutivo, sem dado
inventado além do que já existe na própria venda.

## 5. Plano de migrations (aditivas, numeração real do repositório)

1. `202609210001_catalog_items.sql` — tabela `catalog_items` + RLS +
   índices + trigger de `updated_at` + permissões `catalog.view`/
   `catalog.manage`.
2. `202609210002_sales_generic_fields.sql` — ALTER TABLE aditivo em
   `sales` (novas colunas nullable/default seguro: `status`,
   `subtotal`, `discount_total`, `total_amount`, `owner_user_id`,
   `source_channel`, `source_medium`, `source_campaign`,
   `source_external_id`, `attribution_metadata`, `metadata`) — só as
   que ainda não existem.
3. `202609210003_sale_items.sql` — tabela `sale_items` + RLS +
   índices + trigger de tenant-validation (sale_id e catalog_item_id
   precisam pertencer à mesma organização) + `entity_belongs_to_organization`
   ganha o case `'sale'`.
4. `202609210004_create_sale_with_items.sql` — RPC transacional
   `create_sale_with_items(...)`, valida permissão/tenant/catalog
   items/cliente, calcula totais no servidor (nunca confia no total
   enviado pelo browser), grava `sales` + `sale_items` + `activities`
   atomicamente.

## 6. Não fazer nesta fase

Sem Automation Engine, sem Mugô Dados, sem agentes de IA, sem
Kanban/stash, sem infraestrutura antiga — só a fundação de dados +
UI de Fase E/F, com `activities` como o mecanismo de evento disponível
hoje (documentado como o event log até um Event Engine real existir).
