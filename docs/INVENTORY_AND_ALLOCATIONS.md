# Estoque e alocações

- `physical_ml`: quantidade fisicamente guardada pela RUAH.
- `reserved_ml`: quantidade paga pertencente a clientes e ainda não preparada.
- `shipping_ml`: quantidade em Shipment ainda não postado.
- `available_ml`: quantidade que ainda pode ser vendida.

Para itens reconciliados:

```text
disponível = físico - reservado - em preparação
```

`inventory_allocations` é a fonte de propriedade por cliente e venda. `inventory_movements` continua como razão dos movimentos físicos/administrativos. Preparar Shipment não cria movimento de estoque. Postar Shipment reduz apenas o físico, pois o disponível já foi reduzido no pagamento.

As RPCs mutáveis usam locking e falham quando o disponível ou o físico seria negativo. Uma alocação ativa por venda é garantida por índice parcial.

O primeiro rollout marca os 15 itens existentes como `review_required` e preserva `physical_ml=available_ml`. As 5.892 vendas históricas não são transformadas em reservas, mesmo quando estão pagas e sem `shipped_at`.
