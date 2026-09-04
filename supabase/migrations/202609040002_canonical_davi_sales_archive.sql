begin;

-- Arquivamento administrativo, fechado e reversível das 333 vendas que o
-- dry-run classificou como SAFE_TO_ARCHIVE por estarem ausentes do snapshot
-- canônico do Davi. O manifesto não fica aberto à escolha do chamador: seu
-- conteúdo completo é autenticado pelo SHA-256 fixo abaixo.
--
-- Fonte: d0356aca28a6a3fd9d7bff6705975b437b1b7e08d430d5d5dd85d246723c5082
-- Arquivo do manifesto: 4cf42afc970f513a808b523ea452ab2e694ee9c49572e2c279253254d6c690ff
-- Conteudo canonico: f5f23a81e5fb3465962117a3e6f29f90787bc0fb643862589a13771fd06abad3
-- Escopo: 333 vendas / R$ 75.793,00

-- Menor exceção possível no trigger canônico. O caminho normal abaixo desta
-- guarda é preservado sem mudança. O bypass só existe quando simultaneamente:
--   1. a sessão é service_role;
--   2. batch e manifesto são exatamente os aprovados;
--   3. a RPC indicou exatamente o sale_id que está sendo atualizado;
--   4. somente deleted_at/updated_at mudaram.
-- set_config(..., true) torna o contexto local à transação; rollback ou erro
-- também o elimina. Não há DISABLE TRIGGER nem alteração global de proteção.
create or replace function public.sync_sale_inventory_allocation()
returns trigger language plpgsql security definer set search_path=public as $$
declare v_item public.inventory_items; v_allocation public.inventory_allocations; v_delta numeric;
begin
  if tg_op='UPDATE'
     and auth.role()='service_role'
     and current_setting('ruah.canonical_davi_archive_batch',true)='663b08a9-bac4-4ba6-9bf8-333d0356aca2'
     and current_setting('ruah.canonical_davi_archive_manifest',true)='4cf42afc970f513a808b523ea452ab2e694ee9c49572e2c279253254d6c690ff'
     and current_setting('ruah.canonical_davi_archive_sale_id',true)=new.id::text
     and old.deleted_at is distinct from new.deleted_at
     and (to_jsonb(old)-'deleted_at'-'updated_at')=(to_jsonb(new)-'deleted_at'-'updated_at') then
    return new;
  end if;

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
end;
$$;

create or replace function public.apply_approved_canonical_davi_sales_archive(
  p_organization_id uuid,
  p_user_id uuid,
  p_batch_id uuid,
  p_source_hash text,
  p_manifest_hash text,
  p_rows jsonb
) returns jsonb language plpgsql security definer set search_path=public as $$
declare
  approved_organization constant uuid := '032fd96e-638f-428b-8cc2-37afc71e10ea';
  approved_batch constant uuid := '663b08a9-bac4-4ba6-9bf8-333d0356aca2';
  approved_source_hash constant text := 'd0356aca28a6a3fd9d7bff6705975b437b1b7e08d430d5d5dd85d246723c5082';
  approved_manifest_hash constant text := '4cf42afc970f513a808b523ea452ab2e694ee9c49572e2c279253254d6c690ff';
  approved_payload_hash constant text := 'f5f23a81e5fb3465962117a3e6f29f90787bc0fb643862589a13771fd06abad3';
  approved_reason constant text := 'absent_from_canonical_davi_snapshot';
  approved_count constant integer := 333;
  approved_amount constant numeric := 75793.00;
  computed_manifest_hash text;
  item jsonb;
  before_row public.sales;
  after_row public.sales;
  prior public.audit_logs;
  changed_ids uuid[]:=array[]::uuid[];
  affected_rows integer;
begin
  if auth.role() is distinct from 'service_role' then raise exception 'service_role_required'; end if;
  if p_organization_id is distinct from approved_organization then raise exception 'canonical_archive_tenant_not_approved'; end if;
  if not exists(select 1 from public.organization_members where organization_id=p_organization_id and user_id=p_user_id and role='admin') then
    raise exception 'administrator_membership_required';
  end if;
  if p_batch_id is distinct from approved_batch then raise exception 'canonical_archive_batch_not_approved'; end if;
  if p_source_hash is distinct from approved_source_hash then raise exception 'canonical_archive_source_hash_mismatch'; end if;
  if p_manifest_hash is distinct from approved_manifest_hash then raise exception 'canonical_archive_manifest_hash_mismatch'; end if;
  if jsonb_typeof(p_rows)<>'array' or jsonb_array_length(p_rows)<>approved_count then raise exception 'canonical_archive_manifest_count_mismatch'; end if;
  if exists(select 1 from jsonb_array_elements(p_rows) as manifest_row(value)
    where jsonb_typeof(manifest_row.value)<>'object'
       or (select count(*) from jsonb_object_keys(manifest_row.value) as manifest_key)<>10) then
    raise exception 'canonical_archive_manifest_shape_mismatch';
  end if;
  if (select count(distinct manifest_row.value->>'sale_id') from jsonb_array_elements(p_rows) as manifest_row(value))<>approved_count then
    raise exception 'canonical_archive_duplicate_sale';
  end if;
  if exists(select 1 from jsonb_array_elements(p_rows) as manifest_row(value)
    where manifest_row.value->>'organization_id'<>approved_organization::text
       or nullif(manifest_row.value->>'sale_id','') is null or nullif(manifest_row.value->>'client_id','') is null or nullif(manifest_row.value->>'perfume_id','') is null
       or nullif(manifest_row.value->>'sale_date','') is null or nullif(manifest_row.value->>'sale_type','') is null
       or nullif(manifest_row.value->>'volume_ml','') is null or nullif(manifest_row.value->>'amount','') is null or nullif(manifest_row.value->>'expected_updated_at','') is null
       or nullif(manifest_row.value->>'payment_status','') is null) then
    raise exception 'canonical_archive_manifest_required_value_missing';
  end if;

  select public.ai_sha256_hex(string_agg(concat_ws('|',
    manifest_row.value->>'sale_id',manifest_row.value->>'organization_id',manifest_row.value->>'expected_updated_at',manifest_row.value->>'amount',
    manifest_row.value->>'client_id',manifest_row.value->>'perfume_id',manifest_row.value->>'sale_date',manifest_row.value->>'sale_type',
    manifest_row.value->>'volume_ml',manifest_row.value->>'payment_status'),
    E'\n' order by manifest_row.value->>'sale_id')) into computed_manifest_hash
  from jsonb_array_elements(p_rows) as manifest_row(value);
  if computed_manifest_hash is distinct from approved_payload_hash then raise exception 'canonical_archive_manifest_payload_mismatch'; end if;
  if (select sum((manifest_row.value->>'amount')::numeric) from jsonb_array_elements(p_rows) as manifest_row(value)) is distinct from approved_amount then
    raise exception 'canonical_archive_manifest_amount_mismatch';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_batch_id::text,202609040002));
  select * into prior from public.audit_logs
   where organization_id=p_organization_id and action='canonical_davi_sales_archive_completed'
     and entity_type='canonical_davi_sales_archive_batch' and entity_id=p_batch_id::text
   order by id desc limit 1;
  if prior.id is not null then
    if prior.metadata->>'source_hash' is distinct from p_source_hash
       or prior.metadata->>'manifest_hash' is distinct from p_manifest_hash
       or (prior.metadata->>'row_count')::integer is distinct from approved_count then
      raise exception 'canonical_archive_idempotency_conflict';
    end if;
    return jsonb_build_object('batch_id',p_batch_id,'source_hash',p_source_hash,'manifest_hash',p_manifest_hash,
      'idempotent',true,'archived_sales',0,'sale_ids',prior.metadata->'sale_ids');
  end if;

  -- Trava e revalida o lote inteiro antes da primeira escrita. Toda exceção
  -- aborta a chamada e o PostgreSQL desfaz a transação completa.
  for item in select manifest_row.value from jsonb_array_elements(p_rows) as manifest_row(value) order by manifest_row.value->>'sale_id' loop
    select * into before_row from public.sales where id=(item->>'sale_id')::uuid for update;
    if before_row.id is null then raise exception 'canonical_archive_sale_not_found:%',item->>'sale_id'; end if;
    if before_row.organization_id is distinct from p_organization_id
       or before_row.organization_id is distinct from (item->>'organization_id')::uuid then
      raise exception 'canonical_archive_wrong_tenant:%',before_row.id;
    end if;
    if before_row.deleted_at is not null then raise exception 'canonical_archive_sale_already_archived:%',before_row.id; end if;
    if before_row.updated_at is distinct from (item->>'expected_updated_at')::timestamptz then raise exception 'canonical_archive_stale_sale:%',before_row.id; end if;
    if before_row.client_id is distinct from (item->>'client_id')::uuid
       or before_row.perfume_id is distinct from (item->>'perfume_id')::uuid
       or before_row.sale_date is distinct from (item->>'sale_date')::date
       or before_row.sale_type is distinct from item->>'sale_type'
       or before_row.volume_ml is distinct from (item->>'volume_ml')::numeric
       or before_row.amount is distinct from (item->>'amount')::numeric
       or before_row.payment_status::text is distinct from item->>'payment_status' then
      raise exception 'canonical_archive_commercial_identity_mismatch:%',before_row.id;
    end if;
    if exists(select 1 from public.inventory_allocations a
      where a.sale_id=before_row.id and a.organization_id=p_organization_id and a.status in('reserved','shipping','shipped')) then
      raise exception 'canonical_archive_active_allocation:%',before_row.id;
    end if;
    if exists(select 1 from public.preparation_batch_items bi
      join public.inventory_allocations a on a.id=bi.allocation_id
      join public.preparation_batches pb on pb.id=bi.batch_id
      where a.sale_id=before_row.id and pb.organization_id=p_organization_id and pb.status<>'cancelled') then
      raise exception 'canonical_archive_active_preparation:%',before_row.id;
    end if;
    if exists(select 1 from public.shipment_items si join public.shipments sh on sh.id=si.shipment_id
      where si.sale_id=before_row.id and si.organization_id=p_organization_id and si.removed_at is null and sh.status<>'cancelled')
       or before_row.shipped_at is not null
       or upper(btrim(coalesce(before_row.shipping_operational_status,''))) in
          ('ENVIADO','POSTADO','EM TRANSITO','EM TRÂNSITO','ENTREGUE','EM SEPARACAO','EM SEPARAÇÃO','EM PREPARACAO','EM PREPARAÇÃO') then
      raise exception 'canonical_archive_incompatible_shipment:%',before_row.id;
    end if;
    if exists(select 1 from public.customer_shipment_request_items ri
      join public.customer_shipment_requests r on r.id=ri.request_id
      join public.inventory_allocations a on a.id=ri.allocation_id
      where a.sale_id=before_row.id and r.organization_id=p_organization_id and r.status<>'cancelled') then
      raise exception 'canonical_archive_customer_shipment_request:%',before_row.id;
    end if;
    if exists(select 1 from public.inventory_movements m where m.sale_id=before_row.id and m.organization_id=p_organization_id) then
      raise exception 'canonical_archive_inventory_movement:%',before_row.id;
    end if;
  end loop;

  perform set_config('ruah.canonical_davi_archive_batch',approved_batch::text,true);
  perform set_config('ruah.canonical_davi_archive_manifest',approved_manifest_hash,true);
  for item in select manifest_row.value from jsonb_array_elements(p_rows) as manifest_row(value) order by manifest_row.value->>'sale_id' loop
    select * into before_row from public.sales where id=(item->>'sale_id')::uuid;
    perform set_config('ruah.canonical_davi_archive_sale_id',before_row.id::text,true);
    update public.sales set deleted_at=now(),updated_at=now()
     where id=before_row.id and organization_id=p_organization_id and deleted_at is null
       and updated_at=(item->>'expected_updated_at')::timestamptz
     returning * into after_row;
    get diagnostics affected_rows=row_count;
    if affected_rows<>1 then raise exception 'canonical_archive_concurrent_change:%',before_row.id; end if;
    perform set_config('ruah.canonical_davi_archive_sale_id','',true);
    changed_ids:=array_append(changed_ids,after_row.id);
    insert into public.audit_logs(organization_id,actor_id,action,entity_type,entity_id,metadata)
    values(p_organization_id,p_user_id,'canonical_davi_sale_archived','sale',after_row.id::text,
      jsonb_build_object('batch_id',p_batch_id,'source_hash',p_source_hash,'manifest_hash',p_manifest_hash,'payload_hash',approved_payload_hash,
        'reason',approved_reason,'before',to_jsonb(before_row),'after',to_jsonb(after_row),
        'archived_at',after_row.deleted_at,'responsible_user_id',p_user_id,'inventory_mutations',0));
  end loop;

  perform set_config('ruah.canonical_davi_archive_sale_id','',true);
  insert into public.audit_logs(organization_id,actor_id,action,entity_type,entity_id,metadata)
  values(p_organization_id,p_user_id,'canonical_davi_sales_archive_completed','canonical_davi_sales_archive_batch',p_batch_id::text,
    jsonb_build_object('batch_id',p_batch_id,'source_hash',p_source_hash,'manifest_hash',p_manifest_hash,'payload_hash',approved_payload_hash,
      'reason',approved_reason,'row_count',approved_count,'amount',approved_amount,'sale_ids',to_jsonb(changed_ids),
      'completed_at',now(),'responsible_user_id',p_user_id,'inventory_mutations',0,'hard_deletes',0));
  return jsonb_build_object('batch_id',p_batch_id,'source_hash',p_source_hash,'manifest_hash',p_manifest_hash,
    'idempotent',false,'archived_sales',cardinality(changed_ids),'sale_ids',to_jsonb(changed_ids));
end;
$$;

revoke all on function public.apply_approved_canonical_davi_sales_archive(uuid,uuid,uuid,text,text,jsonb) from public,anon,authenticated;
grant execute on function public.apply_approved_canonical_davi_sales_archive(uuid,uuid,uuid,text,text,jsonb) to service_role;

create or replace function public.rollback_approved_canonical_davi_sales_archive(
  p_organization_id uuid,
  p_user_id uuid,
  p_batch_id uuid,
  p_source_hash text,
  p_manifest_hash text
) returns jsonb language plpgsql security definer set search_path=public as $$
declare
  approved_organization constant uuid := '032fd96e-638f-428b-8cc2-37afc71e10ea';
  approved_batch constant uuid := '663b08a9-bac4-4ba6-9bf8-333d0356aca2';
  approved_source_hash constant text := 'd0356aca28a6a3fd9d7bff6705975b437b1b7e08d430d5d5dd85d246723c5082';
  approved_manifest_hash constant text := '4cf42afc970f513a808b523ea452ab2e694ee9c49572e2c279253254d6c690ff';
  approved_reason constant text := 'absent_from_canonical_davi_snapshot';
  completed public.audit_logs;
  rolled_back public.audit_logs;
  archive_log public.audit_logs;
  sale_row public.sales;
  restored public.sales;
  sale_id uuid;
  restored_ids uuid[]:=array[]::uuid[];
  affected_rows integer;
begin
  if auth.role() is distinct from 'service_role' then raise exception 'service_role_required'; end if;
  if p_organization_id is distinct from approved_organization then raise exception 'canonical_archive_rollback_tenant_not_approved'; end if;
  if not exists(select 1 from public.organization_members where organization_id=p_organization_id and user_id=p_user_id and role='admin') then
    raise exception 'administrator_membership_required';
  end if;
  if p_batch_id is distinct from approved_batch or p_source_hash is distinct from approved_source_hash
     or p_manifest_hash is distinct from approved_manifest_hash then raise exception 'canonical_archive_rollback_not_approved'; end if;

  perform pg_advisory_xact_lock(hashtextextended(p_batch_id::text,202609040002));
  select * into completed from public.audit_logs
   where organization_id=p_organization_id and action='canonical_davi_sales_archive_completed'
     and entity_type='canonical_davi_sales_archive_batch' and entity_id=p_batch_id::text
     and metadata->>'source_hash'=p_source_hash and metadata->>'manifest_hash'=p_manifest_hash
   order by id desc limit 1;
  if completed.id is null then raise exception 'canonical_archive_not_applied'; end if;
  if coalesce(jsonb_array_length(completed.metadata->'sale_ids'),0)<>333 then raise exception 'canonical_archive_rollback_batch_corrupt'; end if;
  select * into rolled_back from public.audit_logs
   where organization_id=p_organization_id and action='canonical_davi_sales_archive_rolled_back'
     and entity_type='canonical_davi_sales_archive_batch' and entity_id=p_batch_id::text
     and metadata->>'source_hash'=p_source_hash and metadata->>'manifest_hash'=p_manifest_hash
   order by id desc limit 1;
  if rolled_back.id is not null then
    return jsonb_build_object('batch_id',p_batch_id,'source_hash',p_source_hash,'manifest_hash',p_manifest_hash,
      'idempotent',true,'restored_sales',0,'sale_ids',rolled_back.metadata->'sale_ids');
  end if;

  -- Confere o estado completo gravado no after. Qualquer coluna alterada após
  -- o arquivamento impede o rollback do lote inteiro.
  for sale_id in select value::uuid from jsonb_array_elements_text(completed.metadata->'sale_ids') order by value loop
    select * into archive_log from public.audit_logs
     where organization_id=p_organization_id and action='canonical_davi_sale_archived' and entity_type='sale'
       and entity_id=sale_id::text and metadata->>'batch_id'=p_batch_id::text
       and metadata->>'source_hash'=p_source_hash and metadata->>'manifest_hash'=p_manifest_hash
     order by id desc limit 1;
    if archive_log.id is null then raise exception 'canonical_archive_rollback_audit_missing:%',sale_id; end if;
    select * into sale_row from public.sales where id=sale_id for update;
    if sale_row.id is null then raise exception 'canonical_archive_rollback_sale_missing:%',sale_id; end if;
    if sale_row.organization_id is distinct from p_organization_id then raise exception 'canonical_archive_rollback_wrong_tenant:%',sale_id; end if;
    if to_jsonb(sale_row) is distinct from archive_log.metadata->'after' then raise exception 'canonical_archive_rollback_sale_changed:%',sale_id; end if;
    if sale_row.deleted_at is null then raise exception 'canonical_archive_rollback_not_archived:%',sale_id; end if;
    if exists(select 1 from public.inventory_allocations a where a.sale_id=sale_id and a.status in('reserved','shipping','shipped'))
       or exists(select 1 from public.preparation_batch_items bi join public.inventory_allocations a on a.id=bi.allocation_id join public.preparation_batches pb on pb.id=bi.batch_id where a.sale_id=sale_id and pb.status<>'cancelled')
       or exists(select 1 from public.shipment_items si join public.shipments sh on sh.id=si.shipment_id where si.sale_id=sale_id and si.removed_at is null and sh.status<>'cancelled')
       or exists(select 1 from public.customer_shipment_request_items ri join public.customer_shipment_requests r on r.id=ri.request_id join public.inventory_allocations a on a.id=ri.allocation_id where a.sale_id=sale_id and r.status<>'cancelled')
       or exists(select 1 from public.inventory_movements m where m.sale_id=sale_id) then
      raise exception 'canonical_archive_rollback_operational_state_changed:%',sale_id;
    end if;
  end loop;

  perform set_config('ruah.canonical_davi_archive_batch',approved_batch::text,true);
  perform set_config('ruah.canonical_davi_archive_manifest',approved_manifest_hash,true);
  for sale_id in select value::uuid from jsonb_array_elements_text(completed.metadata->'sale_ids') order by value loop
    select * into archive_log from public.audit_logs
     where organization_id=p_organization_id and action='canonical_davi_sale_archived' and entity_type='sale'
       and entity_id=sale_id::text and metadata->>'batch_id'=p_batch_id::text
       and metadata->>'source_hash'=p_source_hash and metadata->>'manifest_hash'=p_manifest_hash
     order by id desc limit 1;
    select * into sale_row from public.sales where id=sale_id;
    perform set_config('ruah.canonical_davi_archive_sale_id',sale_id::text,true);
    update public.sales set
      deleted_at=nullif(archive_log.metadata#>>'{before,deleted_at}','')::timestamptz,
      updated_at=now()
     where id=sale_id and organization_id=p_organization_id
       and updated_at=(archive_log.metadata#>>'{after,updated_at}')::timestamptz
     returning * into restored;
    get diagnostics affected_rows=row_count;
    if affected_rows<>1 then raise exception 'canonical_archive_rollback_concurrent_change:%',sale_id; end if;
    perform set_config('ruah.canonical_davi_archive_sale_id','',true);
    restored_ids:=array_append(restored_ids,restored.id);
    insert into public.audit_logs(organization_id,actor_id,action,entity_type,entity_id,metadata)
    values(p_organization_id,p_user_id,'canonical_davi_sale_archive_rolled_back','sale',sale_id::text,
      jsonb_build_object('batch_id',p_batch_id,'source_hash',p_source_hash,'manifest_hash',p_manifest_hash,
        'reason',approved_reason,'before',to_jsonb(sale_row),'after',to_jsonb(restored),
        'rolled_back_at',now(),'responsible_user_id',p_user_id,'inventory_mutations',0));
  end loop;

  perform set_config('ruah.canonical_davi_archive_sale_id','',true);
  insert into public.audit_logs(organization_id,actor_id,action,entity_type,entity_id,metadata)
  values(p_organization_id,p_user_id,'canonical_davi_sales_archive_rolled_back','canonical_davi_sales_archive_batch',p_batch_id::text,
    jsonb_build_object('batch_id',p_batch_id,'source_hash',p_source_hash,'manifest_hash',p_manifest_hash,
      'reason',approved_reason,'restored_sales',cardinality(restored_ids),'sale_ids',to_jsonb(restored_ids),
      'rolled_back_at',now(),'responsible_user_id',p_user_id,'inventory_mutations',0));
  return jsonb_build_object('batch_id',p_batch_id,'source_hash',p_source_hash,'manifest_hash',p_manifest_hash,
    'idempotent',false,'restored_sales',cardinality(restored_ids),'sale_ids',to_jsonb(restored_ids));
end;
$$;

revoke all on function public.rollback_approved_canonical_davi_sales_archive(uuid,uuid,uuid,text,text) from public,anon,authenticated;
grant execute on function public.rollback_approved_canonical_davi_sales_archive(uuid,uuid,uuid,text,text) to service_role;

commit;
