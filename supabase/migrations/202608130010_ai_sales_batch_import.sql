create table if not exists public.ai_sales_batches(
  id uuid primary key default gen_random_uuid(),organization_id uuid not null references public.organizations(id) on delete cascade,
  fingerprint text not null,source_text text not null,perfume_id uuid references public.perfumes(id),perfume_name text not null,
  bottle_number integer,sale_date date not null,sales_count integer not null,total_ml numeric(12,3) not null,total_amount numeric(14,2) not null,
  announced_balance_ml numeric(12,3),status text not null default 'confirmed',result jsonb not null default '{}'::jsonb,
  created_by uuid not null references public.profiles(id),created_at timestamptz not null default now(),unique(organization_id,fingerprint)
);
alter table public.ai_sales_batches enable row level security;
create policy ai_sales_batches_read on public.ai_sales_batches for select using(organization_id in(select public.current_user_org_ids()));
create policy ai_sales_batches_write on public.ai_sales_batches for all using(public.has_org_role(organization_id,array['admin','manager','operator']::public.member_role[])) with check(public.has_org_role(organization_id,array['admin','manager','operator']::public.member_role[]));

create or replace function public.confirm_ai_sales_batch(p_organization_id uuid,p_fingerprint text,p_source_text text,p_batch jsonb)
returns jsonb language plpgsql security definer set search_path=public as $$
declare existing public.ai_sales_batches; batch public.ai_sales_batches; item jsonb; client uuid; perfume uuid; created_clients int:=0; created_sales int:=0; incomplete int:=0; normalized text; signature text;
begin
  if not public.has_org_role(p_organization_id,array['admin','manager','operator']::public.member_role[]) then raise exception 'forbidden'; end if;
  select * into existing from public.ai_sales_batches where organization_id=p_organization_id and fingerprint=p_fingerprint;
  if existing.id is not null then return existing.result||jsonb_build_object('batch_id',existing.id,'idempotent',true); end if;
  perfume:=nullif(p_batch->>'perfume_id','')::uuid;
  if perfume is null then raise exception 'perfume_resolution_required'; end if;
  if coalesce(jsonb_array_length(p_batch->'sales'),0)=0 then raise exception 'sales_required'; end if;
  insert into public.ai_sales_batches(organization_id,fingerprint,source_text,perfume_id,perfume_name,bottle_number,sale_date,sales_count,total_ml,total_amount,announced_balance_ml,created_by)
  values(p_organization_id,p_fingerprint,p_source_text,perfume,p_batch->>'perfume',nullif(p_batch->>'bottle_number','')::int,(p_batch->>'sale_date')::date,jsonb_array_length(p_batch->'sales'),(p_batch->'totals'->>'volume_ml')::numeric,(p_batch->'totals'->>'amount')::numeric,nullif(p_batch->>'announced_balance_ml','')::numeric,auth.uid()) returning * into batch;
  for item in select * from jsonb_array_elements(p_batch->'sales') loop
    client:=nullif(item->>'client_id','')::uuid;
    if client is null then
      if coalesce(item->>'client_match_status','')<>'new' then raise exception 'client_resolution_required'; end if;
      normalized:=btrim(regexp_replace(lower(unaccent(item->>'client_name')),'[^a-z0-9]+',' ','g'));
      select id into client from public.clients where organization_id=p_organization_id and normalized_name=normalized and deleted_at is null limit 1;
      if client is null then insert into public.clients(organization_id,name,original_name,normalized_name,status,source,registration_origin,created_by) values(p_organization_id,item->>'client_name',item->>'client_name',normalized,'active','ai_sales_batch','ai_sales_batch',auth.uid()) returning id into client;created_clients:=created_clients+1; end if;
    end if;
    if not exists(select 1 from public.clients where id=client and organization_id=p_organization_id) then raise exception 'invalid_client'; end if;
    signature:=encode(digest(p_fingerprint||'|'||created_sales::text,'sha256'),'hex');
    insert into public.sales(organization_id,client_id,perfume_id,sale_date,amount,payment_status,payment_method,notes,source,import_signature,created_by,perfume_name_raw,perfume_base_name,sale_type,volume_ml,volume_ml_raw,shipping_deadline_raw,shipping_deadline_date,data_quality_status,inventory_allocation_eligible,operational_created_at)
    values(p_organization_id,client,perfume,(p_batch->>'sale_date')::date,(item->>'amount')::numeric,'pending',null,'Importado de lista comercial com confirmação humana.','ai_sales_batch',signature,auth.uid(),p_batch->>'perfume',p_batch->>'perfume',item->>'sale_type',(item->>'volume_ml')::numeric,item->>'volume_ml',p_batch->>'deadline_raw',nullif(p_batch->>'shipping_deadline_date','')::date,'verified',true,now());
    created_sales:=created_sales+1;if coalesce(jsonb_array_length(item->'missing_shipping_fields'),0)>0 then incomplete:=incomplete+1;end if;
  end loop;
  update public.ai_sales_batches set result=jsonb_build_object('batch_id',batch.id,'sales_created',created_sales,'clients_created',created_clients,'shipping_incomplete',incomplete,'idempotent',false) where id=batch.id returning * into batch;
  insert into public.audit_logs(organization_id,actor_id,action,entity_type,entity_id,metadata) values(p_organization_id,auth.uid(),'ai_sales_batch_confirmed','ai_sales_batch',batch.id,jsonb_build_object('fingerprint',left(p_fingerprint,12),'perfume_id',perfume,'sales_created',created_sales,'clients_created',created_clients));
  return batch.result;
end;$$;
revoke all on function public.confirm_ai_sales_batch(uuid,text,text,jsonb) from public,anon;
grant execute on function public.confirm_ai_sales_batch(uuid,text,text,jsonb) to authenticated,service_role;
