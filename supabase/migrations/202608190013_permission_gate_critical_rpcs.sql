begin;

-- RUAH — troca has_org_role por has_org_permission nas RPCs críticas
-- auditadas (briefing "RPCs CRÍTICOS"). Mesma assinatura em toda função
-- abaixo — CREATE OR REPLACE, nenhum DROP, nenhum comportamento além da
-- checagem de autorização mudou. O backfill de 202608190011 garante que
-- todo membro já existente mantém exatamente a capacidade que já tinha.

-- ---------------------------------------------------------------------
-- inventory_apply → inventory.adjust. Corpo idêntico ao vigente
-- (202608190009), só a linha de autorização troca.
-- ---------------------------------------------------------------------
create or replace function public.inventory_apply(
  p_item_id uuid,
  p_quantity_ml numeric,
  p_type public.inventory_movement_type,
  p_reason text,
  p_notes text default null,
  p_sale_id uuid default null,
  p_origin text default null
) returns public.inventory_movements
language plpgsql
security definer
set search_path = public
as $$
declare
  v_item public.inventory_items;
  v_movement public.inventory_movements;
  v_after numeric;
  v_physical_after numeric;
  v_confirms boolean;
begin
  select * into v_item from public.inventory_items where id = p_item_id for update;
  if not found then
    raise exception 'inventory_item_not_found';
  end if;

  if auth.uid() is not null
     and not public.has_org_permission(v_item.organization_id, 'inventory.adjust') then
    raise exception 'inventory_write_forbidden';
  end if;

  if p_quantity_ml = 0 or btrim(coalesce(p_reason, '')) = '' then
    raise exception 'inventory_reason_and_quantity_required';
  end if;

  v_after := v_item.available_ml + p_quantity_ml;
  v_physical_after := v_item.physical_ml + p_quantity_ml;
  if v_after < 0 then
    raise exception 'insufficient_available_inventory';
  end if;
  if v_physical_after < 0 then
    raise exception 'insufficient_physical_inventory';
  end if;

  v_confirms := p_type in ('entry', 'positive_adjustment', 'negative_adjustment', 'administrative_correction');

  update public.inventory_items set
    available_ml = v_after,
    physical_ml = v_physical_after,
    updated_at = now(),
    bootstrap_pending_verification = case when v_confirms then false else bootstrap_pending_verification end,
    reconciliation_status = case when v_confirms and reconciliation_status = 'review_required' then 'reconciled' else reconciliation_status end
  where id = v_item.id;

  insert into public.inventory_movements(
    organization_id, inventory_item_id, perfume_id, sale_id, movement_type, quantity_ml,
    balance_before, balance_after, reason, notes, created_by, origin
  ) values (
    v_item.organization_id, v_item.id, v_item.perfume_id, p_sale_id, p_type, p_quantity_ml,
    v_item.available_ml, v_after, p_reason, p_notes, auth.uid(), p_origin
  ) returning * into v_movement;

  insert into public.audit_logs(organization_id, actor_id, action, entity_type, entity_id, metadata)
  values (
    v_item.organization_id, auth.uid(), 'inventory_movement', 'inventory_item', v_item.id::text,
    jsonb_build_object(
      'movement_id', v_movement.id, 'type', p_type, 'quantity_ml', p_quantity_ml, 'sale_id', p_sale_id,
      'origin', p_origin, 'physical_before', v_item.physical_ml, 'physical_after', v_physical_after
    )
  );

  return v_movement;
end;
$$;

-- ---------------------------------------------------------------------
-- inventory_split_bottle → inventory.split. Corpo idêntico ao vigente
-- (202608190007).
-- ---------------------------------------------------------------------
create or replace function public.inventory_split_bottle(
  p_source_bottle_id uuid,p_quantity_ml numeric,p_count integer
) returns setof public.inventory_split_units
language plpgsql security definer set search_path=public
as $$
declare
  v_bottle public.inventory_bottles; v_total numeric; v_seq integer; v_split_code text; v_row public.inventory_split_units; i integer;
begin
  select * into v_bottle from public.inventory_bottles where id=p_source_bottle_id for update;
  if v_bottle.id is null then raise exception 'bottle_not_found'; end if;
  if not public.has_org_permission(v_bottle.organization_id,'inventory.split')
    then raise exception 'inventory_write_forbidden'; end if;
  if p_quantity_ml is null or p_quantity_ml<=0 then raise exception 'invalid_quantity'; end if;
  if p_count is null or p_count<=0 or p_count>500 then raise exception 'invalid_count'; end if;
  if v_bottle.status<>'active' then raise exception 'bottle_unavailable'; end if;

  v_total:=p_quantity_ml*p_count;
  if v_bottle.physical_ml<v_total then raise exception 'insufficient_bottle_inventory'; end if;

  select count(*) into v_seq from public.inventory_split_units where source_bottle_id=p_source_bottle_id;

  update public.inventory_bottles set
    physical_ml=physical_ml-v_total,
    status=case when physical_ml-v_total=0 then 'empty' else status end,
    updated_at=now()
  where id=p_source_bottle_id;

  for i in 1..p_count loop
    v_seq:=v_seq+1;
    v_split_code:='S'||substring(v_bottle.bottle_code from 2)||'-'||lpad(v_seq::text,3,'0');
    insert into public.inventory_split_units(
      organization_id,perfume_id,inventory_item_id,source_bottle_id,split_code,barcode_value,quantity_ml,created_by
    ) values(
      v_bottle.organization_id,v_bottle.perfume_id,v_bottle.inventory_item_id,p_source_bottle_id,
      v_split_code,'RUAH-'||v_split_code,p_quantity_ml,auth.uid()
    ) returning * into v_row;
    return next v_row;
  end loop;

  insert into public.audit_logs(organization_id,actor_id,action,entity_type,entity_id,metadata)
  values(v_bottle.organization_id,auth.uid(),'inventory_bottle_split','inventory_bottle',p_source_bottle_id::text,
    jsonb_build_object('quantity_ml',p_quantity_ml,'count',p_count,'total_ml',v_total,'physical_ml_before',v_bottle.physical_ml,'physical_ml_after',v_bottle.physical_ml-v_total));
  return;
end;
$$;

-- ---------------------------------------------------------------------
-- shipment_item_scan_bottle → shipping.scan. Corpo idêntico ao vigente
-- (202608190007).
-- ---------------------------------------------------------------------
create or replace function public.shipment_item_scan_bottle(
  p_shipment_id uuid,p_allocation_id uuid,p_scan_value text
) returns jsonb
language plpgsql security definer set search_path=public
as $$
declare
  v_shipment public.shipments; v_item public.shipment_items; v_allocation public.inventory_allocations;
  v_bottle public.inventory_bottles; v_split public.inventory_split_units; v_normalized text; v_conflict_id uuid;
  v_committed_ml numeric;
begin
  select * into v_shipment from public.shipments where id=p_shipment_id;
  if v_shipment.id is null or v_shipment.organization_id not in(select public.current_user_org_ids()) then raise exception 'shipment_not_found'; end if;
  if not public.has_org_permission(v_shipment.organization_id,'shipping.scan')
    then raise exception 'forbidden'; end if;

  select * into v_item from public.shipment_items
    where shipment_id=p_shipment_id and allocation_id=p_allocation_id and removed_at is null for update;
  if v_item.id is null then raise exception 'shipment_item_not_found'; end if;

  select * into v_allocation from public.inventory_allocations where id=p_allocation_id;
  if v_allocation.id is null or not v_allocation.stock_managed or v_allocation.perfume_id is null then
    return jsonb_build_object('ok',false,'reason','not_bottle_tracked');
  end if;

  v_normalized:=btrim(coalesce(p_scan_value,''));

  select su.* into v_split from public.inventory_split_units su
    where su.organization_id=v_shipment.organization_id
      and (upper(su.barcode_value)=upper(v_normalized) or upper(su.split_code)=upper(v_normalized))
    limit 1;

  if v_split.id is not null then
    if v_split.perfume_id<>v_allocation.perfume_id then
      return jsonb_build_object('ok',false,'reason','wrong_perfume','split_code',v_split.split_code);
    end if;
    if v_split.status<>'available' then
      return jsonb_build_object('ok',false,'reason','split_unavailable','status',v_split.status);
    end if;
    if v_split.quantity_ml<>v_item.quantity_ml then
      return jsonb_build_object('ok',false,'reason','split_quantity_mismatch','split_ml',v_split.quantity_ml,'needed_ml',v_item.quantity_ml);
    end if;
    select si.shipment_id into v_conflict_id from public.shipment_items si
      where si.split_unit_id=v_split.id and si.removed_at is null and si.id<>v_item.id;
    if v_conflict_id is not null then
      return jsonb_build_object('ok',false,'reason','split_already_assigned');
    end if;

    begin
      update public.shipment_items set
        split_unit_id=v_split.id,
        bottle_id=null,
        separated_at=coalesce(separated_at,now()),
        separated_by=coalesce(separated_by,auth.uid())
      where id=v_item.id;
    exception when unique_violation then
      return jsonb_build_object('ok',false,'reason','split_already_assigned');
    end;

    insert into public.audit_logs(organization_id,actor_id,action,entity_type,entity_id,metadata)
    values(v_shipment.organization_id,auth.uid(),'shipment_item_split_scanned','shipment_item',v_item.id::text,
      jsonb_build_object('shipment_id',p_shipment_id,'allocation_id',p_allocation_id,'split_unit_id',v_split.id,'split_code',v_split.split_code));

    return jsonb_build_object('ok',true,'kind','split','split_unit_id',v_split.id,'split_code',v_split.split_code,
      'quantity_ml',v_split.quantity_ml,'needed_ml',v_item.quantity_ml);
  end if;

  select b.* into v_bottle from public.inventory_bottles b
    where b.organization_id=v_shipment.organization_id
      and (b.qr_token=v_normalized or upper(b.barcode_value)=upper(v_normalized) or upper(b.bottle_code)=upper(v_normalized))
    limit 1
    for update;
  if v_bottle.id is null then
    return jsonb_build_object('ok',false,'reason','bottle_not_found');
  end if;

  if v_bottle.perfume_id<>v_allocation.perfume_id then
    return jsonb_build_object('ok',false,'reason','wrong_perfume','bottle_label',v_bottle.bottle_label,'bottle_code',v_bottle.bottle_code);
  end if;
  if v_bottle.status<>'active' then
    return jsonb_build_object('ok',false,'reason','bottle_unavailable','status',v_bottle.status);
  end if;

  select coalesce(sum(si.quantity_ml),0) into v_committed_ml
    from public.shipment_items si
    join public.shipments s2 on s2.id=si.shipment_id
    where si.bottle_id=v_bottle.id and si.removed_at is null and si.id<>v_item.id
      and s2.status not in('posted','delivered','cancelled');

  if v_bottle.physical_ml-v_committed_ml<v_item.quantity_ml then
    return jsonb_build_object('ok',false,'reason','insufficient_ml','available_ml',v_bottle.physical_ml-v_committed_ml,'needed_ml',v_item.quantity_ml);
  end if;

  update public.shipment_items set
    bottle_id=v_bottle.id,
    split_unit_id=null,
    separated_at=coalesce(separated_at,now()),
    separated_by=coalesce(separated_by,auth.uid())
  where id=v_item.id;

  insert into public.audit_logs(organization_id,actor_id,action,entity_type,entity_id,metadata)
  values(v_shipment.organization_id,auth.uid(),'shipment_item_bottle_scanned','shipment_item',v_item.id::text,
    jsonb_build_object('shipment_id',p_shipment_id,'allocation_id',p_allocation_id,'bottle_id',v_bottle.id,'bottle_code',v_bottle.bottle_code));

  return jsonb_build_object('ok',true,'kind','bottle','bottle_id',v_bottle.id,'bottle_code',v_bottle.bottle_code,'bottle_label',v_bottle.bottle_label,
    'physical_ml',v_bottle.physical_ml,'needed_ml',v_item.quantity_ml);
end;
$$;

-- ---------------------------------------------------------------------
-- post_shipment → shipping.post. Corpo idêntico ao vigente (202608190007).
-- ---------------------------------------------------------------------
create or replace function public.post_shipment(p_shipment_id uuid)
returns void language plpgsql security definer set search_path=public as $$
declare v public.shipments; r record; v_bottle_id uuid; v_bottle_physical numeric; v_split_id uuid; v_tracking_status text;
begin
  select * into v from public.shipments where id=p_shipment_id for update;
  if v.id is null or not public.has_org_permission(v.organization_id,'shipping.post') then raise exception 'forbidden'; end if;
  if v.status in('posted','delivered') then return; end if;
  if v.status not in('label_released','customer_approved') then raise exception 'shipment_not_ready_to_post'; end if;
  for r in select a.* from public.inventory_allocations a where a.shipment_id=v.id and a.status='shipping' for update loop
    v_bottle_id:=null;
    v_split_id:=null;
    v_tracking_status:=null;
    if r.stock_managed then
      perform 1 from public.inventory_items where id=r.inventory_item_id and physical_ml>=r.quantity_ml for update;
      if not found then raise exception 'insufficient_physical_inventory'; end if;

      select si.bottle_id,si.split_unit_id into v_bottle_id,v_split_id from public.shipment_items si
        where si.shipment_id=v.id and si.allocation_id=r.id and si.removed_at is null;
      if v_bottle_id is not null and v_split_id is not null then
        raise exception 'multiple_physical_sources_confirmed';
      end if;
      select bottle_tracking_status into v_tracking_status from public.inventory_items where id=r.inventory_item_id;
      if v_tracking_status='active' and v_bottle_id is null and v_split_id is null then
        raise exception 'physical_source_not_confirmed';
      end if;

      update public.inventory_items set physical_ml=physical_ml-r.quantity_ml,updated_at=now() where id=r.inventory_item_id;

      if v_bottle_id is not null then
        select physical_ml into v_bottle_physical from public.inventory_bottles where id=v_bottle_id for update;
        if not found then raise exception 'bottle_not_found'; end if;
        if v_bottle_physical<r.quantity_ml then raise exception 'insufficient_bottle_inventory'; end if;
        update public.inventory_bottles set
          physical_ml=physical_ml-r.quantity_ml,
          status=case when physical_ml-r.quantity_ml=0 then 'empty' else status end,
          updated_at=now()
        where id=v_bottle_id;
      end if;
      if v_split_id is not null then
        update public.inventory_split_units
          set status='consumed',consumed_at=now()
          where id=v_split_id and status='available' and quantity_ml=r.quantity_ml;
        if not found then raise exception 'split_unit_unavailable'; end if;
      end if;
    end if;
    update public.inventory_allocations set status='shipped',shipped_at=now(),updated_at=now() where id=r.id;
  end loop;
  update public.shipments set status='posted',posted_at=now(),updated_at=now() where id=v.id;
  insert into public.shipment_events(organization_id,shipment_id,event_type,from_status,to_status,actor_id)
    values(v.organization_id,v.id,'shipment_posted',v.status,'posted',auth.uid());
end;$$;

-- ---------------------------------------------------------------------
-- inventory_bottle_confirm_conference → inventory.conference. Corpo
-- idêntico ao vigente (202608190010, já com o cast do enum corrigido).
-- ---------------------------------------------------------------------
create or replace function public.inventory_bottle_confirm_conference(
  p_bottle_id uuid,
  p_observed_ml numeric,
  p_apc_available boolean,
  p_expected_updated_at timestamptz
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_bottle public.inventory_bottles;
  v_ml_before numeric;
  v_apc_before boolean;
  v_delta numeric;
  v_movement public.inventory_movements;
  v_conference public.inventory_bottle_conferences;
begin
  select * into v_bottle from public.inventory_bottles where id = p_bottle_id for update;
  if not found then
    raise exception 'bottle_not_found';
  end if;
  if v_bottle.organization_id not in (select public.current_user_org_ids()) then
    raise exception 'bottle_not_found';
  end if;
  if not public.has_org_permission(v_bottle.organization_id, 'inventory.conference') then
    raise exception 'inventory_write_forbidden';
  end if;
  if p_observed_ml is null or p_observed_ml < 0 then
    raise exception 'invalid_observed_amount';
  end if;
  if p_expected_updated_at is distinct from v_bottle.updated_at then
    raise exception 'stale_conference';
  end if;

  v_ml_before := v_bottle.physical_ml;
  v_apc_before := v_bottle.apc_unit_available;
  v_delta := p_observed_ml - v_ml_before;
  if v_delta <> 0 then
    v_movement := public.inventory_apply(
      v_bottle.inventory_item_id,
      v_delta,
      (case when v_delta > 0 then 'positive_adjustment' else 'negative_adjustment' end)::public.inventory_movement_type,
      'Conferência física de frasco (' || v_bottle.bottle_code || ')',
      v_bottle.bottle_label,
      null::uuid,
      'qr_conference'
    );
  end if;

  update public.inventory_bottles set
    physical_ml = p_observed_ml,
    apc_unit_available = p_apc_available,
    status = case when p_observed_ml = 0 then 'empty' when status = 'empty' and p_observed_ml > 0 then 'active' else status end,
    updated_at = now()
  where id = v_bottle.id returning * into v_bottle;

  insert into public.inventory_bottle_conferences(
    organization_id, bottle_id, inventory_item_id, movement_id,
    ml_before, ml_after, apc_before, apc_after, conferred_by
  ) values (
    v_bottle.organization_id, v_bottle.id, v_bottle.inventory_item_id, v_movement.id,
    v_ml_before, p_observed_ml, v_apc_before, p_apc_available, auth.uid()
  ) returning * into v_conference;

  if v_delta = 0 then
    insert into public.audit_logs(organization_id, actor_id, action, entity_type, entity_id, metadata)
    values (
      v_bottle.organization_id, auth.uid(), 'inventory_bottle_conference_no_change', 'inventory_bottle', v_bottle.id::text,
      jsonb_build_object('bottle_code', v_bottle.bottle_code, 'ml', p_observed_ml, 'apc_unit_available', p_apc_available)
    );
  end if;

  return jsonb_build_object(
    'bottle_id', v_bottle.id, 'physical_ml', v_bottle.physical_ml, 'apc_unit_available', v_bottle.apc_unit_available,
    'status', v_bottle.status, 'updated_at', v_bottle.updated_at, 'delta', v_delta, 'conference_id', v_conference.id
  );
end;
$$;

-- ---------------------------------------------------------------------
-- perfume_set_cost → cost_margin.edit. Corpo idêntico ao vigente
-- (202608190006).
-- ---------------------------------------------------------------------
create or replace function public.perfume_set_cost(
  p_perfume_id uuid,
  p_cost_per_ml numeric
)
returns public.perfumes
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org uuid;
  v_row public.perfumes;
begin
  select organization_id into v_org from public.perfumes where id = p_perfume_id;

  if v_org is null or v_org not in (select public.current_user_org_ids()) then
    raise exception 'perfume_not_found';
  end if;

  if not public.has_org_permission(v_org, 'cost_margin.edit') then
    raise exception 'forbidden';
  end if;

  if p_cost_per_ml is not null and p_cost_per_ml < 0 then
    raise exception 'invalid_cost';
  end if;

  update public.perfumes set average_cost_per_ml = p_cost_per_ml where id = p_perfume_id returning * into v_row;

  insert into public.audit_logs(organization_id, actor_id, action, entity_type, entity_id, metadata)
  values (v_org, auth.uid(), 'perfume_cost_set', 'perfume', p_perfume_id::text, jsonb_build_object('cost_per_ml', p_cost_per_ml));

  return v_row;
end;
$$;

-- ---------------------------------------------------------------------
-- inventory_operational_rows / perfume_margin_summary → mascara custo
-- quando o caller não tem cost_margin.view (briefing: "Entregas sem
-- cost_margin.view não vê margem"). Mesmo RETURNS TABLE de antes — nunca
-- omite a coluna (isso quebraria todo consumidor existente), só devolve
-- NULL/false nela. security invoker preservado — chamar has_org_permission
-- (security definer) de dentro funciona normalmente.
-- ---------------------------------------------------------------------
create or replace function public.inventory_operational_rows(
  org_id uuid
)
returns table(
  item_id uuid,
  perfume_id uuid,
  perfume text,
  physical_ml numeric,
  reserved_ml numeric,
  shipping_ml numeric,
  available_ml numeric,
  minimum_ml numeric,
  reconciliation_status text,
  average_cost_per_ml numeric
)
language sql
stable
security invoker
set search_path = public
as $$
  select
    i.id as item_id,
    p.id as perfume_id,
    p.full_name_raw as perfume,
    i.physical_ml,
    coalesce(sum(a.quantity_ml) filter (where a.status = 'reserved'), 0) as reserved_ml,
    coalesce(sum(a.quantity_ml) filter (where a.status = 'shipping'), 0) as shipping_ml,
    case when i.bootstrap_pending_verification then 0 else i.available_ml end as available_ml,
    i.minimum_ml,
    i.reconciliation_status,
    case when public.has_org_permission(org_id, 'cost_margin.view') then p.average_cost_per_ml else null end as average_cost_per_ml
  from public.inventory_items i
  join public.perfumes p on p.id = i.perfume_id
  left join public.inventory_allocations a on a.inventory_item_id = i.id
  where i.organization_id = org_id and i.status = 'active'
  group by i.id, p.id, p.full_name_raw, p.average_cost_per_ml
  order by p.full_name_raw;
$$;

create or replace function public.perfume_margin_summary(
  org_id uuid,
  start_date date,
  end_date date
)
returns table(
  perfume_id uuid,
  perfume_name text,
  units_sold bigint,
  total_ml numeric,
  revenue numeric,
  average_cost_per_ml numeric,
  known_cost numeric,
  margin numeric,
  margin_pct numeric,
  has_cost boolean
)
language sql
stable
security invoker
set search_path = public
as $$
  with base as (
    select
      p.id as perfume_id,
      p.full_name_raw as perfume_name,
      p.average_cost_per_ml,
      count(s.id) as units_sold,
      coalesce(sum(s.volume_ml), 0) as total_ml,
      coalesce(sum(s.amount), 0) as revenue
    from public.sales s
    join public.perfumes p on p.id = s.perfume_id
    where s.organization_id = org_id
      and s.deleted_at is null
      and s.payment_status <> 'cancelled'
      and s.sale_date between start_date and end_date
    group by p.id, p.full_name_raw, p.average_cost_per_ml
  ),
  visible as (
    select public.has_org_permission(org_id, 'cost_margin.view') as can_view
  )
  select
    base.perfume_id,
    base.perfume_name,
    base.units_sold,
    base.total_ml,
    base.revenue,
    case when visible.can_view then base.average_cost_per_ml else null end as average_cost_per_ml,
    case when visible.can_view then base.average_cost_per_ml * base.total_ml else null end as known_cost,
    case when visible.can_view then base.revenue - (base.average_cost_per_ml * base.total_ml) else null end as margin,
    case
      when visible.can_view and base.revenue > 0 then
        round(((base.revenue - (base.average_cost_per_ml * base.total_ml)) / base.revenue) * 100, 1)
    end as margin_pct,
    visible.can_view and base.average_cost_per_ml is not null as has_cost
  from base, visible
  order by base.revenue desc;
$$;

commit;
