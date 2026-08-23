begin;

-- A lista do cliente pertence ao shipment. Allocation e estoque são apenas
-- fontes auxiliares para identificar o perfume e nunca podem ocultar um item
-- legado já congelado em shipment_items.
create or replace function public.customer_shipments_list()
returns table(
  shipment_id uuid, status public.shipment_status, created_at timestamptz,
  items jsonb, shipping_price numeric, carrier text, service text,
  selected_quote_id uuid, customer_approved_at timestamptz,
  tracking_code text, posted_at timestamptz, delivered_at timestamptz,
  cancelled_at timestamptz
)
language sql stable security definer set search_path = public as $$
  select sh.id, sh.status, sh.created_at,
    (select jsonb_agg(jsonb_build_object(
      'allocation_id', si.allocation_id,
      'perfume_id', coalesce(a.perfume_id, s.perfume_id),
      'perfume', coalesce(p.full_name_raw, s.perfume_name_raw, 'Perfume'),
      'quantity_ml', si.quantity_ml
    ) order by coalesce(p.full_name_raw, s.perfume_name_raw, 'Perfume'))
    from public.shipment_items si
    left join public.inventory_allocations a on a.id = si.allocation_id
    left join public.sales s on s.id = si.sale_id
    left join public.perfumes p on p.id = coalesce(a.perfume_id, s.perfume_id)
    where si.shipment_id = sh.id and si.removed_at is null),
    sh.shipping_price, sh.carrier, sh.service, sh.selected_quote_id,
    sh.customer_approved_at, sh.tracking_code, sh.posted_at,
    sh.delivered_at, sh.cancelled_at
  from public.shipments sh
  where sh.client_id = public.current_customer_client()
  order by case when sh.status = 'awaiting_customer_approval' then 0 else 1 end,
    sh.created_at desc;
$$;

revoke all on function public.customer_shipments_list() from public, anon;
grant execute on function public.customer_shipments_list() to authenticated;

commit;
