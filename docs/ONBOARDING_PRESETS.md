# Presets de onboarding — visão (não implementado)

Conceitual, como docs/CUSTOM_ENTITIES_VISION.md — nenhuma UI de
onboarding, nenhuma engine de aplicação de preset foi criada nesta
sprint. Objetivo: desenhar como "Qual é o seu tipo de negócio?" vira
configuração inicial sem nunca virar um produto novo.

## Regra absoluta

**Preset não é um novo produto.** O Core continua único. Depois que o
preset é aplicado, a organização pode editar pipeline, tags, campos,
catálogo e features livremente — nada fica travado por causa do preset
escolhido, e a organização **nunca** ganha uma coluna
`business_type = 'veterinary'` usada como regra de comportamento do
Core. No máximo existe um metadata (`organization_settings.settings`,
já existente desde a Fase 1, formato livre) guardando qual preset foi
escolhido, só para analytics/onboarding — nunca para um `if
business_type === 'veterinary'` em código ativo.

## O que um preset pode configurar

- `pipeline` + `stages` (nomes, ordem, `stage_type` open/won/lost)
- `tags` iniciais sugeridas
- `custom fields` iniciais sugeridos (quando a entidade já suportar — ver gap em BUSINESS_UNIVERSALITY_MATRIX.md)
- `catalog items` de exemplo
- `feature flags` sugeridas (habilitar/desabilitar módulos)
- (futuro) task templates
- (futuro) automation templates
- (futuro) dashboard widgets

Um preset **nunca** altera schema. Aplicar um preset é só popular
linhas nas tabelas que já existem (`pipelines`, `pipeline_stages`,
`tags`, `custom_fields`, `catalog_items`, `organization_features`) com
os valores sugeridos — a mesma escrita que o usuário faria manualmente
pela UI, só que em lote e com um clique.

## Primeiros presets oficiais

1. **Serviços / Consultoria**
2. **Agência**
3. **Loja / Comércio**
4. **Clínica**
5. **Veterinária / Pet**
6. **Correspondente Bancário**
7. **Oficina / Assistência Técnica**
8. **Contabilidade**
9. **Imobiliária**
10. **Começar do zero** — sem pipeline/tags/catálogo pré-populados; a organização nasce só com o Core (crm+sales+tasks+catalog, todos core) e configura tudo manualmente.

Cada preset (1-9) usa exatamente o pipeline/tags/catalog items/feature
flags já documentados por segmento em
docs/BUSINESS_UNIVERSALITY_MATRIX.md — este documento não repete o
conteúdo, referencia-o como fonte única.

## Fluxo de onboarding (futuro)

```
Criar organização
  ↓
Nome da empresa
  ↓
"Qual é o seu tipo de negócio?"
  ↓
Escolher preset (1 dos 9, ou "Começar do zero")
  ↓
Preview (mostrar o que vai ser criado: pipeline, tags, catálogo, features)
  ↓
Aplicar
  ↓
Pipeline + Tags + Fields + Catálogo + Features criados
  ↓
Primeira ação sugerida (ex.: "Cadastre seu primeiro item" / "Crie sua primeira venda")
  ↓
Dashboard
```

O "Preview" é deliberado: o usuário vê exatamente o que será criado
antes de aplicar — presets não devem ser uma caixa preta.

## Idempotência (desenho, não implementado)

Aplicar um preset duas vezes **não pode duplicar** stages, tags,
fields ou catalog items. Quando a engine de aplicação for construída,
cada linha criada por um preset precisa carregar de onde veio, para a
segunda aplicação conseguir fazer "criar só o que falta" em vez de
inserir tudo de novo:

- `preset_key` — qual preset gerou a linha (ex.: `'veterinaria'`)
- `template_key` — qual item dentro do preset (ex.: `'stage:agendamento'`, `'catalog_item:consulta'`)
- opcionalmente um `origin_preset` na própria linha (`pipelines.metadata`, `tags` não tem `metadata` hoje — precisaria ganhar, ou usar uma tabela de auditoria separada `preset_applications`)

Isso **não** é implementado nesta sprint — decisão de schema fica para
quando a engine de aplicação for construída de fato (evitar desenhar
uma tabela hoje que se prova errada quando o código real aparecer).

## Automações futuras por preset (3 exemplos cada, não implementado)

Já documentado por segmento em docs/BUSINESS_UNIVERSALITY_MATRIX.md.
Resumo dos três citados explicitamente no briefing:

**Correspondente Bancário**
- `lead.created` → tarefa comercial
- `status_documental = pendente` por 2 dias → follow-up
- `deal.won` → tarefa de fechamento/comissão

**Veterinária**
- consulta concluída → agendar retorno em X dias
- vacina próxima do vencimento → mensagem automática
- novo tutor cadastrado → boas-vindas

**Oficina**
- orçamento aprovado → tarefa de execução
- aguardando peça → lembrete interno
- serviço concluído → avisar cliente

Nenhuma automação é implementada agora — isso é Automation Engine
(item O do roadmap abaixo).

## IA futura (arquitetura, não implementado)

O agente central deve receber, como contexto por organização:
`organization` (settings), `pipeline` (stages configurados), `custom
fields` (schema por entidade), `custom entities` (tipos e campos
quando existirem), `catalog` (itens vendáveis), `activities`, `tasks`,
`automations` (quando existirem) — e entender dinamicamente o negócio
a partir desses dados. **Nunca** `if business === 'veterinary'` no
agente central: o agente lê o pipeline/catálogo/campos reais da
organização, do mesmo jeito que um humano novo na equipe leria a tela.

## Feature flags — mapa de módulos prováveis por preset

Preset **sugere**, nunca força — o usuário pode ligar/desligar
qualquer feature depois de aplicar. Módulos mapeados (capabilities, já
existentes em `src/core/features/featureCatalog.ts`, nenhum novo
criado aqui): `crm`, `sales`, `catalog`, `tasks`, `communications`,
`automations`, `ai`, `inventory`, `shipping`, `customer_portal`, `fiscal`.

| Preset | inventory | shipping |
|---|---|---|
| Serviços/Consultoria | false | false |
| Agência | false | false |
| Loja/Comércio | true | true |
| Clínica | false | false |
| Veterinária/Pet | opcional | false |
| Correspondente Bancário | false | false |
| Oficina/Assistência | opcional | false |
| Contabilidade | false | false |
| Imobiliária | false | false |

**Proibido:** criar `feature_veterinary`/`feature_banking`/
`feature_workshop` ou qualquer feature por ramo. Features representam
capabilities (o quê o sistema faz), nunca setores (quem usa) — um
preset de Veterinária pode ligar `inventory` porque vende produto
físico às vezes, não porque "é veterinária".

## Roadmap (ordem futura, atualizado nesta sprint)

| Ordem | Item |
|---|---|
| K | Task Engine |
| L | Task Kanban |
| M | Communication Hub |
| N | Event Engine |
| O | Automation Engine |
| P | Data Hub / Mugô Dados |
| Q | AI Agents |
| R | Custom Entities |
| S | Onboarding Presets executáveis |

**Custom Entities (R) pode subir de prioridade** se bloquear clientes
reais — é o único item da lista com esse critério explícito, porque
6 dos 13 segmentos auditados (Veterinária e Pet Shop compartilhando a
mesma entidade Pet, mais Oficina, Assistência Técnica, Imobiliária e
Escola) dependem dele para o fluxo comercial completo, não só para uma
conveniência.
