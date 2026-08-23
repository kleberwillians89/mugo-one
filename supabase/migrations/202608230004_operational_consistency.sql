begin;

-- Vendas em qualquer shipment ativo precisam prevalecer sobre previsões de
-- chegada. O vínculo canônico é shipment_items.sale_id, inclusive quando o
-- envio nasceu no fluxo operacional e não de uma solicitação do portal.
create or replace function public.davi_excel_dataset()
returns table(
 id uuid,client_name text,sale_date date,shipping_deadline_display text,shipping_deadline_date date,
 shipped_at timestamptz,sale_type text,volume_ml numeric,perfume_name text,amount numeric,
 payment_status text,payment_method text,paid_at date,credit_reference_amount numeric,notes text,
 operational_status text,search_reference text
) language sql stable security definer set search_path=public as $$
 select s.id,c.name,s.sale_date,
 case when coalesce(active_shipment.posted_at,s.shipped_at) is not null then 'ENVIADO' when s.payment_status='cancelled' then 'CANCELADO' when s.shipping_available_date is not null and s.shipping_availability_confirmed_at is null then to_char(s.shipping_available_date,'DD/MM/YYYY') else null end,
 s.shipping_available_date,coalesce(active_shipment.posted_at,s.shipped_at),s.sale_type,s.volume_ml,p.full_name_raw,s.amount,s.payment_status::text,s.payment_method,s.paid_at,s.credit_reference_amount,s.notes,
 case when s.payment_status='cancelled' then 'CANCELADO' when coalesce(active_shipment.posted_at,s.shipped_at) is not null then 'ENVIADO' when active_shipment.shipment_id is not null then 'ENVIO EM ANDAMENTO' when active_client.request_id is not null and own_request.request_id is null then 'PRÓXIMO ENVIO' when own_request.request_id is not null then 'ENVIO EM ANDAMENTO' when s.shipping_availability_confirmed_at is null then 'AGUARDANDO PERFUME' when coalesce(prep.prepared_ml,0)<coalesce(a.quantity_ml,s.volume_ml,0) then 'AGUARDANDO PREPARAÇÃO' else 'PRONTO PARA ENVIO' end,
 coalesce(s.import_signature,'')
 from public.sales s
 join public.clients c on c.id=s.client_id and c.organization_id=s.organization_id
 left join public.perfumes p on p.id=s.perfume_id
 left join public.inventory_allocations a on a.sale_id=s.id and a.status in('reserved','shipping','shipped')
 left join lateral(select sum(bi.quantity_ml) prepared_ml from public.preparation_batch_items bi join public.preparation_batches b on b.id=bi.batch_id and b.status='confirmed' where bi.allocation_id=a.id) prep on true
 left join lateral(select sh.id shipment_id,sh.status,sh.posted_at from public.shipment_items si join public.shipments sh on sh.id=si.shipment_id where si.sale_id=s.id and si.removed_at is null and sh.status<>'cancelled' order by sh.created_at desc limit 1) active_shipment on true
 left join lateral(select r.id request_id from public.customer_shipment_request_items ri join public.customer_shipment_requests r on r.id=ri.request_id left join public.shipments sh on sh.id=r.converted_shipment_id where ri.allocation_id=a.id and ((r.status='requested' and r.converted_shipment_id is null) or(r.status='converted' and sh.status not in('posted','delivered','cancelled'))) limit 1) own_request on true
 left join lateral(select r.id request_id from public.customer_shipment_requests r left join public.shipments sh on sh.id=r.converted_shipment_id where r.client_id=s.client_id and ((r.status='requested' and r.converted_shipment_id is null) or(r.status='converted' and sh.status not in('posted','delivered','cancelled'))) limit 1) active_client on true
 where s.organization_id in(select public.current_user_org_ids())
 and public.has_org_permission(s.organization_id,'sales.view') and s.deleted_at is null;
$$;

-- Custódia legada é estoque pertencente à cliente e deliberadamente não
-- reduz inventory_items. Expor o compromisso separado evita aparentar que
-- esses ml sumiram ou foram contados como reserva do estoque operacional.
create function public.inventory_external_custody_rows(org_id uuid)
returns table(perfume_id uuid,reserved_ml numeric,shipping_ml numeric)
language sql stable security definer set search_path=public as $$
 select a.perfume_id,
   coalesce(sum(a.quantity_ml) filter(where a.status='reserved'),0),
   coalesce(sum(a.quantity_ml) filter(where a.status='shipping'),0)
 from public.inventory_allocations a
 where a.organization_id=org_id
   and org_id in(select public.current_user_org_ids())
   and public.has_org_permission(org_id,'inventory.view')
   and a.allocation_source='legacy_manual_verified' and not a.stock_managed
   and a.status in('reserved','shipping')
 group by a.perfume_id;
$$;
revoke all on function public.inventory_external_custody_rows(uuid) from public,anon;
grant execute on function public.inventory_external_custody_rows(uuid) to authenticated;

commit;
