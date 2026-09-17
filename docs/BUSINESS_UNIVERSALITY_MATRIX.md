# Matriz de universalidade de negócio — Mugô One

Sprint "Universalidade + Presets de Onboarding". Objetivo: provar, por
auditoria de schema e código real (não suposição), que 13 segmentos
muito diferentes conseguem operar sobre o mesmo Core — sem tabela
nova, sem coluna vertical, sem `if business === X` em lugar nenhum.

Regra absoluta desta sprint, válida para todo o documento: nada aqui
vira `PetModule`/`BankingModule`/`WorkshopModule`, nenhuma tabela
`pets`/`vehicles`/`properties`, nenhum campo vertical em
`customers`/`companies`/`contacts`/`leads`/`deals`/`sales`/
`catalog_items`. Tudo específico de segmento se resolve por pipeline
configurável, stages, custom fields, tags, catalog items, feature
flags e (futuramente) Custom Entities/automations.

## Capacidades do Core auditadas (fonte: schema real do banco de staging, não suposição)

| Capacidade | Estado confirmado |
|---|---|
| `pipelines`/`pipeline_stages` | `organization_id`-scoped, `name`/`position`/`probability` livres; `stage_type` é só `open\|won\|lost` (classificação funcional, não rótulo de negócio) — qualquer organização define os próprios nomes de estágio |
| `catalog_items` | uma tabela, `type` `product\|service`, `unit` texto livre (nenhum enum rígido) — confirmado ao vivo vendendo serviço (Agência/Clínica) e produto (Loja) na Fase E/F |
| `sale_items` | 1 a N itens por venda, `catalog_item_id` nullable (item manual), nenhuma coluna de frete/estoque |
| `tags`/`entity_tags` | tabela `tags` genérica (nome/cor, org-scoped); `entity_tags.entity_type` **hoje só aceita `customer\|company\|contact`** — gap real, ver §Gaps |
| `custom_fields`/`custom_field_values` | genérico por `entity_type`, mas **hoje só aceita `customer\|company\|contact`** — mesmo gap, ver §Gaps |
| `clients` (customer) | tem `cpf` **e** `cnpj` — um customer pode ser PF ou ele mesmo ter CNPJ |
| `companies` | `document` genérico (texto livre, comporta CNPJ) — para B2B via Empresa + Contatos |
| `sales`/`create_sale_with_items` | nenhuma coluna/parâmetro assume entrega física, estoque, ou uma única unidade — confirmado por leitura direta das migrations 202609210001-005 |
| `organization_features` | `shipping`/`inventory` já são `is_core=false` — qualquer organização nova nasce sem eles |

## Gaps confirmados (não corrigidos nesta sprint — ver critério em "Por que não corrigir agora")

1. **`entity_tags.entity_type` e `custom_fields.entity_type`/`custom_field_values.entity_type`** ainda têm `CHECK (entity_type in ('customer','company','contact'))` — não incluem `lead`/`deal`/`sale`/`task`, mesmo já existindo `entity_belongs_to_organization()` com suporte a `sale`/`catalog_item` (Fase E/F) e `lead`/`deal` (Sprint 3). Ou seja: a validação central já sabe validar essas entidades, mas as duas constraints de tabela ainda bloqueiam antes de chegar lá.
   - **Impacto real hoje:** zero — não existe nenhuma tela ativa tentando aplicar tag/custom field a lead/deal/sale ainda (Fase A confirmou zero UI para o módulo CRM novo). Não é um bug ativo, é uma extensão pendente e já documentada desde a própria migration original ("estender o check... quando deal/task/product/sale existirem").
   - **Por que não corrigir agora:** ampliar essas duas constraints sem a UI correspondente (nenhuma tela hoje deixa o usuário anexar tag/custom field a uma venda ou negócio) seria implementar meio-a-meio uma capability nova nesta sprint — que é explicitamente de arquitetura/auditoria, não de implementação (§30 do briefing). Fica registrado como item de roadmap (ver docs/ONBOARDING_PRESETS.md e a seção de roadmap ao final deste documento).
2. **Tasks não têm custom fields/tags/activities** — o módulo de tarefas genérico (Task Engine) ainda não existe (ver Fase A: Torre de Controle é legado, oculto por feature flag). Não há o que auditar ainda além de "não existe".

## Segmentos analisados

Para cada segmento: cliente típico, o que vende, fluxo comercial,
pipeline sugerido, entidades específicas (e se viram Custom Field ou
Custom Entity), tags, catalog items, tarefas, automações futuras,
módulos necessários, gaps do Core.

### 1. Serviços / Consultoria

- **Cliente típico:** Company ou Customer (PF autônomo).
- **Vende:** horas de consultoria, projetos, entregáveis.
- **Fluxo:** Lead → Diagnóstico → Proposta → Contrato → Execução → Faturamento.
- **Pipeline:** Novo lead, Diagnóstico, Proposta enviada, Negociação, Fechado.
- **Entidades específicas:** nenhuma que justifique Custom Entity — "Projeto" pode nascer como catalog item tipo serviço, ou (se precisar de histórico/relação próprios) vira Custom Entity depois.
- **Custom fields:** origem do lead, ticket estimado, urgência.
- **Tags:** "Recorrente", "Pontual", "VIP".
- **Catalog items:** "Consultoria estratégica" (service, unit=hour ou month).
- **Tarefas:** follow-up de proposta, kickoff de projeto.
- **Automações futuras:** proposta enviada sem resposta em N dias → lembrete.
- **Módulos:** crm, sales, catalog, tasks. `inventory`/`shipping` = false.
- **Gaps do Core:** nenhum.

### 2. Agência

- **Cliente típico:** Company (B2B) com Contacts.
- **Vende:** gestão de tráfego, social media, sites — serviços recorrentes ou por projeto.
- **Fluxo:** Lead → Diagnóstico → Proposta → Negociação → Contrato → Execução recorrente.
- **Pipeline:** Diagnóstico, Proposta, Negociação, Fechado (já validado ao vivo na Fase E/F com "Gestão de Tráfego").
- **Entidades específicas:** "Projeto" — candidato a Custom Entity futura se precisar de campos/histórico próprios (briefing point de exemplo, §10).
- **Custom fields:** canal de origem, orçamento mensal.
- **Tags:** "Recorrente", "Setup único".
- **Catalog items:** "Gestão de Tráfego", "Social Media", "Site institucional" (service).
- **Tarefas:** onboarding de cliente novo, entrega mensal de relatório.
- **Automações futuras:** contrato fechado → tarefa de kickoff; relatório mensal → lembrete de envio.
- **Módulos:** crm, sales, catalog, tasks. `inventory`/`shipping` = false.
- **Gaps do Core:** nenhum — já validado com dados reais nesta sprint anterior (Fase E/F smoke test).

### 3. Loja / Comércio

- **Cliente típico:** Customer (PF) predominante, pode ter CNPJ.
- **Vende:** produtos físicos, unidade fixa (un).
- **Fluxo:** Venda direta → Pagamento → (opcional) Entrega.
- **Pipeline:** opcional — venda pode não precisar de pipeline (venda de balcão), mas pode usar um pipeline simples se vender por encomenda.
- **Entidades específicas:** nenhuma.
- **Custom fields:** preferências de tamanho/cor (se relevante).
- **Tags:** "Cliente frequente", "Aniversariante do mês".
- **Catalog items:** "Camiseta", "Calça", "Tênis" (product, unit=un) — já validado ao vivo (2× Camiseta) na Fase E/F.
- **Tarefas:** reposição de produto popular (quando inventory ligado).
- **Automações futuras:** venda paga → nota de agradecimento; estoque baixo → alerta.
- **Módulos:** crm, sales, catalog, tasks. `inventory`/`shipping` = true (únicos segmentos desta lista onde normalmente começam ligados).
- **Gaps do Core:** Estoque/Entregas genéricos ainda não existem (Fase A/B: `inventory`/`shipping` ficam ocultos por padrão até a generalização deles — roadmap, não bloqueio para vender).

### 4. Clínica

- **Cliente típico:** Customer (paciente, PF).
- **Vende:** consultas, procedimentos.
- **Fluxo:** Agendamento → Atendimento → Retorno.
- **Pipeline:** Agendado, Em atendimento, Retorno, Concluído.
- **Entidades específicas:** nenhuma (prontuário pode virar Custom Entity no futuro se precisar de histórico clínico estruturado — fora de escopo aqui).
- **Custom fields:** convênio, alergias, profissional responsável.
- **Tags:** "Retorno", "Convênio", "Particular".
- **Catalog items:** "Consulta", "Procedimento" (service, unit=session) — já validado ao vivo nesta sprint anterior (Consulta, R$300 com desconto).
- **Tarefas:** confirmação de agendamento, lembrete de retorno.
- **Automações futuras:** consulta concluída → agendar retorno; véspera de consulta → lembrete ao paciente.
- **Módulos:** crm, sales, catalog, tasks. `inventory`/`shipping` = false.
- **Gaps do Core:** nenhum — já validado com dados reais.

### 5. Veterinária

- **Cliente típico:** Tutor = Customer.
- **Vende:** consulta, vacina, exame, cirurgia, banho, tosa.
- **Fluxo:** Tutor → **Pet** → Consulta → Vacina/Exame/Procedimento → Retorno.
- **Pipeline:** Novo contato, Agendamento, Atendimento, Retorno, Concluído.
- **Entidade específica:** **Pet** — tem múltiplos registros por tutor, identidade própria (nome, espécie, raça), histórico de consultas/vacinas, relação com o Tutor. **Não** é atributo do Customer — é candidata clara a **Custom Entity** (ver §Critério em docs/CUSTOM_ENTITIES_VISION.md). "Raça do pet" é field da entidade Pet, não uma Custom Entity à parte.
- **Custom fields (no Customer/tutor):** nenhum específico necessário além do padrão.
- **Tags:** "Retorno", "Vacina pendente", "VIP".
- **Catalog items:** "Consulta", "Vacina", "Exame", "Cirurgia", "Banho", "Tosa" (service).
- **Tarefas:** lembrete de vacina, retorno pós-cirúrgico.
- **Automações futuras (3):** consulta concluída → agendar retorno em X dias; vacina próxima do vencimento → mensagem automática; novo tutor cadastrado → boas-vindas.
- **Módulos:** crm, sales, catalog, tasks. `inventory` talvez (vacinas/medicamentos), `shipping` = false.
- **Gap do Core:** **Pet como Custom Entity não existe ainda** — bloqueador real para este segmento funcionar por completo (sem Pet, não há onde registrar de qual animal é a consulta). Documentado em docs/CUSTOM_ENTITIES_VISION.md; pode subir de prioridade no roadmap se houver cliente real deste segmento (ver §29/roadmap).

### 6. Pet Shop

- **Cliente típico:** Tutor = Customer.
- **Vende:** produtos (ração, brinquedos) e serviços (banho, tosa).
- **Fluxo:** híbrido de Loja (produto) + Veterinária (serviço, possivelmente ligado a um Pet).
- **Pipeline:** opcional, como Loja.
- **Entidade específica:** mesmo caso do Pet (Custom Entity), compartilhado com Veterinária — reforça que a mesma engine de Custom Entity atende os dois segmentos com o mesmo mecanismo.
- **Tags:** "Cliente frequente", "Assinatura de ração".
- **Catalog items:** "Ração Premium 10kg" (product), "Banho" (service).
- **Tarefas:** lembrete de recompra de ração.
- **Automações futuras:** compra recorrente → lembrete de reposição.
- **Módulos:** crm, sales, catalog, tasks, inventory=true (produto físico), shipping=opcional.
- **Gap do Core:** mesmo gap do Pet (Custom Entity), compartilhado com Veterinária — não é gap novo.

### 7. Correspondente Bancário

- **Cliente típico:** Customer (PF), quase sempre.
- **Vende:** produtos financeiros — não há entrega física.
- **Fluxo:** Lead → Contato → Documentação → Análise → Proposta → Aprovado/Negado → Comissão.
- **Pipeline:** Novo lead, Contato realizado, Documentação, Em análise, Proposta, Aprovado, Negado — **stage_type** mapeia Aprovado→`won`, Negado→`lost`, o resto→`open`, sem nenhum código especial (confirmado: `stage_type` do banco só conhece `open\|won\|lost`, funcional).
- **Entidade específica:** nenhuma — "Proposta" é o próprio Deal (valor, estágio, histórico já cobertos pelo Deal genérico).
- **Custom fields (no Deal ou Customer):** CPF (já existe nativo em `clients.cpf`), renda, instituição, produto de interesse, valor solicitado, número da proposta, status documental — **estes campos NÃO entram no Core**, são custom fields por organização.
- **Tags:** "Documentação pendente", "Alta prioridade", "Crédito aprovado".
- **Catalog items:** "Financiamento", "Consórcio", "Empréstimo", "Portabilidade", "Seguro", "Crédito" (service — o "produto financeiro" é o item vendido, sem estoque).
- **Tarefas:** cobrança de documento pendente, follow-up pós-proposta.
- **Automações futuras (3):** lead criado → tarefa comercial; status documental = pendente por 2 dias → follow-up; deal ganho → tarefa de fechamento/comissão.
- **Módulos:** crm, sales, catalog, tasks. `inventory`/`shipping` = false.
- **Gap do Core:** custom fields em Deal ainda bloqueados pela constraint (ver §Gaps item 1) — é o único ponto real que falta para este segmento ter 100% dos campos sugeridos funcionando hoje; o pipeline/catálogo já funcionam sem nenhuma mudança.

### 8. Oficina

- **Cliente típico:** Customer (PF ou PJ com frota).
- **Vende:** diagnóstico, mão de obra, peças.
- **Fluxo:** Cliente → **Veículo** → Diagnóstico → Orçamento → Aprovação → Execução → Pagamento → Entrega.
- **Pipeline:** Diagnóstico, Orçamento, Aprovado, Em execução, Concluído.
- **Entidade específica:** **Vehicle** (placa, marca, modelo, ano, quilometragem) — múltiplos veículos por cliente, identidade própria, histórico de serviços → Custom Entity, nunca coluna do Customer.
- **Custom fields:** nenhum adicional necessário no Customer.
- **Tags:** "Aguardando peça", "Orçamento aprovado".
- **Catalog items:** "Troca de óleo", "Alinhamento", "Revisão" (service), peças específicas (product).
- **Tarefas:** aguardando peça, ligar quando pronto.
- **Automações futuras (3):** orçamento aprovado → tarefa de execução; aguardando peça → lembrete interno; serviço concluído → avisar cliente.
- **Módulos:** crm, sales, catalog, tasks. `inventory` provável (peças), `shipping` = false normalmente.
- **Gap do Core:** Vehicle como Custom Entity (mesmo padrão do Pet) — bloqueador real para o fluxo completo, mesma resposta arquitetural.

### 9. Assistência Técnica

- **Cliente típico:** Customer (PF ou PJ).
- **Vende:** diagnóstico e reparo de equipamentos.
- **Fluxo:** Cliente → **Equipamento** → Diagnóstico → Orçamento → Reparo → Pagamento → Entrega.
- **Pipeline:** mesmo formato da Oficina.
- **Entidade específica:** **Equipment** (tipo, marca/modelo, número de série) — mesma lógica do Vehicle/Pet, reforça que "objeto físico do cliente com histórico" é sempre resolvido do mesmo jeito: Custom Entity.
- **Catalog items:** "Diagnóstico", "Troca de tela", "Reparo de placa" (service).
- **Tags:** "Garantia", "Orçamento recusado".
- **Automações futuras:** orçamento enviado sem resposta → lembrete; reparo concluído → avisar cliente; equipamento retirado → arquivar caso.
- **Módulos:** crm, sales, catalog, tasks. `inventory` provável (peças/estoque técnico).
- **Gap do Core:** Equipment como Custom Entity — mesmo gap, terceira confirmação do mesmo padrão (Pet/Vehicle/Equipment).

### 10. Contabilidade

- **Cliente típico:** Company + Contacts (o "cliente" é a empresa contratante, com um ou mais contatos responsáveis) — aqui é onde Company/Contact precisam funcionar bem de verdade, não só Customer.
- **Vende:** serviços recorrentes.
- **Fluxo:** Lead → Empresa → Proposta → Contrato → Serviços recorrentes → Tarefas recorrentes.
- **Pipeline:** Lead, Proposta, Contrato assinado, Ativo.
- **Entidades específicas:** nenhuma nova — o ponto crítico aqui não é uma entidade física, é a qualidade do relacionamento Company↔Contact↔Deal, que já existe (`deals.company_id`, `deals.contact_id`).
- **Catalog items:** "Contabilidade mensal", "Abertura de empresa", "BPO financeiro", "Folha", "Consultoria" (service, unit=month para os recorrentes).
- **Tags:** "Simples Nacional", "Lucro Presumido", "Inadimplente".
- **Tarefas:** entrega mensal de obrigações, follow-up de proposta.
- **Automações futuras:** contrato assinado → gerar tarefas recorrentes mensais; obrigação vencendo → lembrete; proposta parada → follow-up.
- **Módulos:** crm, sales, catalog, tasks. `inventory`/`shipping` = false.
- **Gap do Core:** **recorrência** — nem `sales` nem `catalog_items` têm conceito de "serviço recorrente" ainda (uma venda é um evento único). Um contrato mensal hoje exigiria criar uma venda nova todo mês manualmente. Isso é gap real de produto, não de arquitetura multiempresa — fica fora do escopo desta sprint (roadmap: possivelmente uma feature de "recurring sales" futura, não Custom Entity).

### 11. Imobiliária

- **Cliente típico:** Customer ou Company (comprador/locatário), Deal por negociação.
- **Vende:** intermediação de imóveis (a comissão é o "produto" vendido, não o imóvel em si).
- **Fluxo:** Lead → **Imóvel** → Visita → Proposta → Negociação → Contrato.
- **Pipeline:** Lead, Visita agendada, Proposta, Negociação, Contrato.
- **Entidade específica:** **Property** — múltiplos imóveis por carteira, identidade própria (endereço, valor, características), relação N:N com Deals (um imóvel pode ter várias propostas; um lead pode visitar vários imóveis) → Custom Entity. "Endereço do imóvel" é field da entidade Property, não uma Custom Entity à parte.
- **Catalog items:** "Comissão de venda", "Comissão de locação" (service).
- **Tags:** "Imóvel na planta", "Exclusividade".
- **Tarefas:** follow-up pós-visita, renovação de contrato de locação.
- **Automações futuras:** visita agendada → lembrete; proposta parada → follow-up; contrato assinado → tarefa de comissão.
- **Módulos:** crm, sales, catalog, tasks. `inventory`/`shipping` = false.
- **Gap do Core:** Property como Custom Entity — mesmo padrão (quarta confirmação: Pet/Vehicle/Equipment/Property todos pedem exatamente o mesmo mecanismo, nenhum pedindo algo diferente entre si — evidência forte de que "Custom Entity genérica" é a resposta certa, não quatro soluções verticais).

### 12. Salão / Estética

- **Cliente típico:** Customer (PF).
- **Vende:** serviços de beleza, por vezes produtos.
- **Fluxo:** Agendamento → Atendimento → Recompra.
- **Pipeline:** opcional — geralmente venda direta como Clínica.
- **Entidades específicas:** nenhuma.
- **Catalog items:** "Corte", "Coloração", "Manicure" (service), "Shampoo" (product).
- **Tags:** "Cliente VIP", "Aniversariante".
- **Tarefas:** lembrete de retorno (coloração a cada N semanas).
- **Automações futuras:** atendimento concluído → sugerir próximo agendamento; aniversário → mensagem.
- **Módulos:** crm, sales, catalog, tasks, inventory=opcional (produtos de revenda).
- **Gap do Core:** nenhum — mesmo padrão da Clínica, já validado.

### 13. Escola / Curso

- **Cliente típico:** Responsável = Customer.
- **Vende:** matrícula, mensalidade.
- **Fluxo:** Responsável → **Aluno** → Curso → Matrícula → Pagamento.
- **Pipeline:** Interessado, Matrícula em andamento, Matriculado.
- **Entidade específica:** **Student** — pode ter múltiplos alunos por responsável, identidade própria (turma, curso, frequência), histórico → Custom Entity, nunca tabela `students`.
- **Catalog items:** "Mensalidade — Curso X", "Matrícula" (service, unit=month).
- **Tags:** "Bolsista", "Inadimplente".
- **Tarefas:** cobrança de mensalidade em atraso.
- **Automações futuras:** matrícula concluída → boas-vindas; mensalidade vencendo → lembrete; frequência baixa → alerta.
- **Módulos:** crm, sales, catalog, tasks. `inventory`/`shipping` = false.
- **Gap do Core:** Student como Custom Entity — quinta confirmação do mesmo padrão.

## Matriz de capabilities

`CORE` = já funciona sem nenhuma mudança. `OPTIONAL` = existe, mas normalmente desligado por feature flag para este segmento. `FUTURE` = roadmap, ainda não implementado. `N/A` = não relevante para o segmento.

| Segmento | CRM | Companies | Pipeline | Catalog | Sales | Tasks | Inventory | Shipping | Custom Fields | Custom Entity futura |
|---|---|---|---|---|---|---|---|---|---|---|
| Serviços/Consultoria | CORE | OPTIONAL | CORE | CORE | CORE | FUTURE | N/A | N/A | CORE | N/A |
| Agência | CORE | CORE | CORE | CORE | CORE | FUTURE | N/A | N/A | CORE | OPTIONAL (Projeto) |
| Loja/Comércio | CORE | OPTIONAL | OPTIONAL | CORE | CORE | FUTURE | OPTIONAL | OPTIONAL | CORE | N/A |
| Clínica | CORE | N/A | CORE | CORE | CORE | FUTURE | N/A | N/A | CORE | N/A |
| Veterinária | CORE | N/A | CORE | CORE | CORE | FUTURE | OPTIONAL | N/A | CORE | FUTURE (Pet) |
| Pet Shop | CORE | N/A | OPTIONAL | CORE | CORE | FUTURE | OPTIONAL | OPTIONAL | CORE | FUTURE (Pet) |
| Correspondente Bancário | CORE | N/A | CORE | CORE | CORE | FUTURE | N/A | N/A | CORE* | N/A |
| Oficina | CORE | OPTIONAL | CORE | CORE | CORE | FUTURE | OPTIONAL | N/A | CORE | FUTURE (Vehicle) |
| Assistência Técnica | CORE | OPTIONAL | CORE | CORE | CORE | FUTURE | OPTIONAL | N/A | CORE | FUTURE (Equipment) |
| Contabilidade | CORE | CORE | CORE | CORE | CORE** | FUTURE | N/A | N/A | CORE | N/A |
| Imobiliária | CORE | OPTIONAL | CORE | CORE | CORE | FUTURE | N/A | N/A | CORE | FUTURE (Property) |
| Salão/Estética | CORE | N/A | OPTIONAL | CORE | CORE | FUTURE | OPTIONAL | N/A | CORE | N/A |
| Escola/Curso | CORE | N/A | CORE | CORE | CORE | FUTURE | N/A | N/A | CORE | FUTURE (Student) |

`*` custom fields em Deal (não em customer/company/contact) esbarram no gap documentado acima.
`**` recorrência de venda mensal é gap de produto — venda avulsa funciona hoje, recorrência automática não.

## Padrão que emerge (evidência para o critério final)

**5 dos 13 segmentos** pedem uma entidade própria com múltiplos
registros, identidade e histórico (Pet, Vehicle, Property, Equipment,
Student) — e em **todos os 5 casos a resposta é idêntica**: Custom
Entity genérica, nunca uma tabela nova por segmento. Nenhum dos 13
segmentos pediu uma capability que o Core genérico (CRM + Pipeline +
Catalog + Sales + Custom Fields + Tags + Feature Flags) não resolvesse
— exceto os dois gaps documentados (entity_type de tags/custom fields
ainda não cobre lead/deal/sale/task; recorrência de venda). Isso é a
prova concreta pedida pelo critério final da sprint.
