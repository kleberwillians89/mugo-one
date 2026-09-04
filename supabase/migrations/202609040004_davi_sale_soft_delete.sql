begin;

create or replace function public.soft_delete_davi_sale(
  p_sale_id uuid,
  p_expected_updated_at timestamptz,
  p_reason text,
  p_note text default null
) returns jsonb language plpgsql security definer set search_path=public as $$
declare
  before_sale public.sales;
  after_sale public.sales;
  active_allocation public.inventory_allocations;
  attachment_count integer;
  preparation_count integer;
  shipment_count integer;
  posted_shipment_count integer;
  changed integer;
  allowed_reasons constant text[]:=array[
    'duplicate_sale',
    'incorrect_entry',
    'customer_cancelled',
    'import_error',
    'other'
  ];
begin
  if auth.uid() is null then raise exception 'authentication_required'; end if;
  if coalesce(btrim(p_reason),'')='' or not(p_reason=any(allowed_reasons)) then
    raise exception 'invalid_delete_reason';
  end if;

  select * into before_sale
    from public.sales
   where id=p_sale_id
   for update;
  if before_sale.id is null then raise exception 'sale_not_found'; end if;
  if before_sale.organization_id not in(select public.current_user_org_ids())
     or not public.has_org_permission(before_sale.organization_id,'sales.edit') then
    raise exception 'permission_denied';
  end if;
  if before_sale.deleted_at is not null then
    return jsonb_build_object('id',before_sale.id,'idempotent',true,'deleted_at',before_sale.deleted_at);
  end if;
  if before_sale.updated_at is distinct from p_expected_updated_at then
    raise exception 'stale_sale';
  end if;

  select count(*) into shipment_count
    from public.shipment_items si
    join public.shipments sh on sh.id=si.shipment_id
   where si.sale_id=before_sale.id and si.organization_id=before_sale.organization_id
     and si.removed_at is null and sh.status<>'cancelled';
  select count(*) into posted_shipment_count
    from public.shipment_items si
    join public.shipments sh on sh.id=si.shipment_id
   where si.sale_id=before_sale.id and si.organization_id=before_sale.organization_id
     and si.removed_at is null and sh.status in('posted','delivered');
  select count(*) into preparation_count
    from public.preparation_batch_items bi
    join public.inventory_allocations a on a.id=bi.allocation_id
    join public.preparation_batches pb on pb.id=bi.batch_id
   where a.sale_id=before_sale.id and pb.organization_id=before_sale.organization_id
     and pb.status<>'cancelled';
  if shipment_count>0 or preparation_count>0 then
    raise exception 'sale_has_operational_dependency:%',jsonb_build_object(
      'shipments',shipment_count,'posted_shipments',posted_shipment_count,'preparations',preparation_count)::text;
  end if;

  select * into active_allocation
    from public.inventory_allocations
   where sale_id=before_sale.id and organization_id=before_sale.organization_id
     and status in('reserved','shipping','shipped')
   for update;
  if active_allocation.id is not null and active_allocation.status in('shipping','shipped') then
    raise exception 'sale_has_active_shipment_allocation';
  end if;
  if active_allocation.id is not null and active_allocation.allocation_source='legacy_manual_verified' then
    raise exception 'sale_has_manual_verified_allocation';
  end if;

  select count(*) into attachment_count
    from public.sale_payment_attachments
   where sale_id=before_sale.id and organization_id=before_sale.organization_id and deleted_at is null;

  update public.sales
     set deleted_at=now(),updated_at=now()
   where id=before_sale.id and organization_id=before_sale.organization_id
     and deleted_at is null and updated_at=p_expected_updated_at
   returning * into after_sale;
  get diagnostics changed=row_count;
  if changed<>1 then raise exception 'stale_sale'; end if;

  insert into public.audit_logs(organization_id,actor_id,action,entity_type,entity_id,metadata)
  values(before_sale.organization_id,auth.uid(),'davi_sale_soft_deleted','sale',before_sale.id::text,
    jsonb_build_object(
      'sale_id',before_sale.id,
      'reason',p_reason,
      'note',nullif(btrim(p_note),''),
      'before',to_jsonb(before_sale),
      'after',to_jsonb(after_sale),
      'dependencies',jsonb_build_object('attachments',attachment_count,'preparations',preparation_count,'shipments',shipment_count),
      'user_id',auth.uid(),
      'timestamp',now()
    ));

  return jsonb_build_object('id',after_sale.id,'idempotent',false,'deleted_at',after_sale.deleted_at,'released_allocation',active_allocation.id is not null);
end;$$;

revoke all on function public.soft_delete_davi_sale(uuid,timestamptz,text,text) from public,anon;
grant execute on function public.soft_delete_davi_sale(uuid,timestamptz,text,text) to authenticated;

commit;
