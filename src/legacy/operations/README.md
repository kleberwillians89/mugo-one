# Legado isolado — operações de frasco/split/perfume

Este diretório existe porque o Mugô One é um CRM/ERP genérico e os
conceitos abaixo **não pertencem ao Core do produto**: eles só fazem
sentido para a operação original de perfumaria fracionada que originou
parte da tecnologia (RUAH).

## O que está aqui

| Arquivo | Era acessível em | Motivo de existir |
|---|---|---|
| `pages/FaltaSplitarPage.tsx` | Menu "Falta Splitar" (`/falta-splitar`) | Fila de fracionamento de frasco pendente |
| `pages/PreparationPage.tsx` | `/estoque/fracionamento` | Fluxo físico de fracionar frasco em splits |
| `pages/SplitsDoDiaPrintPage.tsx` | `/print/splits-do-dia` | Folha de separação diária de splits |
| `pages/PerfumePrintLabelPage.tsx` | `/print/perfume` | Etiqueta 70x30mm de identidade de perfume |
| `pages/QrBottlePage.tsx` | `/q/:token` | Landing de QR físico colado no frasco |
| `pages/PrintLabelPage.tsx` | `/print/bottle`, `/print/split` | Etiqueta de código de barras de frasco/split |

## O que isso significa na prática

- **Não apagamos nada.** O código continua aqui, compilando, tipado,
  com toda a cobertura de teste original preservada (só os caminhos de
  `readFileSync` dos testes foram atualizados para a nova localização).
- **Não está na navegação ativa.** `src/routing.ts`, `src/App.tsx` e
  `src/Auth.tsx` não importam nem roteiam para nenhum destes arquivos.
  Uma organização nova no Mugô One nunca vê, recebe ou precisa entender
  esses conceitos.
- **As permissões `tasks.split`/`inventory.split`** continuam existindo
  em `PERMISSION_CATALOG` (espelho de uma migration histórica já
  aplicada — não pode ser removida de lá), mas estão em
  `LEGACY_ONLY_PERMISSION_CODES` (`src/lib/permissions.ts`) e por isso
  não aparecem na tela de configuração de permissões
  (`TeamSettingsPage`) para nenhuma organização.
- **URLs antigas não quebram feio.** `/estoque/fracionamento` cai no
  estoque genérico normal; `/q/`, `/print/perfume`, `/print/bottle`,
  `/print/split`, `/print/splits-do-dia` caem no shell administrativo
  padrão — nenhuma delas gera 404, mas nenhuma mais monta a tela legada.

## Guarda de regressão

`src/core/mugo-one-zero-split.test.ts` falha se:
- qualquer um destes 6 arquivos for apagado (em vez de apenas isolado);
- "Falta Splitar" voltar ao `Page` union/navigation/routes/pagePermission;
- `App.tsx`/`Auth.tsx` voltarem a importar ou renderizar qualquer um
  destes componentes;
- `tasks.split`/`inventory.split` pararem de estar marcados como
  legacy-only ou voltarem a aparecer na UI de permissões;
- qualquer arquivo de produção em `src/core/` ou `src/modules/crm/`
  mencionar split/splitar/perfume/frasco como conceito de domínio.

## Quando isto deve mudar

Se um dia o Mugô One ganhar um módulo genérico de "fracionamento de
lote"/"unidades serializadas" (não específico de perfume), ele nasce
como um módulo novo em `src/modules/`, com nomenclatura genérica — não
reaproveitando estas telas. Este diretório fica congelado como
histórico/adapter, não como base de arquitetura futura.
