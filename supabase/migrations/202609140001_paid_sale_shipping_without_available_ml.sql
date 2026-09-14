begin;

-- O saldo disponível já é a sobra líquida calculada no nascimento do estoque
-- a partir do lote de vendas. Ao registrar o pagamento, não podemos exigir
-- novamente os ML vendidos. Quando não houver saldo gerenciado suficiente,
-- criamos uma alocação logística sem nova baixa: ela libera frete e envio,
-- preservando exatamente o saldo comercial derivado das vendas.
alter table public.inventory_allocations drop constraint if exists inventory_allocations_source_check;
alter table public.inventory_allocations drop constraint if exists inventory_allocations_stock_link_check;
alter table public.inventory_allocations add constraint inventory_allocations_source_check
  check(allocation_source in('operational_stock','legacy_manual_verified','sale_validated_shipping'));
alter table public.inventory_allocations add constraint inventory_allocations_stock_link_check
  check((stock_managed and inventory_item_id is not null and allocation_source='operational_stock')
    or (not stock_managed and inventory_item_id is null and allocation_source in('legacy_manual_verified','sale_validated_shipping')));

create or replace function public.sync_sale_inventory_allocation()
returns trigger language plpgsql security definer set search_path=public as $$
declare v_item public.inventory_items;v_allocation public.inventory_allocations;v_delta numeric;
begin
  -- Preserva o bypass fechado do arquivamento canônico já aplicado.
  if tg_op='UPDATE'
     and auth.role()='service_role'
     and current_setting('ruah.canonical_davi_archive_batch',true)='663b08a9-bac4-4ba6-9bf8-333d0356aca2'
     and current_setting('ruah.canonical_davi_archive_manifest',true)='4cf42afc970f513a808b523ea452ab2e694ee9c49572e2c279253254d6c690ff'
     and current_setting('ruah.canonical_davi_archive_sale_id',true)=new.id::text
     and old.deleted_at is distinct from new.deleted_at
     and (to_jsonb(old)-'deleted_at'-'updated_at')=(to_jsonb(new)-'deleted_at'-'updated_at') then
    return new;
  end if;

  select * into v_allocation from public.inventory_allocations
   where sale_id=new.id and status in('reserved','shipping','shipped') for update;

  if new.deleted_at is not null or new.payment_status<>'paid' or not new.inventory_allocation_eligible
     or new.perfume_id is null or new.volume_ml is null or new.volume_ml<=0 then
    if v_allocation.id is not null and v_allocation.status='reserved' then
      if v_allocation.stock_managed then
        select * into v_item from public.inventory_items where id=v_allocation.inventory_item_id for update;
        update public.inventory_items set available_ml=available_ml+v_allocation.quantity_ml,updated_at=now() where id=v_item.id;
      end if;
      update public.inventory_allocations set status='released',released_at=now(),updated_at=now() where id=v_allocation.id;
    elsif v_allocation.id is not null and v_allocation.status in('shipping','shipped') then
      raise exception 'sale_has_active_shipment_allocation';
    end if;
    return new;
  end if;

  if v_allocation.id is not null then
    if v_allocation.status='reserved' then
      if v_allocation.stock_managed then
        select * into v_item from public.inventory_items where id=v_allocation.inventory_item_id for update;
        if v_allocation.inventory_item_id<>v_item.id or new.perfume_id<>v_allocation.perfume_id then raise exception 'allocation_perfume_change_requires_release';end if;
        v_delta:=new.volume_ml-v_allocation.quantity_ml;
        if v_delta>v_item.available_ml then raise exception 'insufficient_available_inventory';end if;
        update public.inventory_items set available_ml=available_ml-v_delta,updated_at=now() where id=v_item.id;
      end if;
      update public.inventory_allocations set client_id=new.client_id,perfume_id=new.perfume_id,
        quantity_ml=new.volume_ml,original_quantity_ml=new.volume_ml,updated_at=now() where id=v_allocation.id;
    end if;
    return new;
  end if;

  select * into v_item from public.inventory_items
   where organization_id=new.organization_id and perfume_id=new.perfume_id and status='active' for update;
  if v_item.id is not null and new.sale_date>=v_item.reference_date and v_item.available_ml>=new.volume_ml then
    update public.inventory_items set available_ml=available_ml-new.volume_ml,updated_at=now() where id=v_item.id;
    insert into public.inventory_allocations(
      organization_id,inventory_item_id,client_id,sale_id,perfume_id,quantity_ml,original_quantity_ml,
      status,allocated_at,allocation_source,stock_managed,created_by
    ) values(new.organization_id,v_item.id,new.client_id,new.id,new.perfume_id,new.volume_ml,new.volume_ml,
      'reserved',now(),'operational_stock',true,auth.uid());
  else
    insert into public.inventory_allocations(
      organization_id,inventory_item_id,client_id,sale_id,perfume_id,quantity_ml,original_quantity_ml,
      status,allocated_at,allocation_source,stock_managed,verified_at,verified_by,verification_note,created_by
    ) values(new.organization_id,null,new.client_id,new.id,new.perfume_id,new.volume_ml,new.volume_ml,
      'reserved',now(),'sale_validated_shipping',false,now(),auth.uid(),
      'Venda validada para logística sem nova baixa: o estoque já contém a sobra líquida das vendas.',auth.uid());
    insert into public.audit_logs(organization_id,actor_id,action,entity_type,entity_id,metadata)
    values(new.organization_id,auth.uid(),'sale_shipping_released_without_available_ml','sale',new.id::text,
      jsonb_build_object('sale_id',new.id,'client_id',new.client_id,'perfume_id',new.perfume_id,
        'quantity_ml',new.volume_ml,'available_ml',coalesce(v_item.available_ml,0),'payment_status',new.payment_status));
  end if;
  return new;
end;$$;

notify pgrst,'reload schema';
commit;
