begin;

create or replace function public.davi_excel_update_sale(
  p_sale_id uuid,
  p_patch jsonb,
  p_expected_updated_at timestamptz,
  p_confirm_operational boolean default false
)
returns jsonb language plpgsql security definer set search_path=public as $$
declare
  before_row public.sales; after_row public.sales; key text;
  next_client public.clients; next_perfume public.perfumes;
  has_allocation boolean; has_preparation boolean; has_shipment boolean; has_posted boolean;
  protected_change boolean; changed text[]:=array[]::text[];
  allowed constant text[]:=array['client_id','sale_date','shipping_deadline_date','shipping_deadline_raw','shipped_at','sale_type','volume_ml','perfume_id','amount','payment_status','payment_method','paid_at','credit_reference_amount','notes'];
begin
  select * into before_row from public.sales
   where id=p_sale_id and organization_id in(select public.current_user_org_ids()) and deleted_at is null
   for update;
  if before_row.id is null then raise exception 'sale_not_found'; end if;
  if not public.has_org_permission(before_row.organization_id,'sales.edit') then raise exception 'forbidden'; end if;
  if before_row.updated_at is distinct from p_expected_updated_at then raise exception 'stale_sale'; end if;
  for key in select jsonb_object_keys(p_patch) loop
    if not(key=any(allowed)) then raise exception 'field_not_editable:%',key; end if;
    changed:=array_append(changed,key);
  end loop;

  if p_patch?'client_id' then
    select * into next_client from public.clients where id=(p_patch->>'client_id')::uuid and organization_id=before_row.organization_id and deleted_at is null;
    if next_client.id is null then raise exception 'invalid_client'; end if;
  end if;
  if p_patch?'perfume_id' then
    select * into next_perfume from public.perfumes where id=(p_patch->>'perfume_id')::uuid and organization_id=before_row.organization_id;
    if next_perfume.id is null then raise exception 'invalid_perfume'; end if;
  end if;

  select exists(select 1 from public.inventory_allocations a where a.sale_id=before_row.id),
    exists(select 1 from public.preparation_batch_items bi join public.inventory_allocations a on a.id=bi.allocation_id where a.sale_id=before_row.id),
    exists(select 1 from public.shipment_items si join public.shipments sh on sh.id=si.shipment_id where si.sale_id=before_row.id and si.removed_at is null and sh.status<>'cancelled'),
    exists(select 1 from public.shipment_items si join public.shipments sh on sh.id=si.shipment_id where si.sale_id=before_row.id and si.removed_at is null and sh.status in('posted','delivered'))
    into has_allocation,has_preparation,has_shipment,has_posted;
  protected_change:=p_patch ?| array['client_id','perfume_id','volume_ml'];
  if protected_change and (has_allocation or has_preparation or has_shipment) and not p_confirm_operational then
    raise exception 'operational_confirmation_required';
  end if;
  if p_patch?'shipped_at' and has_shipment then raise exception 'shipment_controls_shipping_date'; end if;

  update public.sales set
    client_id=case when p_patch?'client_id' then next_client.id else client_id end,
    client_name_raw=case when p_patch?'client_id' then next_client.name else client_name_raw end,
    sale_date=case when p_patch?'sale_date' then nullif(p_patch->>'sale_date','')::date else sale_date end,
    shipping_deadline_date=case when p_patch?'shipping_deadline_date' then nullif(p_patch->>'shipping_deadline_date','')::date else shipping_deadline_date end,
    shipping_deadline_raw=case when p_patch?'shipping_deadline_raw' then nullif(btrim(p_patch->>'shipping_deadline_raw'),'') else shipping_deadline_raw end,
    shipped_at=case when p_patch?'shipped_at' then nullif(p_patch->>'shipped_at','')::timestamptz else shipped_at end,
    sale_type=case when p_patch?'sale_type' then nullif(btrim(p_patch->>'sale_type'),'') else sale_type end,
    volume_ml=case when p_patch?'volume_ml' then (p_patch->>'volume_ml')::numeric else volume_ml end,
    volume_ml_raw=case when p_patch?'volume_ml' then p_patch->>'volume_ml' else volume_ml_raw end,
    perfume_id=case when p_patch?'perfume_id' then next_perfume.id else perfume_id end,
    perfume_name_raw=case when p_patch?'perfume_id' then next_perfume.full_name_raw else perfume_name_raw end,
    perfume_base_name=case when p_patch?'perfume_id' then next_perfume.base_name else perfume_base_name end,
    amount=case when p_patch?'amount' then (p_patch->>'amount')::numeric else amount end,
    payment_status=case when p_patch?'payment_status' then (p_patch->>'payment_status')::public.payment_status else payment_status end,
    payment_method=case when p_patch?'payment_method' then nullif(btrim(p_patch->>'payment_method'),'') else payment_method end,
    paid_at=case when p_patch?'paid_at' then nullif(p_patch->>'paid_at','')::date else paid_at end,
    credit_reference_amount=case when p_patch?'credit_reference_amount' then nullif(p_patch->>'credit_reference_amount','')::numeric else credit_reference_amount end,
    notes=case when p_patch?'notes' then nullif(btrim(p_patch->>'notes'),'') else notes end,
    updated_at=now()
   where id=before_row.id returning * into after_row;

  insert into public.audit_logs(organization_id,actor_id,action,entity_type,entity_id,metadata)
  values(before_row.organization_id,auth.uid(),'davi_excel_sale_updated','sale',before_row.id::text,
    jsonb_build_object('sale_id',before_row.id,'changed_fields',changed,'before',to_jsonb(before_row),'after',to_jsonb(after_row),
      'operational',jsonb_build_object('allocation',has_allocation,'preparation',has_preparation,'shipment',has_shipment,'posted',has_posted,'shipment_snapshot_preserved',true)));
  return jsonb_build_object('id',after_row.id,'updated_at',after_row.updated_at,'changed_fields',changed,'shipment_snapshot_preserved',true);
end;$$;

revoke all on function public.davi_excel_update_sale(uuid,jsonb,timestamptz,boolean) from public,anon;
grant execute on function public.davi_excel_update_sale(uuid,jsonb,timestamptz,boolean) to authenticated;

create function public.inventory_update_minimum(p_item_id uuid,p_minimum_ml numeric)
returns public.inventory_items language plpgsql security definer set search_path=public as $$
declare before_item public.inventory_items; after_item public.inventory_items;
begin
  if p_minimum_ml is null or p_minimum_ml<0 then raise exception 'invalid_minimum'; end if;
  select * into before_item from public.inventory_items where id=p_item_id and organization_id in(select public.current_user_org_ids()) for update;
  if before_item.id is null then raise exception 'inventory_item_not_found'; end if;
  if not public.has_org_permission(before_item.organization_id,'inventory.adjust') then raise exception 'forbidden'; end if;
  update public.inventory_items set minimum_ml=p_minimum_ml,updated_at=now() where id=before_item.id returning * into after_item;
  insert into public.audit_logs(organization_id,actor_id,action,entity_type,entity_id,metadata)
  values(before_item.organization_id,auth.uid(),'inventory_minimum_updated','inventory_item',before_item.id::text,jsonb_build_object('before',before_item.minimum_ml,'after',after_item.minimum_ml));
  return after_item;
end;$$;
revoke all on function public.inventory_update_minimum(uuid,numeric) from public,anon;
grant execute on function public.inventory_update_minimum(uuid,numeric) to authenticated;

create function public.davi_excel_sort_text(p_value text)
returns text language sql immutable parallel safe set search_path=public as $$
 select translate(lower(regexp_replace(btrim(coalesce(p_value,'')),'\s+',' ','g')),
 'áàãâäéèêëíìîïóòõôöúùûüç','aaaaaeeeeiiiiooooouuuuc');
$$;

create function public.davi_excel_list_multi(
 p_filters jsonb default '{}'::jsonb,p_page integer default 0,p_page_size integer default 100,
 p_sorts jsonb default '[{"column":"sale_date","direction":"asc"},{"column":"perfume","direction":"asc"},{"column":"type","direction":"asc"},{"column":"volume","direction":"desc"}]'::jsonb
) returns jsonb language plpgsql stable security definer set search_path=public as $$
declare level jsonb;column_name text;direction text;expression text;order_clause text:='';result jsonb;position integer:=0;
begin
 if jsonb_typeof(p_sorts)<>'array' then raise exception 'invalid_sort';end if;
 for level in select value from jsonb_array_elements(p_sorts) loop
  position:=position+1;if position>5 then exit;end if;
  column_name:=level->>'column';direction:=lower(level->>'direction');
  if direction not in('asc','desc') then raise exception 'invalid_sort_direction';end if;
  expression:=case column_name
   when 'client' then 'public.davi_excel_sort_text(client_name)'
   when 'sale_date' then 'sale_date'
   when 'deadline' then 'shipping_deadline_date'
   when 'shipped_at' then 'shipped_at'
   when 'type' then 'public.davi_excel_sort_text(sale_type)'
   when 'volume' then 'volume_ml'
   when 'perfume' then 'public.davi_excel_sort_text(perfume_name)'
   when 'amount' then 'amount'
   when 'payment' then 'public.davi_excel_sort_text(payment_status)'
   when 'method' then 'public.davi_excel_sort_text(payment_method)'
   when 'paid_at' then 'paid_at'
   when 'credit' then 'credit_reference_amount'
   when 'notes' then 'public.davi_excel_sort_text(notes)'
   else null end;
  if expression is null then raise exception 'invalid_sort_column';end if;
  order_clause:=order_clause||case when order_clause='' then '' else ',' end||expression||' '||direction||' nulls last';
 end loop;
 if order_clause='' then order_clause:='sale_date asc nulls last,public.davi_excel_sort_text(perfume_name) asc nulls last,public.davi_excel_sort_text(sale_type) asc nulls last,volume_ml desc nulls last';end if;
 execute format($query$
  with filtered as(
   select * from public.davi_excel_dataset() d where
   (coalesce($1->>'search','')='' or d.client_name ilike '%%'||($1->>'search')||'%%' or d.perfume_name ilike '%%'||($1->>'search')||'%%' or d.notes ilike '%%'||($1->>'search')||'%%' or d.search_reference ilike '%%'||($1->>'search')||'%%') and
   public.davi_excel_filter_matches($1#>'{columns,client}',d.client_name,null,null,'text') and
   public.davi_excel_filter_matches($1#>'{columns,sale_date}',d.sale_date::text,null,d.sale_date,'date') and
   public.davi_excel_filter_matches($1#>'{columns,deadline}',coalesce(d.shipping_deadline_display,d.operational_status),null,d.shipping_deadline_date,'date') and
   public.davi_excel_filter_matches($1#>'{columns,shipped_at}',d.shipped_at::date::text,null,d.shipped_at::date,'date') and
   public.davi_excel_filter_matches($1#>'{columns,type}',d.sale_type,null,null,'text') and
   public.davi_excel_filter_matches($1#>'{columns,volume}',d.volume_ml::text,d.volume_ml,null,'number') and
   public.davi_excel_filter_matches($1#>'{columns,perfume}',d.perfume_name,null,null,'text') and
   public.davi_excel_filter_matches($1#>'{columns,amount}',d.amount::text,d.amount,null,'number') and
   public.davi_excel_filter_matches($1#>'{columns,payment}',d.payment_status,null,null,'text') and
   public.davi_excel_filter_matches($1#>'{columns,method}',d.payment_method,null,null,'text') and
   public.davi_excel_filter_matches($1#>'{columns,paid_at}',d.paid_at::text,null,d.paid_at,'date') and
   public.davi_excel_filter_matches($1#>'{columns,credit}',d.credit_reference_amount::text,d.credit_reference_amount,null,'number') and
   public.davi_excel_filter_matches($1#>'{columns,notes}',d.notes,null,null,'text')
  ),counted as(select *,count(*)over() total_count from filtered),ordered as(
   select * from counted order by %s,id desc limit $2 offset $3
  ) select jsonb_build_object('rows',coalesce(jsonb_agg(to_jsonb(ordered)-'total_count'-'search_reference'-'shipping_deadline_date'),'[]'::jsonb),'total',coalesce(max(total_count),0)) from ordered
 $query$,order_clause) into result using coalesce(p_filters,'{}'::jsonb),least(greatest(p_page_size,1),500),greatest(p_page,0)*least(greatest(p_page_size,1),500);
 return result;
end;$$;
revoke all on function public.davi_excel_list_multi(jsonb,integer,integer,jsonb) from public,anon;
grant execute on function public.davi_excel_list_multi(jsonb,integer,integer,jsonb) to authenticated;

commit;
