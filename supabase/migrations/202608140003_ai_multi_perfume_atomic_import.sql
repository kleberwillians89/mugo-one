begin;

-- Multiperfume TSV imports get a dedicated idempotency anchor, separate from
-- ai_sales_batches (the single-perfume path), so the already-approved
-- single-perfume write is never touched by this closure.
create table if not exists public.ai_sales_batch_imports(
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  fingerprint text not null,
  source_text text not null,
  sale_date date not null,
  groups_count integer not null,
  sales_count integer not null default 0,
  total_ml numeric(14,3) not null default 0,
  total_amount numeric(14,2) not null default 0,
  availability_ml numeric(14,3) not null default 0,
  availability_amount numeric(14,2) not null default 0,
  result jsonb not null default '{}'::jsonb,
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  unique(organization_id,fingerprint)
);
alter table public.ai_sales_batch_imports enable row level security;
create policy ai_sales_batch_imports_read on public.ai_sales_batch_imports for select
  using(organization_id in(select public.current_user_org_ids()));
create policy ai_sales_batch_imports_write on public.ai_sales_batch_imports for all
  using(public.has_org_role(organization_id,array['admin','manager','operator']::public.member_role[]))
  with check(public.has_org_role(organization_id,array['admin','manager','operator']::public.member_role[]));

-- Atomic multiperfume confirmation. A single PL/pgSQL function body is one
-- implicit transaction: any raise anywhere aborts and rolls back every
-- insert made so far in this call, including earlier groups already
-- processed in the loop. "All valid groups or none" falls directly out of
-- that guarantee, so no manual savepoints are needed.
--
-- Every group must already carry a resolved inventory_item_id (matched
-- in-stock item, or an item created earlier via the existing, already
-- transactional/idempotent bootstrap_ai_batch_inventory RPC). This function
-- does not duplicate bootstrap logic; it validates resolution via the same
-- validate_ai_batch_inventory used by the single-perfume path and refuses to
-- write anything if any group is unresolved.
create or replace function public.confirm_ai_sales_batch_multi(
  p_organization_id uuid,p_fingerprint text,p_source_text text,p_sale_date date,
  p_shipping_deadline_date date,p_deadline_raw text,p_groups jsonb
) returns jsonb language plpgsql security definer set search_path=public as $$
declare
  existing public.ai_sales_batch_imports;
  batch public.ai_sales_batch_imports;
  group_item jsonb; sale_item jsonb;
  group_inventory_item_id uuid; group_perfume_id uuid; group_perfume_name text;
  group_bootstrap_pending boolean;
  client uuid; normalized text; client_match_count int; signature text; payment_bucket text;
  sales_created int:=0; clients_created int:=0; clients_existing int:=0; incomplete int:=0;
  perfumes_processed int:=0; perfumes_matched int:=0; inventory_items_bootstrapped int:=0;
  total_ml numeric:=0; total_amount numeric:=0; availability_ml numeric:=0; availability_amount numeric:=0;
  paid_source_count int:=0; awaiting_source_count int:=0; unstated_payment_count int:=0;
begin
  if not public.has_org_role(p_organization_id,array['admin','manager','operator']::public.member_role[]) then raise exception 'forbidden'; end if;
  select * into existing from public.ai_sales_batch_imports where organization_id=p_organization_id and fingerprint=p_fingerprint;
  if existing.id is not null then return existing.result||jsonb_build_object('batch_id',existing.id,'idempotent',true); end if;
  if jsonb_typeof(p_groups)<>'array' or jsonb_array_length(p_groups)=0 then raise exception 'groups_required'; end if;

  -- Readiness pass: refuse to start the write if any group or sale is unresolved.
  for group_item in select * from jsonb_array_elements(p_groups) loop
    if nullif(btrim(group_item->>'inventory_item_id'),'') is null then raise exception 'inventory_resolution_required'; end if;
    if coalesce(jsonb_array_length(group_item->'sales'),0)=0 then raise exception 'sales_required'; end if;
    for sale_item in select * from jsonb_array_elements(group_item->'sales') loop
      if nullif(sale_item->>'client_id','') is null and coalesce(sale_item->>'client_match_status','')<>'new' then raise exception 'client_resolution_required'; end if;
    end loop;
  end loop;

  insert into public.ai_sales_batch_imports(organization_id,fingerprint,source_text,sale_date,groups_count,created_by)
  values(p_organization_id,p_fingerprint,p_source_text,p_sale_date,jsonb_array_length(p_groups),auth.uid())
  returning * into batch;

  for group_item in select * from jsonb_array_elements(p_groups) loop
    group_inventory_item_id:=(group_item->>'inventory_item_id')::uuid;
    group_perfume_id:=public.validate_ai_batch_inventory(p_organization_id,group_inventory_item_id);
    select bootstrap_pending_verification into group_bootstrap_pending from public.inventory_items where id=group_inventory_item_id;
    if coalesce(group_bootstrap_pending,false) then inventory_items_bootstrapped:=inventory_items_bootstrapped+1; else perfumes_matched:=perfumes_matched+1; end if;
    perfumes_processed:=perfumes_processed+1;
    availability_ml:=availability_ml+coalesce((group_item->>'availability_ml')::numeric,0);
    availability_amount:=availability_amount+coalesce((group_item->>'availability_amount')::numeric,0);
    group_perfume_name:=coalesce(nullif(btrim(group_item->>'display_name'),''),group_item->>'perfume');

    for sale_item in select * from jsonb_array_elements(group_item->'sales') loop
      client:=nullif(sale_item->>'client_id','')::uuid;
      if client is null then
        normalized:=btrim(regexp_replace(lower(unaccent(sale_item->>'client_name')),'[^a-z0-9]+',' ','g'));
        select count(*) into client_match_count from public.clients where organization_id=p_organization_id and normalized_name=normalized and deleted_at is null;
        if client_match_count>1 then raise exception 'client_resolution_ambiguous'; end if;
        if client_match_count=1 then
          select id into client from public.clients where organization_id=p_organization_id and normalized_name=normalized and deleted_at is null;
          clients_existing:=clients_existing+1;
        else
          insert into public.clients(organization_id,name,original_name,normalized_name,status,source,registration_origin,created_by)
          values(p_organization_id,sale_item->>'client_name',sale_item->>'client_name',normalized,'active','ai_sales_batch','ai_sales_batch',auth.uid()) returning id into client;
          clients_created:=clients_created+1;
        end if;
      else
        clients_existing:=clients_existing+1;
      end if;
      if not exists(select 1 from public.clients where id=client and organization_id=p_organization_id and deleted_at is null) then raise exception 'invalid_client'; end if;

      signature:=encode(digest(
        btrim(regexp_replace(lower(unaccent(sale_item->>'client_name')),'[^a-z0-9]+',' ','g'))||'|'||p_sale_date::text||'|'||
        public.normalize_ai_perfume_name(group_perfume_name)||'|'||coalesce(sale_item->>'sale_type','')||'|'||
        coalesce(sale_item->>'volume_ml','')||'|'||coalesce(sale_item->>'amount',''),'sha256'),'hex');

      insert into public.sales(organization_id,client_id,perfume_id,inventory_item_id,sale_date,amount,payment_status,payment_method,notes,source,import_signature,created_by,perfume_name_raw,perfume_base_name,sale_type,volume_ml,volume_ml_raw,shipping_deadline_raw,shipping_deadline_date,data_quality_status,inventory_allocation_eligible,operational_created_at)
      values(p_organization_id,client,group_perfume_id,group_inventory_item_id,p_sale_date,(sale_item->>'amount')::numeric,'pending',null,'Importado de lista comercial com confirmação humana.','ai_sales_batch',signature,auth.uid(),group_perfume_name,group_perfume_name,sale_item->>'sale_type',(sale_item->>'volume_ml')::numeric,sale_item->>'volume_ml',p_deadline_raw,p_shipping_deadline_date,'verified',true,now());

      sales_created:=sales_created+1;
      total_ml:=total_ml+(sale_item->>'volume_ml')::numeric;
      total_amount:=total_amount+(sale_item->>'amount')::numeric;
      if coalesce(jsonb_array_length(sale_item->'missing_shipping_fields'),0)>0 then incomplete:=incomplete+1; end if;

      payment_bucket:=btrim(regexp_replace(lower(unaccent(coalesce(sale_item->>'payment_status_raw',''))),'[^a-z0-9]+',' ','g'));
      if payment_bucket in('pago','paga','quitado') then paid_source_count:=paid_source_count+1;
      elsif payment_bucket like '%aguard%' or payment_bucket like '%pendente%' or payment_bucket like '%nao pago%' then awaiting_source_count:=awaiting_source_count+1;
      else unstated_payment_count:=unstated_payment_count+1; end if;
    end loop;
  end loop;

  update public.ai_sales_batch_imports set
    sales_count=sales_created,total_ml=total_ml,total_amount=round(total_amount,2),
    availability_ml=availability_ml,availability_amount=round(availability_amount,2),
    result=jsonb_build_object(
      'batch_id',id,'sales_created',sales_created,'clients_created',clients_created,'clients_existing',clients_existing,
      'perfumes_processed',perfumes_processed,'perfumes_matched',perfumes_matched,'inventory_items_bootstrapped',inventory_items_bootstrapped,
      'total_ml_sold',total_ml,'total_amount_sold',round(total_amount,2),
      'commercial_remaining_ml',availability_ml,'commercial_remaining_amount',round(availability_amount,2),
      'shipping_incomplete',incomplete,'paid_source_count',paid_source_count,'awaiting_source_count',awaiting_source_count,
      'unstated_payment_count',unstated_payment_count,'idempotent',false
    )
    where id=batch.id returning * into batch;

  insert into public.audit_logs(organization_id,actor_id,action,entity_type,entity_id,metadata)
  values(p_organization_id,auth.uid(),'ai_sales_batch_multi_confirmed','ai_sales_batch_import',batch.id::text,
    jsonb_build_object('fingerprint',left(p_fingerprint,12),'groups',perfumes_processed,'sales_created',sales_created,'clients_created',clients_created,'inventory_items_bootstrapped',inventory_items_bootstrapped));

  return batch.result;
end;$$;
revoke all on function public.confirm_ai_sales_batch_multi(uuid,text,text,date,date,text,jsonb) from public,anon;
grant execute on function public.confirm_ai_sales_batch_multi(uuid,text,text,date,date,text,jsonb) to authenticated,service_role;

commit;
