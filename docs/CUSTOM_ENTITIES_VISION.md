# Custom Entities — visão arquitetural (não implementado)

Este documento é conceitual. **Nenhuma migration foi criada.** Objetivo:
desenhar a resposta arquitetural correta para o padrão que se repetiu
5 vezes na auditoria de docs/BUSINESS_UNIVERSALITY_MATRIX.md (Pet,
Vehicle, Property, Equipment, Student) sem comprometer o Core com uma
tabela por segmento.

## Custom Entity não é Custom Field

A distinção é a base de tudo que segue.

**Custom Field** é um atributo de uma entidade que já existe:

> "Renda: R$ 5.000" — um valor a mais no cadastro de um Customer.

Um custom field:
- não tem identidade própria;
- não aparece sozinho em nenhuma lista;
- não tem histórico próprio;
- não se relaciona com outras entidades — ele *pertence* a uma.

**Custom Entity** é um registro próprio:

> "Thor — Golden Retriever" — não é um atributo do tutor, é *outro
> registro*, com os próprios campos, o próprio histórico de consultas,
> e uma relação explícita com o Customer (o tutor).

## Critério para decidir Custom Entity vs. Custom Field

Uma entidade vira candidata a Custom Entity quando, **e só quando**:

- possui vários registros (não é um valor único);
- tem identidade própria (um nome/identificador que a diferencia de outra);
- possui campos próprios (mais de um atributo relevante);
- precisa de relações (com Customer, Deal, Sale, outra Custom Entity);
- pode aparecer em histórico/timeline própria;
- não é simplesmente um atributo de outra entidade.

| Caso | É Custom Entity? | Por quê |
|---|---|---|
| Pet ("Thor") | Sim | múltiplos por tutor, campos próprios, histórico de consultas |
| Raça do pet | Não — é field do Pet | atributo único, sem identidade própria |
| Vehicle (placa ABC-1234) | Sim | múltiplos por cliente, histórico de serviços |
| Placa do veículo | Não — é field do Vehicle | atributo |
| Property (endereço X) | Sim | carteira com N imóveis, relação N:N com Deals |
| Endereço do imóvel | Não — é field da Property | atributo |
| "Renda" de um lead de crédito | Não — é Custom Field do Deal/Customer | valor único, sem identidade própria |

## Modelo de dados proposto (conceitual)

Quatro tabelas, seguindo exatamente o mesmo padrão já usado por
`custom_fields`/`entity_tags`/`activities` neste projeto —
`organization_id` em tudo, RLS por `has_org_permission`, nenhuma
relação cross-org possível.

### `custom_entity_types`

Define os "tipos" que uma organização criou (ex.: "Pet", "Veículo").

```
id                uuid
organization_id   uuid  not null references organizations(id)
name              text  not null        -- "Pet"
slug              text  not null        -- "pet" (usado em relations/UI)
icon              text                  -- nome de ícone, livre
active            boolean not null default true
created_at        timestamptz
updated_at        timestamptz

unique (organization_id, slug)
```

### `custom_entity_fields`

Os campos que cada tipo tem — mesmo shape de `custom_fields`, mas
descrevendo o schema de uma Custom Entity em vez de uma entidade fixa.

```
id                uuid
organization_id   uuid  not null references organizations(id)
entity_type_id    uuid  not null references custom_entity_types(id)
name              text  not null        -- "Raça"
field_type        text  not null        -- mesmo enum de custom_fields: text/number/date/select/...
required          boolean not null default false
options           jsonb not null default '[]'
position          integer not null default 0

unique (entity_type_id, key)
```

### `custom_entity_records`

Os registros de fato — um por Pet, um por Veículo, etc. Os valores dos
campos próprios ficam em `metadata` (jsonb), o mesmo padrão já usado em
`leads.metadata`/`deals.metadata` — não uma linha por campo (isso seria
`custom_entity_field_values`, desnecessário para o volume esperado;
reavaliar só se houver necessidade real de indexar campo a campo).

```
id                uuid
organization_id   uuid  not null references organizations(id)
entity_type_id    uuid  not null references custom_entity_types(id)
display_name      text  not null        -- "Thor"
metadata          jsonb not null default '{}'   -- {"raca": "Golden Retriever", "idade": 3}
created_at        timestamptz
updated_at        timestamptz
```

### `custom_entity_relations`

A relação com o resto do Core — o Pet pertence a um Customer, o
Vehicle pertence a um Customer, a Property se relaciona com N Deals.
Polimórfico nos dois lados, reaproveitando o mesmo `entity_type` já
usado por `entity_tags`/`activities` para o lado "Core", e
`custom_entity_type_id` para o lado "Custom Entity".

```
id                uuid
organization_id   uuid  not null references organizations(id)
from_type         text  not null   -- 'customer' | 'company' | 'deal' | 'custom_entity'
from_id           uuid  not null
to_type           text  not null   -- idem
to_id             uuid  not null
relation_type     text  not null   -- 'owns' | 'belongs_to' | 'linked_to' (livre, sem enum rígido)
created_at        timestamptz
```

`entity_belongs_to_organization()` ganharia, quando este sistema for
implementado, um case genérico para `'custom_entity:<slug>'` ou
similar — validando contra `custom_entity_records` filtrado por
`entity_type_id`. Detalhe de implementação a decidir na hora, não
travar o desenho aqui.

## Exemplos de uso (mesma engine, cinco segmentos)

| Segmento | Custom Entity | Relação |
|---|---|---|
| Veterinária | Pet | Customer → Pet |
| Oficina | Vehicle | Customer → Vehicle |
| Imobiliária | Property | Deal → Property |
| Assistência Técnica | Equipment | Customer → Equipment |
| Escola | Student | Customer → Student |
| Agência (opcional) | Project | Company → Project |

Nenhum desses seis exemplos pede uma tabela própria — todos usam
`custom_entity_types` + `custom_entity_fields` + `custom_entity_records`
+ `custom_entity_relations`, só com `slug`/campos diferentes.

## O que fica fora deste desenho (de propósito)

- **Não** há aqui automação disparada por Custom Entity (isso é
  Automation Engine, fora de escopo).
- **Não** há aqui UI de configuração ("criar tipo de entidade") — só o
  modelo de dados.
- **Não** há aqui decisão sobre busca/indexação de campos dentro do
  `metadata` jsonb — se um cliente real precisar filtrar/ordenar por
  um campo específico em volume, reavaliar `custom_entity_field_values`
  como tabela normalizada nesse momento, não antes.

## Quando implementar

Não implementar nesta sprint. Sobe de prioridade no roadmap (ver
docs/ONBOARDING_PRESETS.md, seção Roadmap) se um cliente real de
Veterinária, Oficina, Imobiliária, Assistência Técnica ou Escola
bloquear por falta disso — é o único item desta lista de arquitetura
futura com critério explícito de "pode furar a fila".
