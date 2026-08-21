# Inventário de seletores de entidades

| Tela/fluxo | Campo atual | Entidade | Comportamento encontrado | Decisão desta rodada |
|---|---|---|---|---|
| Vendas → adicionar venda | Cliente | `clients` | Busca artesanal, sem ARIA e sem proteção contra resposta antiga | Convertido para `EntityCombobox` server-side |
| Vendas → adicionar venda | Perfume | `perfumes` | Campo também cria perfume conforme regra histórica | Mantido; separar seleção/criação mudaria o fluxo operacional |
| Estoque → cadastrar perfume | Perfume existente | `perfumes` | Carregava todos os perfumes em `<select>` | Convertido para `EntityCombobox` server-side |
| Interessados → adicionar | Cliente | `clients` | Busca artesanal sem teclado/ARIA | Convertido para `EntityCombobox` server-side |
| Interessados → adicionar | Perfume | `perfumes` | Carregava todos os perfumes em `<select>` | Convertido para `EntityCombobox` server-side |
| Entregas → novo envio | Cliente | `clients` derivados de allocations reservadas | Lista pequena já necessária para os produtos elegíveis | Mantido; não consulta a tabela inteira |
| Importação IA → revisão | Cliente/perfume | candidatos e inventário do preview | Resolução transacional de alto risco e dados já necessários à revisão | Mantido nesta rodada |
| Minha RUAH → revisão de identidade | Cliente | `clients` | ID confirmado manualmente | Fora do escopo: identidade não pode ser alterada nesta entrega |
| Tarefas/recuperação/conferência | Responsável | membro autenticado | Ação “assumir”, sem escolha arbitrária de membro | Mantido conforme regra existente |
| Configurações da equipe | Copiar permissões de | membro | Lista pequena já carregada para gestão da equipe | Mantido |
| Radar | Perfume relacionado | `perfumes` | Relação derivada do contexto; outros nomes são textos de oferta/fonte | Mantido; não há seletor FK inadequado no formulário atual |
| Clientes | Busca/filtros | não é persistência de FK | Filtro textual legítimo | Mantido |
| Envios | Destinatário | snapshot textual | Campo histórico/operacional legítimo | Mantido |

## Performance

As novas consultas usam `organization_id`, prefixo de `normalized_name` e `LIMIT 12`. O índice B-tree existente de clientes cobre `(organization_id, normalized_name)`; a constraint única de perfumes fornece B-tree em `(organization_id, normalized_name)`. Não foi criada migration.

Busca por ocorrência no meio do texto, `base_name`, `brand_house` ou `bottle_identifier` exigiria estratégia separada, preferencialmente índices trigram (`pg_trgm`). Essa ampliação é recomendada como migration independente, não aplicada nesta rodada.
