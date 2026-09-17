begin;

-- ============================================================
-- MUGÔ ONE — Sprint "Catálogo Universal + Sale Items" (Fase F)
--
-- create_sale_with_items: cria sale + sale_items + activity
-- atomicamente. Nunca confia no total enviado pelo browser — recalcula
-- tudo a partir de quantity/unit_price/discount de cada item. Se
-- qualquer item falhar (ex.: catalog_item de outra organização),
-- a transação inteira falha (uma exceção não tratada numa function
-- plpgsql reverte tudo).
--
-- `p_items` é jsonb (array de objetos), não um array de tipo
-- composto: é o mesmo padrão já usado por davi_excel_list_multi/
-- davi_excel_distinct (p_filters/p_sorts jsonb + jsonb_array_elements)
-- — o formato que o supabase-js realmente serializa de forma
-- confiável ao chamar uma RPC, sem depender de coerção de tipo
-- composto pelo PostgREST.
-- ============================================================

create or replace function public.create_sale_with_items(
  p_organization_id uuid,
  p_client_id uuid,
  p_items jsonb,
  p_sale_date date default current_date,
  p_payment_status text default 'unknown',
  p_payment_method text default null,
  p_paid_at date default null,
  p_owner_user_id uuid default null,
  p_source text default 'manual',
  p_source_channel text default null,
  p_source_medium text default null,
  p_source_campaign text default null,
  p_source_external_id text default null,
  p_attribution_metadata jsonb default '{}'::jsonb,
  p_notes text default null,
  p_metadata jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_item jsonb;
  v_item_count integer := 0;
  v_position integer := 0;
  v_catalog_item_id uuid;
  v_description text;
  v_quantity numeric;
  v_unit text;
  v_unit_price numeric;
  v_discount numeric;
  v_line_total numeric(14,2);
  v_subtotal numeric(14,2) := 0;
  v_discount_total numeric(14,2) := 0;
  v_total numeric(14,2) := 0;
  v_sale_id uuid;
  v_actor uuid := auth.uid();
begin
  if not public.has_org_permission(p_organization_id, 'sales.create') then
    raise exception 'forbidden';
  end if;

  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) < 1 then
    raise exception 'sale_requires_at_least_one_item';
  end if;

  if not exists (
    select 1 from public.clients
    where id = p_client_id and organization_id = p_organization_id and deleted_at is null
  ) then
    raise exception 'sale_client_organization_mismatch';
  end if;

  if p_owner_user_id is not null and not exists (
    select 1 from public.organization_members
    where organization_id = p_organization_id and user_id = p_owner_user_id and status = 'active'
  ) then
    raise exception 'sale_owner_not_a_member';
  end if;

  -- Primeira passada: valida cada item (inclui catalog_item_id, quando
  -- informado) e acumula os totais sem gravar nada — um item inválido
  -- no meio do array nunca deixa a venda "meio criada".
  for v_item in select * from jsonb_array_elements(p_items) loop
    v_catalog_item_id := nullif(v_item->>'catalog_item_id', '')::uuid;
    v_description := btrim(coalesce(v_item->>'description', ''));
    v_quantity := (v_item->>'quantity')::numeric;
    v_unit := coalesce(nullif(btrim(coalesce(v_item->>'unit', '')), ''), 'un');
    v_unit_price := (v_item->>'unit_price')::numeric;
    v_discount := coalesce((v_item->>'discount_amount')::numeric, 0);

    if v_catalog_item_id is not null and not exists (
      select 1 from public.catalog_items
      where id = v_catalog_item_id and organization_id = p_organization_id and active
    ) then
      raise exception 'sale_item_catalog_item_invalid';
    end if;
    if v_description = '' then raise exception 'sale_item_description_required'; end if;
    if v_quantity is null or v_quantity <= 0 then raise exception 'sale_item_quantity_invalid'; end if;
    if v_unit_price is null or v_unit_price < 0 then raise exception 'sale_item_unit_price_invalid'; end if;
    if v_discount < 0 then raise exception 'sale_item_discount_invalid'; end if;

    v_line_total := round(v_quantity * v_unit_price - v_discount, 2);
    if v_line_total < 0 then raise exception 'sale_item_discount_exceeds_line_value'; end if;

    v_subtotal := v_subtotal + round(v_quantity * v_unit_price, 2);
    v_discount_total := v_discount_total + v_discount;
    v_total := v_total + v_line_total;
    v_item_count := v_item_count + 1;
  end loop;

  insert into public.sales (
    organization_id, client_id, sale_date, amount, payment_status, payment_method, paid_at,
    status, subtotal, discount_total, total_amount, owner_user_id, source, source_channel,
    source_medium, source_campaign, source_external_id, attribution_metadata, notes, metadata,
    created_by
  ) values (
    p_organization_id, p_client_id, p_sale_date, v_total, p_payment_status::payment_status, p_payment_method, p_paid_at,
    'open', v_subtotal, v_discount_total, v_total, p_owner_user_id, p_source, p_source_channel,
    p_source_medium, p_source_campaign, p_source_external_id, coalesce(p_attribution_metadata, '{}'::jsonb),
    p_notes, coalesce(p_metadata, '{}'::jsonb), coalesce(v_actor, auth.uid())
  ) returning id into v_sale_id;

  for v_item in select * from jsonb_array_elements(p_items) loop
    v_catalog_item_id := nullif(v_item->>'catalog_item_id', '')::uuid;
    v_description := btrim(v_item->>'description');
    v_quantity := (v_item->>'quantity')::numeric;
    v_unit := coalesce(nullif(btrim(coalesce(v_item->>'unit', '')), ''), 'un');
    v_unit_price := (v_item->>'unit_price')::numeric;
    v_discount := coalesce((v_item->>'discount_amount')::numeric, 0);
    v_line_total := round(v_quantity * v_unit_price - v_discount, 2);

    insert into public.sale_items (
      organization_id, sale_id, catalog_item_id, description, quantity, unit,
      unit_price, discount_amount, total_amount, position
    ) values (
      p_organization_id, v_sale_id, v_catalog_item_id, v_description,
      v_quantity, v_unit, v_unit_price, v_discount, v_line_total, v_position
    );
    v_position := v_position + 1;
  end loop;

  perform public.log_activity(
    p_organization_id, 'sale', v_sale_id, 'sale_created', v_actor,
    'Venda criada', format('%s item(ns) · total %s', v_item_count, v_total),
    jsonb_build_object('item_count', v_item_count, 'total_amount', v_total)
  );

  return jsonb_build_object(
    'sale_id', v_sale_id,
    'subtotal', v_subtotal,
    'discount_total', v_discount_total,
    'total_amount', v_total,
    'item_count', v_item_count
  );
end;
$$;

revoke execute on function public.create_sale_with_items(
  uuid, uuid, jsonb, date, text, text, date, uuid, text, text, text, text, text, jsonb, text, jsonb
) from public, anon;
grant execute on function public.create_sale_with_items(
  uuid, uuid, jsonb, date, text, text, date, uuid, text, text, text, text, text, jsonb, text, jsonb
) to authenticated;

commit;
