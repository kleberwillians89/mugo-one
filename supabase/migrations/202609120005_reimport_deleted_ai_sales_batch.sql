begin;

-- Permite reimportar um lote quando todas as vendas da tentativa anterior
-- foram apagadas. O lote anterior é arquivado por troca de fingerprint, sem
-- apagar histórico; qualquer venda ativa mantém a idempotência e o bloqueio.
create or replace function public.confirm_ai_sales_batch_with_availability(
  p_organization_id uuid,p_fingerprint text,p_source_text text,p_batch jsonb,p_availability jsonb
) returns jsonb language plpgsql security definer set search_path=public as $$
declare result jsonb;birth jsonb;idx integer;signature text;bottle text;remainder numeric;perfume uuid;
  prior public.ai_sales_batches;has_active_sale boolean:=false;
begin
  select * into prior from public.ai_sales_batches
  where organization_id=p_organization_id and fingerprint=p_fingerprint for update;
  if prior.id is not null then
    select exists(
      select 1 from generate_series(0,greatest(prior.sales_count-1,0)) n
      join public.sales s on s.organization_id=p_organization_id
        and s.source='ai_sales_batch' and s.deleted_at is null
        and s.import_signature=public.ai_sha256_hex(p_fingerprint||'|'||n::text)
    ) into has_active_sale;
    if not has_active_sale then
      update public.ai_sales_batches set
        fingerprint='archived-'||prior.id::text||'-'||prior.fingerprint
      where id=prior.id;
      insert into public.audit_logs(organization_id,actor_id,action,entity_type,entity_id,metadata)
      values(p_organization_id,auth.uid(),'deleted_ai_sales_batch_archived_for_reimport',
        'ai_sales_batch',prior.id::text,jsonb_build_object('original_fingerprint',prior.fingerprint));
    end if;
  end if;

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
    where organization_id=p_organization_id and import_signature=signature
      and source='ai_sales_batch' and deleted_at is null;
  end loop;
  return result||jsonb_build_object('inventory_remaining_ml',birth->'available_ml',
    'inventory_item_created',birth->'created');
end;
$$;
revoke all on function public.confirm_ai_sales_batch_with_availability(uuid,text,text,jsonb,jsonb) from public,anon;
grant execute on function public.confirm_ai_sales_batch_with_availability(uuid,text,text,jsonb,jsonb) to authenticated;

notify pgrst,'reload schema';
commit;
