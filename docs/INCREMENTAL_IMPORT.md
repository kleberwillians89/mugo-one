# Importação incremental

A base do Supabase é a referência primária. A planilha nova é um adendo e nunca substitui lotes existentes.

## Fluxo

1. Gerar snapshot remoto em `private_data/`.
2. Comparar cada linha com as vendas reais.
3. Gravar relatório e staging privados.
4. Revisar `possible_duplicate` e `review_required`.
5. Apresentar `existing_changed` antes de atualizar.
6. Aplicar somente decisões aprovadas e registrar before/after.
7. Reexecutar a comparação; o resultado esperado é zero `new_safe` adicional.

Classificações:

- `existing_exact`: não escreve.
- `existing_changed`: mesma identidade comercial, campos mutáveis diferentes; exige confirmação.
- `new_safe`: sem correspondência exata ou próxima; ainda exige aprovação do lote.
- `possible_duplicate`: não escreve sem decisão humana.
- `review_required`: dados incompletos, operacionais ou inconsistentes.

Pagamento, forma de pagamento, data de pagamento, envio e observação não integram rigidamente a identidade. Assim, `pending → paid` é atualização, não uma nova venda.

## Comandos

```bash
node scripts/snapshot-remote.mjs private_data
npm run analyze:incremental -- "/caminho/planilha.xlsx"
```

Os arquivos completos ficam exclusivamente em `private_data/`, protegida pelo `.gitignore`. O terminal recebe somente agregados sem PII.

## Histórico e estoque

Toda venda existente e toda venda inserida por importação incremental mantém `inventory_allocation_eligible=false`. Uma venda histórica paga não cria reserva. Somente vendas criadas pelo novo formulário operacional recebem elegibilidade e podem executar `paid → reserved`.

O fluxo antigo `replace_commercial_batch_v2` permanece apenas para compatibilidade e não é usado pela importação incremental.

