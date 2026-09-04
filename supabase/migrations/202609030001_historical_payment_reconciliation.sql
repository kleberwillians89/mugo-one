begin;

-- Reconciliação financeira excepcional e fechada do lote aprovado em
-- 2026-09-03. A allowlist, o tenant, o payload e o hash são imutáveis:
-- esta RPC não é um caminho genérico para contornar a alocação de estoque.
--
-- O trigger canônico sync_sale_inventory_allocation NÃO é alterado. No mesmo
-- UPDATE, a venda histórica passa a inventory_allocation_eligible=false antes
-- de o trigger AFTER observar payment_status='paid'. Como a pré-validação
-- também proíbe qualquer alocação ativa, o trigger não cria, libera ou altera
-- estoque para estas duas vendas.
create function public.reconcile_approved_historical_payments(
  p_organization_id uuid,
  p_batch_id uuid,
  p_operation_hash text,
  p_rows jsonb
) returns jsonb language plpgsql security definer set search_path=public as $$
declare
  approved_organization constant uuid := '032fd96e-638f-428b-8cc2-37afc71e10ea';
  approved_batch constant uuid := '858edc62-067f-4124-8d95-206230d1268f';
  approved_hash constant text := '4fee55f810d6d66f13e5443cf79240fe0407202ddd54e15c48b619057a86ea66';
  approved_rows constant jsonb := '[
    {"sale_id":"f676eb8b-7233-412d-80a9-6db94925384c","expected_updated_at":"2026-09-03T21:51:12.712+00:00","payment_method":"CARTÃO DE CRÉDITO","paid_at":"2026-08-28","historical_status":"ENVIADO","historical_shipped_at":"2026-09-03"},
    {"sale_id":"98e9eb88-a071-46a8-a0b5-e10f904c9bfb","expected_updated_at":"2026-09-03T21:51:13.210+00:00","payment_method":"CARTÃO DE CRÉDITO","paid_at":"2026-08-28","historical_status":"ENVIADO","historical_shipped_at":"2026-09-03"}
  ]'::jsonb;
  item jsonb;
  before_row public.sales;
  after_row public.sales;
  prior public.audit_logs;
  changed_ids uuid[] := array[]::uuid[];
  affected_rows integer;
begin
  if auth.uid() is null then raise exception 'authentication_required'; end if;
  if p_organization_id is distinct from approved_organization then raise exception 'historical_reconciliation_tenant_not_approved'; end if;
  if not public.has_org_role(p_organization_id,array['admin']::public.member_role[]) then raise exception 'forbidden'; end if;
  if p_batch_id is distinct from approved_batch then raise exception 'historical_reconciliation_batch_not_approved'; end if;
  if p_operation_hash is distinct from approved_hash then raise exception 'historical_reconciliation_hash_mismatch'; end if;
  if p_rows is distinct from approved_rows then raise exception 'historical_reconciliation_payload_mismatch'; end if;

  perform pg_advisory_xact_lock(hashtextextended(p_batch_id::text,20260903));
  select * into prior from public.audit_logs
   where organization_id=p_organization_id
     and action='historical_payment_reconciliation_completed'
     and entity_type='historical_payment_batch'
     and entity_id=p_batch_id::text
   order by id desc limit 1;
  if prior.id is not null then
    if prior.metadata->>'operation_hash' is distinct from p_operation_hash
       or prior.metadata->'approved_rows' is distinct from p_rows then
      raise exception 'historical_reconciliation_idempotency_conflict';
    end if;
    return jsonb_build_object('batch_id',p_batch_id,'operation_hash',p_operation_hash,
      'idempotent',true,'updated_sales',0,'sale_ids',prior.metadata->'sale_ids');
  end if;

  -- Trava e valida o lote inteiro antes da primeira escrita. Uma exceção não
  -- é capturada: o PostgreSQL desfaz toda a chamada RPC atomicamente.
  for item in select value from jsonb_array_elements(p_rows) order by value->>'sale_id' loop
    select * into before_row from public.sales
     where id=(item->>'sale_id')::uuid and deleted_at is null for update;
    if before_row.id is null then raise exception 'historical_reconciliation_sale_not_found:%',item->>'sale_id'; end if;
    if before_row.organization_id is distinct from p_organization_id then raise exception 'historical_reconciliation_wrong_tenant:%',before_row.id; end if;
    if before_row.payment_status<>'pending' then raise exception 'historical_reconciliation_sale_not_pending:%',before_row.id; end if;
    if before_row.inventory_allocation_eligible is distinct from true then raise exception 'historical_reconciliation_incompatible_eligibility:%',before_row.id; end if;
    if before_row.updated_at is distinct from (item->>'expected_updated_at')::timestamptz then raise exception 'historical_reconciliation_stale_sale:%',before_row.id; end if;
    if before_row.payment_method is not null or before_row.paid_at is not null then raise exception 'historical_reconciliation_incompatible_financial_state:%',before_row.id; end if;
    if item->>'historical_status'<>'ENVIADO'
       or nullif(item->>'historical_shipped_at','')::date is null
       or before_row.shipped_at::date is distinct from (item->>'historical_shipped_at')::date then
      raise exception 'historical_reconciliation_evidence_not_approved:%',before_row.id;
    end if;
    if exists(select 1 from public.inventory_allocations a
      where a.sale_id=before_row.id and a.organization_id=p_organization_id
        and a.status in('reserved','shipping','shipped')) then
      raise exception 'historical_reconciliation_active_allocation:%',before_row.id;
    end if;
    if exists(select 1 from public.preparation_batch_items bi
      join public.inventory_allocations a on a.id=bi.allocation_id
      join public.preparation_batches pb on pb.id=bi.batch_id
      where a.sale_id=before_row.id and pb.organization_id=p_organization_id
        and pb.status<>'cancelled') then
      raise exception 'historical_reconciliation_active_preparation:%',before_row.id;
    end if;
    if exists(select 1 from public.shipment_items si
      join public.shipments sh on sh.id=si.shipment_id
      where si.sale_id=before_row.id and si.organization_id=p_organization_id
        and si.removed_at is null
        and sh.status not in('posted','delivered','cancelled')) then
      raise exception 'historical_reconciliation_active_shipment:%',before_row.id;
    end if;
  end loop;

  for item in select value from jsonb_array_elements(p_rows) order by value->>'sale_id' loop
    select * into before_row from public.sales where id=(item->>'sale_id')::uuid;
    update public.sales set
      inventory_allocation_eligible=false,
      payment_status='paid',
      payment_method=item->>'payment_method',
      paid_at=(item->>'paid_at')::date,
      updated_at=now()
     where id=before_row.id
       and organization_id=p_organization_id
       and payment_status='pending'
       and inventory_allocation_eligible=true
       and updated_at=(item->>'expected_updated_at')::timestamptz
     returning * into after_row;
    get diagnostics affected_rows = row_count;
    if affected_rows<>1 then raise exception 'historical_reconciliation_concurrent_change:%',before_row.id; end if;

    changed_ids:=array_append(changed_ids,after_row.id);
    insert into public.audit_logs(organization_id,actor_id,action,entity_type,entity_id,metadata)
    values(p_organization_id,auth.uid(),'historical_payment_reconciled','sale',after_row.id::text,
      jsonb_build_object(
        'batch_id',p_batch_id,'operation_hash',p_operation_hash,
        'origin','approved_davi_2026_09_03_dry_run',
        'reason','historical_sale_already_completed_without_current_inventory_allocation',
        'before',to_jsonb(before_row),'after',to_jsonb(after_row),
        'historical_evidence',jsonb_build_object('status',item->>'historical_status','shipped_at',item->>'historical_shipped_at')
      ));
  end loop;

  insert into public.audit_logs(organization_id,actor_id,action,entity_type,entity_id,metadata)
  values(p_organization_id,auth.uid(),'historical_payment_reconciliation_completed','historical_payment_batch',p_batch_id::text,
    jsonb_build_object('batch_id',p_batch_id,'operation_hash',p_operation_hash,
      'origin','approved_davi_2026_09_03_dry_run','reason','two_explicitly_approved_historical_sales',
      'approved_rows',p_rows,'sale_ids',to_jsonb(changed_ids),'updated_sales',cardinality(changed_ids),
      'inventory_allocation_eligible',false,'inventory_mutations',0));
  return jsonb_build_object('batch_id',p_batch_id,'operation_hash',p_operation_hash,
    'idempotent',false,'updated_sales',cardinality(changed_ids),'sale_ids',to_jsonb(changed_ids));
end;
$$;

revoke all on function public.reconcile_approved_historical_payments(uuid,uuid,text,jsonb) from public,anon;
grant execute on function public.reconcile_approved_historical_payments(uuid,uuid,text,jsonb) to authenticated;

-- Rollback administrativo do mesmo lote. Restaura exatamente o estado
-- financeiro/eligibilidade registrado no before da auditoria e recusa se
-- qualquer venda mudou ou ganhou operação logística depois da reconciliação.
create function public.rollback_approved_historical_payments(
  p_organization_id uuid,
  p_batch_id uuid,
  p_operation_hash text
) returns jsonb language plpgsql security definer set search_path=public as $$
declare
  approved_organization constant uuid := '032fd96e-638f-428b-8cc2-37afc71e10ea';
  approved_batch constant uuid := '858edc62-067f-4124-8d95-206230d1268f';
  approved_hash constant text := '4fee55f810d6d66f13e5443cf79240fe0407202ddd54e15c48b619057a86ea66';
  completed public.audit_logs;
  rolled_back public.audit_logs;
  reconciliation public.audit_logs;
  sale_row public.sales;
  restored public.sales;
  sale_id uuid;
  restored_ids uuid[] := array[]::uuid[];
begin
  if auth.uid() is null then raise exception 'authentication_required'; end if;
  if p_organization_id is distinct from approved_organization then raise exception 'historical_rollback_tenant_not_approved'; end if;
  if not public.has_org_role(p_organization_id,array['admin']::public.member_role[]) then raise exception 'forbidden'; end if;
  if p_batch_id is distinct from approved_batch or p_operation_hash is distinct from approved_hash then raise exception 'historical_rollback_not_approved'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_batch_id::text,20260903));

  select * into completed from public.audit_logs
   where organization_id=p_organization_id and action='historical_payment_reconciliation_completed'
     and entity_type='historical_payment_batch' and entity_id=p_batch_id::text
     and metadata->>'operation_hash'=p_operation_hash order by id desc limit 1;
  if completed.id is null then raise exception 'historical_reconciliation_not_applied'; end if;
  select * into rolled_back from public.audit_logs
   where organization_id=p_organization_id and action='historical_payment_reconciliation_rolled_back'
     and entity_type='historical_payment_batch' and entity_id=p_batch_id::text
     and metadata->>'operation_hash'=p_operation_hash order by id desc limit 1;
  if rolled_back.id is not null then
    return jsonb_build_object('batch_id',p_batch_id,'operation_hash',p_operation_hash,'idempotent',true,'restored_sales',0);
  end if;

  for sale_id in select approved.value::uuid from jsonb_array_elements_text(completed.metadata->'sale_ids') approved(value) order by approved.value loop
    select * into reconciliation from public.audit_logs
     where organization_id=p_organization_id and action='historical_payment_reconciled'
       and entity_type='sale' and entity_id=sale_id::text
       and metadata->>'batch_id'=p_batch_id::text and metadata->>'operation_hash'=p_operation_hash
     order by id desc limit 1;
    if reconciliation.id is null then raise exception 'historical_rollback_audit_missing:%',sale_id; end if;
    select * into sale_row from public.sales where id=sale_id for update;
    if sale_row.organization_id is distinct from p_organization_id then raise exception 'historical_rollback_wrong_tenant:%',sale_id; end if;
    if sale_row.updated_at is distinct from (reconciliation.metadata#>>'{after,updated_at}')::timestamptz
       or sale_row.payment_status<>'paid' or sale_row.inventory_allocation_eligible<>false
       or sale_row.payment_method is distinct from reconciliation.metadata#>>'{after,payment_method}'
       or sale_row.paid_at is distinct from (reconciliation.metadata#>>'{after,paid_at}')::date then
      raise exception 'historical_rollback_sale_changed:%',sale_id;
    end if;
    if exists(select 1 from public.inventory_allocations a where a.sale_id=sale_id and a.status in('reserved','shipping','shipped'))
       or exists(select 1 from public.preparation_batch_items bi join public.inventory_allocations a on a.id=bi.allocation_id join public.preparation_batches pb on pb.id=bi.batch_id where a.sale_id=sale_id and pb.status<>'cancelled')
       or exists(select 1 from public.shipment_items si join public.shipments sh on sh.id=si.shipment_id where si.sale_id=sale_id and si.removed_at is null and sh.status not in('posted','delivered','cancelled')) then
      raise exception 'historical_rollback_operational_state_changed:%',sale_id;
    end if;
  end loop;

  for sale_id in select approved.value::uuid from jsonb_array_elements_text(completed.metadata->'sale_ids') approved(value) order by approved.value loop
    select * into reconciliation from public.audit_logs
     where organization_id=p_organization_id and action='historical_payment_reconciled'
       and entity_type='sale' and entity_id=sale_id::text
       and metadata->>'batch_id'=p_batch_id::text and metadata->>'operation_hash'=p_operation_hash
     order by id desc limit 1;
    select * into sale_row from public.sales where id=sale_id;
    update public.sales set
      inventory_allocation_eligible=(reconciliation.metadata#>>'{before,inventory_allocation_eligible}')::boolean,
      payment_status=(reconciliation.metadata#>>'{before,payment_status}')::public.payment_status,
      payment_method=reconciliation.metadata#>>'{before,payment_method}',
      paid_at=nullif(reconciliation.metadata#>>'{before,paid_at}','')::date,
      updated_at=now()
     where id=sale_id returning * into restored;
    restored_ids:=array_append(restored_ids,restored.id);
    insert into public.audit_logs(organization_id,actor_id,action,entity_type,entity_id,metadata)
    values(p_organization_id,auth.uid(),'historical_payment_reconciliation_sale_rolled_back','sale',sale_id::text,
      jsonb_build_object('batch_id',p_batch_id,'operation_hash',p_operation_hash,'before',to_jsonb(sale_row),'after',to_jsonb(restored)));
  end loop;
  insert into public.audit_logs(organization_id,actor_id,action,entity_type,entity_id,metadata)
  values(p_organization_id,auth.uid(),'historical_payment_reconciliation_rolled_back','historical_payment_batch',p_batch_id::text,
    jsonb_build_object('batch_id',p_batch_id,'operation_hash',p_operation_hash,'restored_sales',cardinality(restored_ids),'sale_ids',to_jsonb(restored_ids)));
  return jsonb_build_object('batch_id',p_batch_id,'operation_hash',p_operation_hash,'idempotent',false,'restored_sales',cardinality(restored_ids),'sale_ids',to_jsonb(restored_ids));
end;
$$;

revoke all on function public.rollback_approved_historical_payments(uuid,uuid,text) from public,anon;
grant execute on function public.rollback_approved_historical_payments(uuid,uuid,text) to authenticated;

commit;
