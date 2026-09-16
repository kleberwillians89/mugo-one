# Modelo de domínio — CRM Universal (Mugô One)

Documento pedido pela Sprint 2 de productização (item 4). Define a
semântica de CUSTOMER / COMPANY / CONTACT e como elas se relacionam com
a tabela legada `clients`, sem reconstruir nada que já funciona.

## Por que `clients` não foi renomeada

`clients` é referenciada por dezenas de RPCs, triggers, RLS policies,
Edge Functions e ~30 migrations (vendas, estoque, portal do cliente,
identidade, dedupe, ManyChat). Renomear fisicamente a tabela — ou trocar
seu nome de coluna — teria um raio de impacto enorme e nenhum benefício
real: o nome da tabela é um detalhe de implementação, não algo que o
usuário final vê.

**Decisão:** `clients` continua sendo a tabela física. `customers` é um
conceito de domínio novo, materializado como um módulo TypeScript
(`src/modules/crm/customers/`) que lê e escreve na tabela `clients`
através de um adapter — sem SQL VIEW. Uma view teria a vantagem
cosmética do nome, mas exigiria validar `security_invoker` e o
comportamento de RLS sobre a view em um banco real antes de confiar
nela; sem um banco de teste conectado neste ambiente (ver sprints
anteriores), o adapter em TypeScript é a opção verificável e reversível.

`clients` ganhou apenas colunas novas, aditivas (migration
`202609180001_crm_customers_generalization.sql`) — nenhuma coluna,
trigger, policy ou RPC existente foi alterada.

## Semântica das três entidades

### CUSTOMER
Pessoa ou entidade que possui relacionamento comercial **direto** com a
organização — quem compra, quem paga, quem recebe o produto/serviço.
Hoje é sempre uma pessoa física ou jurídica cadastrada em `clients`
(CPF ou CNPJ). É o nível "conta financeira/comercial".

### COMPANY
Conta B2B — a empresa com quem a organização se relaciona
comercialmente quando o cliente é uma pessoa jurídica com múltiplos
interlocutores. `companies` é uma tabela nova; não é o mesmo que um
`clients` com CNPJ preenchido — um CUSTOMER com CNPJ ainda representa
"a conta que compra e paga"; uma COMPANY representa a conta B2B em si,
que pode ter vários CONTACTS.

### CONTACT
Pessoa vinculada a uma COMPANY — quem a organização efetivamente fala
(o comprador, o financeiro, o decisor). Um CONTACT normalmente pertence
a uma `company_id`. `customer_id` existe apenas como campo de
compatibilidade opcional, para o caso raro de uma pessoa já cadastrada
como CUSTOMER (B2C) também precisar aparecer como contato em um
relacionamento — **não é o caminho principal**, que é sempre via
`company_id`. Um CONTACT pode não ter nem `company_id` nem
`customer_id` (contato avulso, ainda não qualificado).

### Por que não confundir os três
- Uma agência vendendo para uma clínica: a CLÍNICA é a COMPANY; a
  recepcionista que negocia é o CONTACT; se a clínica também é quem
  paga as faturas diretamente (sem PJ intermediária), o registro
  financeiro dela é o CUSTOMER.
- Uma loja vendendo para pessoa física: só existe CUSTOMER. Não há
  COMPANY nem CONTACT — e não é obrigatório criá-los.
- B2B puro: COMPANY (a conta) + N CONTACTS (as pessoas) + o CUSTOMER
  (o registro financeiro que efetivamente compra/paga) podem ou não ser
  a mesma linha lógica — o desenho permite os três papéis separados sem
  forçar equivalência.

## O que vem depois (não implementado nesta sprint)

LEAD, DEAL e PIPELINE são conceitos de pré-venda (funil comercial) que
ainda não existem no sistema — o legado é 100% pós-venda operacional
(confirmado na auditoria geral). Eles serão construídos numa sprint
futura, sobre a mesma base de CUSTOMER/COMPANY/CONTACT criada aqui
(um DEAL vai referenciar um CUSTOMER e/ou COMPANY, nunca substituí-los).

## Tags, Custom Fields, Notes, Activities — por que são polimórficas

As quatro tabelas (`entity_tags`, `custom_field_values`, `notes`,
`activities`) usam `entity_type` + `entity_id` para poder ser
reaproveitadas por qualquer entidade futura (deal, task, product, sale)
sem migração de schema a cada novo tipo. **Isto é exatamente o padrão
que a auditoria geral identificou como uma falha em `task_assignments`
no legado** ("entity_id é UUID livre sem FK/validação cruzada de
organização"). Para não repetir esse problema:

- `entity_type` tem um `check` restrito aos tipos que **já existem e já
  são validáveis** hoje: `'customer'`, `'company'`, `'contact'`. Cada
  novo tipo (deal, task, product, sale) só entra no `check` quando sua
  tabela existir e a validação for estendida — nunca antes.
- Toda tabela polimórfica tem um trigger `before insert or update` que
  chama `public.entity_belongs_to_organization(entity_type, entity_id,
  organization_id)` — uma função central (não duplicada em cada
  tabela) que verifica, para o tipo informado, se aquele UUID
  realmente pertence àquela organização antes de aceitar a linha.
  Empresa A **não consegue** taguear, comentar ou preencher um campo
  customizado de uma entidade da Empresa B: a escrita é rejeitada com
  exceção antes de chegar ao banco.
- `contacts.company_id` / `contacts.customer_id` têm o mesmo tipo de
  validação, só que direta (não polimórfica) via
  `contacts_validate_tenant_refs()`.

## Autorização usada nas tabelas novas

Todas as tabelas operacionais novas (`companies`, `contacts`, `tags`,
`entity_tags`, `custom_fields`, `custom_field_values`, `notes`) usam
exatamente o mesmo padrão de RLS já aplicado a `clients`/`sales` no
legado: leitura por `current_user_org_ids()`, escrita por
`has_org_role(organization_id, array['admin','manager','operator'])`.
Isso é consistente com ~90% do schema existente hoje. Migrar para
`has_org_permission` (permissão granular) é um passo válido futuro —
exigiria estender o catálogo de `permissions`/`preset_permissions` e a
tela de equipe, o que foi deliberadamente deixado fora desta sprint
para não misturar "criar o schema novo" com "mexer no sistema de
permissões compartilhado". Ver `docs/AUTHORIZATION_STRATEGY.md`.

`activities` é a exceção: só é escrita por triggers via a função
`security definer` `public.log_activity(...)` — não há política de
INSERT para `authenticated` diretamente, o mesmo desenho já usado para
`audit_logs` no núcleo (`feat/core-foundation`). Isto evita qualquer
cliente inserir uma entrada de timeline arbitrária/falsa.

## Origem/atribuição (preparo para Mugô Dados)

`clients`, `companies` e `contacts` ganharam campos de atribuição
genéricos (`source_channel`, `source_campaign`, `source_medium`,
`source_external_id`, `attribution_metadata jsonb`) além do `source`
que já existia em `clients`. Nenhuma integração foi feita — são só
colunas prontas para receber, no futuro, dados de Meta/Google/
Instagram/Shopify/GA4/Mugô Dados sem precisar de nova migration.

## Eventos de timeline integrados nesta sprint

Só os "seguros" listados no briefing: `customer_created`,
`company_created`, `contact_created`, `note_added`, `tag_added` — cada
um via trigger `after insert` na tabela de origem, chamando
`log_activity()`. `deal_created`, `task_created`, `whatsapp_sent`,
`sale_created` etc. ficam para quando essas entidades existirem.
