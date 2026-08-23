begin;

-- A RPC continua sendo a fronteira canônica do Davi, com a mesma assinatura
-- e comportamento. A allocation é criada pelo trigger central da venda.
create or replace function public.davi_excel_create_sale(p_payload jsonb,p_idempotency_key text)
returns uuid language plpgsql security definer set search_path=public as $$
declare org uuid;uid uuid:=auth.uid();client public.clients;perfume public.perfumes;sale_id uuid;status public.payment_status;
begin
 if uid is null then raise exception 'authentication_required';end if;
 if nullif(btrim(p_idempotency_key),'') is null then raise exception 'idempotency_key_required';end if;
 select * into client from public.clients where id=(p_payload->>'client_id')::uuid and deleted_at is null and merged_into_id is null;
 if not found then raise exception 'invalid_client';end if;
 org:=client.organization_id;
 if not public.has_org_permission(org,'sales.edit') then raise exception 'permission_denied';end if;
 select * into perfume from public.perfumes where id=(p_payload->>'perfume_id')::uuid and organization_id=org;
 if not found then raise exception 'invalid_perfume';end if;
 status:=(p_payload->>'payment_status')::public.payment_status;
 if (p_payload->>'sale_type') not in('APC','SPLIT') then raise exception 'invalid_sale_type';end if;
 if (p_payload->>'volume_ml')::numeric<=0 then raise exception 'invalid_volume';end if;
 if (p_payload->>'amount')::numeric<0 then raise exception 'invalid_amount';end if;
 select id into sale_id from public.sales where organization_id=org and source='davi_excel' and import_signature=p_idempotency_key;
 if found then return sale_id;end if;
 insert into public.sales(organization_id,client_id,perfume_id,sale_date,amount,payment_status,payment_method,paid_at,notes,source,import_signature,created_by,perfume_name_raw,perfume_base_name,sale_type,volume_ml,volume_ml_raw,shipping_deadline_raw,shipping_deadline_date,shipping_operational_status,data_quality_status,inventory_allocation_eligible,operational_created_at)
 values(org,client.id,perfume.id,(p_payload->>'sale_date')::date,(p_payload->>'amount')::numeric,status,nullif(btrim(p_payload->>'payment_method'),''),case when status='paid' then nullif(p_payload->>'paid_at','')::date else null end,nullif(btrim(p_payload->>'notes'),''),'davi_excel',p_idempotency_key,uid,perfume.full_name_raw,perfume.base_name,p_payload->>'sale_type',(p_payload->>'volume_ml')::numeric,p_payload->>'volume_ml',nullif(btrim(p_payload->>'shipping_deadline_raw'),''),nullif(p_payload->>'shipping_deadline_date','')::date,case when nullif(p_payload->>'shipping_deadline_date','') is null then nullif(btrim(p_payload->>'shipping_deadline_raw'),'') else null end,'verified',true,now()) returning id into sale_id;
 return sale_id;
exception when unique_violation then
 select id into sale_id from public.sales where organization_id=org and source='davi_excel' and import_signature=p_idempotency_key;
 return sale_id;
end;$$;

revoke all on function public.davi_excel_create_sale(jsonb,text) from public,anon;
grant execute on function public.davi_excel_create_sale(jsonb,text) to authenticated;

-- Corrige a função efetivamente responsável pela reserva disparada pelo INSERT
-- da venda. O valor original nasce igual ao volume inicial e não usa default 0.
create or replace function public.sync_sale_inventory_allocation()
returns trigger language plpgsql security definer set search_path=public as $$
declare v_item public.inventory_items; v_allocation public.inventory_allocations; v_delta numeric;
begin
  if exists(select 1 from public.inventory_allocations where sale_id=new.id and allocation_source='legacy_manual_verified' and status in('reserved','shipping','shipped')) then
    return new;
  end if;
  select * into v_allocation from public.inventory_allocations
    where sale_id=new.id and allocation_source='operational_stock' and status in('reserved','shipping','shipped') for update;
  if new.deleted_at is not null or new.payment_status<>'paid' or not new.inventory_allocation_eligible or new.perfume_id is null
     or new.volume_ml is null or new.volume_ml<=0 then
    if v_allocation.id is not null and v_allocation.status='reserved' then
      select * into v_item from public.inventory_items where id=v_allocation.inventory_item_id for update;
      update public.inventory_items set available_ml=available_ml+v_allocation.quantity_ml,updated_at=now() where id=v_item.id;
      update public.inventory_allocations set status='released',released_at=now(),updated_at=now() where id=v_allocation.id;
    elsif v_allocation.id is not null and v_allocation.status in('shipping','shipped') then
      raise exception 'sale_has_active_shipment_allocation';
    end if;
    return new;
  end if;
  select * into v_item from public.inventory_items where organization_id=new.organization_id and perfume_id=new.perfume_id and status='active' for update;
  if not found or new.sale_date<v_item.reference_date then return new; end if;
  if v_allocation.id is null then
    if v_item.available_ml<new.volume_ml then raise exception 'insufficient_available_inventory'; end if;
    update public.inventory_items set available_ml=available_ml-new.volume_ml,updated_at=now() where id=v_item.id;
    insert into public.inventory_allocations(
      organization_id,inventory_item_id,client_id,sale_id,perfume_id,quantity_ml,original_quantity_ml,status,allocated_at,allocation_source,stock_managed,created_by
    ) values(
      new.organization_id,v_item.id,new.client_id,new.id,new.perfume_id,new.volume_ml,new.volume_ml,'reserved',now(),'operational_stock',true,auth.uid()
    );
  elsif v_allocation.status='reserved' then
    if v_allocation.inventory_item_id<>v_item.id then raise exception 'allocation_perfume_change_requires_release'; end if;
    v_delta:=new.volume_ml-v_allocation.quantity_ml;
    if v_delta>v_item.available_ml then raise exception 'insufficient_available_inventory'; end if;
    update public.inventory_items set available_ml=available_ml-v_delta,updated_at=now() where id=v_item.id;
    update public.inventory_allocations set client_id=new.client_id,quantity_ml=new.volume_ml,updated_at=now() where id=v_allocation.id;
  end if;
  return new;
end;$$;

commit;
