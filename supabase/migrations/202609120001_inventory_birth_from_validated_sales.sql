begin;

-- O estoque comercial nasce da venda validada. A venda individual cria o
-- item (mesmo quando não há sobra); a confirmação do lote credita somente a
-- sobra explicitamente apurada pelo importador. Nunca presumimos capacidade
-- fixa de frasco.
create table public.sale_inventory_births (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  source_key text not null,
  perfume_id uuid not null references public.perfumes(id),
  inventory_item_id uuid not null references public.inventory_items(id),
  bottle_identifier text,
  available_ml numeric(14,3) not null check (available_ml >= 0),
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  unique (organization_id, source_key)
);

alter table public.sale_inventory_births enable row level security;
create policy sale_inventory_births_read on public.sale_inventory_births for select
  using (organization_id in (select public.current_user_org_ids()));
revoke insert,update,delete on public.sale_inventory_births from authenticated;

create function public.ensure_validated_sale_inventory_item()
returns trigger language plpgsql security definer set search_path=public as $$
declare item_id uuid;
begin
  if new.deleted_at is not null or new.payment_status in ('unknown','cancelled')
     or new.data_quality_status is distinct from 'verified'
     or not coalesce(new.inventory_allocation_eligible,false)
     or new.sale_date is null or new.perfume_id is null
     or new.volume_ml is null or new.volume_ml <= 0 then
    return new;
  end if;

  insert into public.inventory_items(
    organization_id,perfume_id,reference_date,available_ml,physical_ml,
    minimum_ml,status,notes,reconciliation_status,bootstrap_pending_verification,created_by
  ) values (
    new.organization_id,new.perfume_id,new.sale_date,0,0,
    0,'active','Criado automaticamente por venda validada.','reconciled',false,new.created_by
  ) on conflict (organization_id,perfume_id) do nothing
  returning id into item_id;

  if item_id is null then
    select id into item_id from public.inventory_items
     where organization_id=new.organization_id and perfume_id=new.perfume_id;
  end if;

  update public.sales set inventory_item_id=item_id where id=new.id
    and inventory_item_id is distinct from item_id;
  return new;
end;
$$;

drop trigger if exists validated_sale_inventory_birth on public.sales;
create trigger validated_sale_inventory_birth
after insert or update of perfume_id,volume_ml,payment_status,data_quality_status,
  inventory_allocation_eligible,deleted_at
on public.sales for each row execute function public.ensure_validated_sale_inventory_item();

create function public.register_validated_sale_remainder(
  p_organization_id uuid,p_source_key text,p_perfume_id uuid,p_reference_date date,
  p_available_ml numeric,p_bottle_identifier text default null
) returns jsonb language plpgsql security definer set search_path=public as $$
declare item public.inventory_items; prior public.sale_inventory_births; created boolean:=false;
begin
  if not public.has_org_permission(p_organization_id,'sales.edit') then raise exception 'forbidden'; end if;
  if nullif(btrim(p_source_key),'') is null or p_reference_date is null
     or p_available_ml is null or p_available_ml < 0 then raise exception 'invalid_sale_inventory_remainder'; end if;
  if not exists(select 1 from public.perfumes where id=p_perfume_id and organization_id=p_organization_id)
    then raise exception 'perfume_not_found'; end if;

  perform pg_advisory_xact_lock(hashtextextended(p_organization_id::text||'|'||p_source_key,120001));
  select * into prior from public.sale_inventory_births
   where organization_id=p_organization_id and source_key=p_source_key;
  if prior.id is not null then
    if prior.perfume_id<>p_perfume_id or prior.available_ml<>p_available_ml
      then raise exception 'sale_inventory_source_reused_with_different_payload'; end if;
    select * into item from public.inventory_items where id=prior.inventory_item_id;
    return jsonb_build_object('inventory_item_id',item.id,'perfume_id',item.perfume_id,
      'created',false,'idempotent',true,'remainder_ml',prior.available_ml,'available_ml',item.available_ml);
  end if;

  select * into item from public.inventory_items
   where organization_id=p_organization_id and perfume_id=p_perfume_id for update;
  if item.id is null then
    insert into public.inventory_items(
      organization_id,perfume_id,reference_date,available_ml,physical_ml,
      minimum_ml,status,notes,reconciliation_status,bootstrap_pending_verification,created_by
    ) values (
      p_organization_id,p_perfume_id,p_reference_date,0,0,
      0,'active','Criado automaticamente por venda validada.','reconciled',false,auth.uid()
    ) returning * into item;
    created:=true;
  elsif item.status<>'active' then
    update public.inventory_items set status='active',updated_at=now()
     where id=item.id returning * into item;
  end if;

  if p_available_ml>0 then
    perform public.inventory_apply(item.id,p_available_ml,'opening',
      'Sobra disponível de venda validada',
      'Origem: confirmação comercial · '||coalesce(p_bottle_identifier,'sem frasco informado'),
      null,'validated_sale_remainder');
    select * into item from public.inventory_items where id=item.id;
  end if;

  insert into public.sale_inventory_births(
    organization_id,source_key,perfume_id,inventory_item_id,bottle_identifier,available_ml,created_by
  ) values (
    p_organization_id,p_source_key,p_perfume_id,item.id,p_bottle_identifier,p_available_ml,auth.uid()
  );
  insert into public.audit_logs(organization_id,actor_id,action,entity_type,entity_id,metadata)
  values(p_organization_id,auth.uid(),'inventory_born_from_validated_sale','inventory_item',item.id::text,
    jsonb_build_object('source_key',p_source_key,'perfume_id',p_perfume_id,
      'bottle_identifier',p_bottle_identifier,'available_ml',p_available_ml));
  return jsonb_build_object('inventory_item_id',item.id,'perfume_id',item.perfume_id,
    'created',created,'idempotent',false,'remainder_ml',p_available_ml,'available_ml',item.available_ml);
end;
$$;
revoke all on function public.register_validated_sale_remainder(uuid,text,uuid,date,numeric,text) from public,anon,authenticated;

-- Estes wrappers são o ponto de validação humana da importação. O núcleo cria
-- as vendas; em seguida, na mesma transação, cada perfume nasce no estoque e
-- recebe apenas os ml que sobraram.
create or replace function public.confirm_ai_sales_batch_with_availability(
  p_organization_id uuid,p_fingerprint text,p_source_text text,p_batch jsonb,p_availability jsonb
) returns jsonb language plpgsql security definer set search_path=public as $$
declare result jsonb; birth jsonb; idx integer; signature text; bottle text; remainder numeric; perfume uuid;
begin
  result:=public.confirm_ai_sales_batch(p_organization_id,p_fingerprint,p_source_text,p_batch);
  perfume:=nullif(p_batch->>'perfume_id','')::uuid;
  bottle:=case when nullif(p_batch->>'bottle_number','') is null then null else 'FRASCO '||(p_batch->>'bottle_number')::integer end;
  remainder:=coalesce(nullif(p_batch->>'remaining_available_ml','')::numeric,
    nullif(p_batch->>'announced_balance_ml','')::numeric,
    nullif(p_batch->'totals'->>'calculated_balance_ml','')::numeric,0);
  birth:=public.register_validated_sale_remainder(p_organization_id,
    p_fingerprint||'|'||perfume::text||'|'||coalesce(bottle,''),perfume,
    (p_batch->>'sale_date')::date,remainder,bottle);
  for idx in 0..greatest(coalesce(jsonb_array_length(p_batch->'sales'),0)-1,0) loop
    signature:=public.ai_sha256_hex(p_fingerprint||'|'||idx::text);
    update public.sales set inventory_item_id=(birth->>'inventory_item_id')::uuid,
      bottle_identifier=bottle,shipping_availability_text=nullif(p_availability->>'text',''),
      shipping_availability_kind=coalesce(nullif(p_availability->>'kind',''),'unknown'),
      shipping_available_date=nullif(p_availability->>'date','')::date,
      shipping_lead_business_days=nullif(p_availability->>'lead_business_days','')::integer,
      shipping_availability_review_required=coalesce((p_availability->>'review_required')::boolean,false)
    where organization_id=p_organization_id and import_signature=signature and source='ai_sales_batch';
  end loop;
  return result||jsonb_build_object('inventory_remaining_ml',birth->'available_ml',
    'inventory_item_created',birth->'created');
end;
$$;
revoke all on function public.confirm_ai_sales_batch_with_availability(uuid,text,text,jsonb,jsonb) from public,anon;
grant execute on function public.confirm_ai_sales_batch_with_availability(uuid,text,text,jsonb,jsonb) to authenticated;

create or replace function public.confirm_ai_sales_batch_multi_with_availability(
  p_organization_id uuid,p_fingerprint text,p_source_text text,p_sale_date date,
  p_shipping_deadline_date date,p_deadline_raw text,p_groups jsonb,p_availability jsonb
) returns jsonb language plpgsql security definer set search_path=public as $$
declare result jsonb;birth jsonb;group_item jsonb;sale_item jsonb;signature text;perfume_name text;
  bottle text;perfume uuid;created_count integer:=0;remainder_total numeric:=0;balances jsonb:='[]'::jsonb;
begin
  result:=public.confirm_ai_sales_batch_multi(p_organization_id,p_fingerprint,p_source_text,
    p_sale_date,p_shipping_deadline_date,p_deadline_raw,p_groups);
  for group_item in select * from jsonb_array_elements(p_groups) loop
    perfume:=nullif(group_item->>'perfume_id','')::uuid;
    perfume_name:=coalesce(nullif(btrim(group_item->>'display_name'),''),group_item->>'perfume');
    bottle:=case when nullif(group_item->>'bottle_number','') is null then null else 'FRASCO '||(group_item->>'bottle_number')::integer end;
    birth:=public.register_validated_sale_remainder(p_organization_id,
      p_fingerprint||'|'||perfume::text||'|'||coalesce(bottle,''),perfume,p_sale_date,
      coalesce((group_item->>'availability_ml')::numeric,0),bottle);
    created_count:=created_count+case when coalesce((birth->>'created')::boolean,false) then 1 else 0 end;
    remainder_total:=remainder_total+coalesce((birth->>'remainder_ml')::numeric,0);
    balances:=balances||jsonb_build_array(birth);
    for sale_item in select * from jsonb_array_elements(group_item->'sales') loop
      signature:=public.ai_sha256_hex(btrim(regexp_replace(lower(unaccent(sale_item->>'client_name')),'[^a-z0-9]+',' ','g'))||'|'||p_sale_date::text||'|'||public.normalize_ai_perfume_name(perfume_name)||'|'||coalesce(group_item->>'bottle_number','')||'|'||coalesce(sale_item->>'sale_type','')||'|'||coalesce(sale_item->>'volume_ml','')||'|'||coalesce(sale_item->>'amount',''));
      update public.sales set inventory_item_id=(birth->>'inventory_item_id')::uuid,
        bottle_identifier=bottle,shipping_availability_text=nullif(p_availability->>'text',''),
        shipping_availability_kind=coalesce(nullif(p_availability->>'kind',''),'unknown'),
        shipping_available_date=nullif(p_availability->>'date','')::date,
        shipping_lead_business_days=nullif(p_availability->>'lead_business_days','')::integer,
        shipping_availability_review_required=coalesce((p_availability->>'review_required')::boolean,false)
      where organization_id=p_organization_id and import_signature=signature and source='ai_sales_batch';
    end loop;
  end loop;
  return result||jsonb_build_object('inventory_items_bootstrapped',created_count,
    'inventory_remaining_ml',remainder_total,'inventory_balances',balances);
end;
$$;
revoke all on function public.confirm_ai_sales_batch_multi_with_availability(uuid,text,text,date,date,text,jsonb,jsonb) from public,anon;
grant execute on function public.confirm_ai_sales_batch_multi_with_availability(uuid,text,text,date,date,text,jsonb,jsonb) to authenticated;

notify pgrst,'reload schema';
commit;
