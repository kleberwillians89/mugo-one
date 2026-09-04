begin;

-- Reconciliação geral, explícita e auditável da planilha do Davi. O payload
-- contém apenas vendas ligadas de forma determinística pelo dry-run. A RPC
-- nunca cria venda, cliente, perfume, reserva, movimento ou envio.
create function public.apply_general_sales_reconciliation(
  p_organization_id uuid,
  p_user_id uuid,
  p_batch_id uuid,
  p_source_file text,
  p_source_hash text,
  p_operation_hash text,
  p_rows jsonb
) returns jsonb language plpgsql security definer set search_path=public as $$
declare
  item jsonb;
  before_row public.sales;
  after_row public.sales;
  prior public.audit_logs;
  changed_ids uuid[]:=array[]::uuid[];
  affected_rows integer;
begin
  if auth.role()<>'service_role' then raise exception 'service_role_required'; end if;
  if not exists(select 1 from public.organization_members where organization_id=p_organization_id and user_id=p_user_id and role='admin') then
    raise exception 'administrator_membership_required';
  end if;
  if p_batch_id is null or p_source_file is null or btrim(p_source_file)='' then raise exception 'reconciliation_identity_required'; end if;
  if p_source_hash !~ '^[0-9a-f]{64}$' or p_operation_hash !~ '^[0-9a-f]{64}$' then raise exception 'invalid_reconciliation_hash'; end if;
  if jsonb_typeof(p_rows)<>'array' or jsonb_array_length(p_rows)=0 then raise exception 'rows_must_be_non_empty_array'; end if;
  if (select count(*) from jsonb_array_elements(p_rows))<>(select count(distinct value->>'sale_id') from jsonb_array_elements(p_rows)) then
    raise exception 'duplicate_sale_in_reconciliation';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_batch_id::text,20260904));
  select * into prior from public.audit_logs
   where organization_id=p_organization_id
     and action='general_sales_reconciliation_completed'
     and entity_type='sales_reconciliation_batch'
     and entity_id=p_batch_id::text
   order by id desc limit 1;
  if prior.id is not null then
    if prior.metadata->>'operation_hash' is distinct from p_operation_hash
       or prior.metadata->>'source_hash' is distinct from p_source_hash
       or (prior.metadata->>'row_count')::integer is distinct from jsonb_array_length(p_rows) then
      raise exception 'general_reconciliation_idempotency_conflict';
    end if;
    return jsonb_build_object('batch_id',p_batch_id,'operation_hash',p_operation_hash,'idempotent',true,'updated_sales',0,'sale_ids',prior.metadata->'sale_ids');
  end if;

  -- O lote inteiro é travado e validado antes da primeira escrita. Qualquer
  -- erro aborta a chamada e o PostgreSQL desfaz a transação completa.
  for item in select value from jsonb_array_elements(p_rows) order by value->>'sale_id' loop
    if item->>'match_method'<>'exact_commercial_multiset'
       or coalesce((item->>'source_row')::integer,0)<2
       or item->>'source_payment_status'<>'paid'
       or item->>'target_payment_status'<>'paid'
       or coalesce(btrim(item->>'target_payment_method'),'')=''
       or nullif(item->>'target_paid_at','')::date is null
       or (item->>'target_inventory_allocation_eligible')::boolean is distinct from false
       or item->>'target_shipping_operational_status'<>'ENVIADO' then
      raise exception 'general_reconciliation_unapproved_row:%',coalesce(item->>'sale_id','missing');
    end if;
    select * into before_row from public.sales
     where id=(item->>'sale_id')::uuid and deleted_at is null for update;
    if before_row.id is null then raise exception 'general_reconciliation_sale_not_found:%',item->>'sale_id'; end if;
    if before_row.organization_id is distinct from p_organization_id then raise exception 'general_reconciliation_wrong_tenant:%',before_row.id; end if;
    if before_row.payment_status<>'pending' or item->>'expected_payment_status'<>'pending' then raise exception 'general_reconciliation_sale_not_pending:%',before_row.id; end if;
    if before_row.inventory_allocation_eligible is distinct from true or (item->>'expected_inventory_allocation_eligible')::boolean is distinct from true then
      raise exception 'general_reconciliation_incompatible_eligibility:%',before_row.id;
    end if;
    if before_row.updated_at is distinct from (item->>'expected_updated_at')::timestamptz then raise exception 'general_reconciliation_stale_sale:%',before_row.id; end if;
    if before_row.payment_method is distinct from nullif(item->>'expected_payment_method','')
       or before_row.paid_at is distinct from nullif(item->>'expected_paid_at','')::date
       or before_row.shipping_operational_status is distinct from nullif(item->>'expected_shipping_operational_status','') then
      raise exception 'general_reconciliation_state_mismatch:%',before_row.id;
    end if;
    if before_row.client_id is null or before_row.perfume_id is null or before_row.sale_date is null or before_row.volume_ml is null or before_row.amount is null then
      raise exception 'general_reconciliation_incomplete_sale:%',before_row.id;
    end if;
    if exists(select 1 from public.inventory_allocations a
      where a.sale_id=before_row.id and a.organization_id=p_organization_id and a.status in('reserved','shipping','shipped')) then
      raise exception 'general_reconciliation_active_allocation:%',before_row.id;
    end if;
    if exists(select 1 from public.preparation_batch_items bi
      join public.inventory_allocations a on a.id=bi.allocation_id
      join public.preparation_batches pb on pb.id=bi.batch_id
      where a.sale_id=before_row.id and pb.organization_id=p_organization_id and pb.status<>'cancelled') then
      raise exception 'general_reconciliation_active_preparation:%',before_row.id;
    end if;
    if exists(select 1 from public.shipment_items si
      join public.shipments sh on sh.id=si.shipment_id
      where si.sale_id=before_row.id and si.organization_id=p_organization_id and si.removed_at is null
        and sh.status not in('posted','delivered','cancelled')) then
      raise exception 'general_reconciliation_active_shipment:%',before_row.id;
    end if;
  end loop;

  for item in select value from jsonb_array_elements(p_rows) order by value->>'sale_id' loop
    select * into before_row from public.sales where id=(item->>'sale_id')::uuid;
    update public.sales set
      inventory_allocation_eligible=false,
      payment_status='paid',
      payment_method=item->>'target_payment_method',
      paid_at=(item->>'target_paid_at')::date,
      shipping_operational_status='ENVIADO',
      updated_at=now()
     where id=before_row.id
       and organization_id=p_organization_id
       and payment_status='pending'
       and inventory_allocation_eligible=true
       and updated_at=(item->>'expected_updated_at')::timestamptz
     returning * into after_row;
    get diagnostics affected_rows=row_count;
    if affected_rows<>1 then raise exception 'general_reconciliation_concurrent_change:%',before_row.id; end if;
    changed_ids:=array_append(changed_ids,after_row.id);
    insert into public.audit_logs(organization_id,actor_id,action,entity_type,entity_id,metadata)
    values(p_organization_id,p_user_id,'general_sale_reconciled','sale',after_row.id::text,
      jsonb_build_object(
        'batch_id',p_batch_id,'operation_hash',p_operation_hash,'source_file',p_source_file,'source_hash',p_source_hash,
        'source_row',(item->>'source_row')::integer,'source_signature',item->>'source_signature','match_method',item->>'match_method',
        'origin','davi_august_2026_reconciliation','reason','spreadsheet_paid_and_business_completed_without_current_inventory_allocation',
        'before',to_jsonb(before_row),'after',to_jsonb(after_row),'inventory_mutations',0,'shipment_metadata_preserved',true
      ));
  end loop;

  insert into public.audit_logs(organization_id,actor_id,action,entity_type,entity_id,metadata)
  values(p_organization_id,p_user_id,'general_sales_reconciliation_completed','sales_reconciliation_batch',p_batch_id::text,
    jsonb_build_object(
      'batch_id',p_batch_id,'operation_hash',p_operation_hash,'source_file',p_source_file,'source_hash',p_source_hash,
      'row_count',jsonb_array_length(p_rows),'sale_ids',to_jsonb(changed_ids),'updated_sales',cardinality(changed_ids),
      'inventory_mutations',0,'shipments_created',0,'shipment_metadata_preserved',true
    ));
  return jsonb_build_object('batch_id',p_batch_id,'operation_hash',p_operation_hash,'idempotent',false,'updated_sales',cardinality(changed_ids),'sale_ids',to_jsonb(changed_ids));
end;
$$;
revoke all on function public.apply_general_sales_reconciliation(uuid,uuid,uuid,text,text,text,jsonb) from public,anon,authenticated;
grant execute on function public.apply_general_sales_reconciliation(uuid,uuid,uuid,text,text,text,jsonb) to service_role;

create function public.rollback_general_sales_reconciliation(
  p_organization_id uuid,p_user_id uuid,p_batch_id uuid,p_operation_hash text
) returns jsonb language plpgsql security definer set search_path=public as $$
declare
  completed public.audit_logs;
  rolled_back public.audit_logs;
  reconciliation public.audit_logs;
  sale_row public.sales;
  restored public.sales;
  sale_id uuid;
  restored_ids uuid[]:=array[]::uuid[];
begin
  if auth.role()<>'service_role' then raise exception 'service_role_required'; end if;
  if not exists(select 1 from public.organization_members where organization_id=p_organization_id and user_id=p_user_id and role='admin') then raise exception 'administrator_membership_required'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_batch_id::text,20260904));
  select * into completed from public.audit_logs
   where organization_id=p_organization_id and action='general_sales_reconciliation_completed'
     and entity_type='sales_reconciliation_batch' and entity_id=p_batch_id::text
     and metadata->>'operation_hash'=p_operation_hash order by id desc limit 1;
  if completed.id is null then raise exception 'general_reconciliation_not_applied'; end if;
  select * into rolled_back from public.audit_logs
   where organization_id=p_organization_id and action='general_sales_reconciliation_rolled_back'
     and entity_type='sales_reconciliation_batch' and entity_id=p_batch_id::text
     and metadata->>'operation_hash'=p_operation_hash order by id desc limit 1;
  if rolled_back.id is not null then return jsonb_build_object('batch_id',p_batch_id,'operation_hash',p_operation_hash,'idempotent',true,'restored_sales',0); end if;

  for sale_id in select value::uuid from jsonb_array_elements_text(completed.metadata->'sale_ids') order by value loop
    select * into reconciliation from public.audit_logs
     where organization_id=p_organization_id and action='general_sale_reconciled' and entity_type='sale' and entity_id=sale_id::text
       and metadata->>'batch_id'=p_batch_id::text and metadata->>'operation_hash'=p_operation_hash order by id desc limit 1;
    if reconciliation.id is null then raise exception 'general_rollback_audit_missing:%',sale_id; end if;
    select * into sale_row from public.sales where id=sale_id for update;
    if sale_row.organization_id is distinct from p_organization_id then raise exception 'general_rollback_wrong_tenant:%',sale_id; end if;
    if sale_row.updated_at is distinct from (reconciliation.metadata#>>'{after,updated_at}')::timestamptz
       or sale_row.payment_status is distinct from (reconciliation.metadata#>>'{after,payment_status}')::public.payment_status
       or sale_row.inventory_allocation_eligible is distinct from (reconciliation.metadata#>>'{after,inventory_allocation_eligible}')::boolean
       or sale_row.payment_method is distinct from reconciliation.metadata#>>'{after,payment_method}'
       or sale_row.paid_at is distinct from nullif(reconciliation.metadata#>>'{after,paid_at}','')::date
       or sale_row.shipping_operational_status is distinct from reconciliation.metadata#>>'{after,shipping_operational_status}' then
      raise exception 'general_rollback_sale_changed:%',sale_id;
    end if;
    if exists(select 1 from public.inventory_allocations a where a.sale_id=sale_id and a.status in('reserved','shipping','shipped')) then
      raise exception 'general_rollback_operational_state_changed:%',sale_id;
    end if;
  end loop;

  for sale_id in select value::uuid from jsonb_array_elements_text(completed.metadata->'sale_ids') order by value loop
    select * into reconciliation from public.audit_logs
     where organization_id=p_organization_id and action='general_sale_reconciled' and entity_type='sale' and entity_id=sale_id::text
       and metadata->>'batch_id'=p_batch_id::text and metadata->>'operation_hash'=p_operation_hash order by id desc limit 1;
    select * into sale_row from public.sales where id=sale_id;
    update public.sales set
      inventory_allocation_eligible=(reconciliation.metadata#>>'{before,inventory_allocation_eligible}')::boolean,
      payment_status=(reconciliation.metadata#>>'{before,payment_status}')::public.payment_status,
      payment_method=reconciliation.metadata#>>'{before,payment_method}',
      paid_at=nullif(reconciliation.metadata#>>'{before,paid_at}','')::date,
      shipping_operational_status=reconciliation.metadata#>>'{before,shipping_operational_status}',
      updated_at=now()
     where id=sale_id returning * into restored;
    restored_ids:=array_append(restored_ids,restored.id);
    insert into public.audit_logs(organization_id,actor_id,action,entity_type,entity_id,metadata)
    values(p_organization_id,p_user_id,'general_sale_reconciliation_rolled_back','sale',sale_id::text,
      jsonb_build_object('batch_id',p_batch_id,'operation_hash',p_operation_hash,'before',to_jsonb(sale_row),'after',to_jsonb(restored)));
  end loop;
  insert into public.audit_logs(organization_id,actor_id,action,entity_type,entity_id,metadata)
  values(p_organization_id,p_user_id,'general_sales_reconciliation_rolled_back','sales_reconciliation_batch',p_batch_id::text,
    jsonb_build_object('batch_id',p_batch_id,'operation_hash',p_operation_hash,'restored_sales',cardinality(restored_ids),'sale_ids',to_jsonb(restored_ids)));
  return jsonb_build_object('batch_id',p_batch_id,'operation_hash',p_operation_hash,'idempotent',false,'restored_sales',cardinality(restored_ids),'sale_ids',to_jsonb(restored_ids));
end;
$$;
revoke all on function public.rollback_general_sales_reconciliation(uuid,uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.rollback_general_sales_reconciliation(uuid,uuid,uuid,text) to service_role;

-- O read model aplica a regra de negócio pedida sem apagar shipped_at,
-- tracking ou shipment real: cancelamentos/especiais têm precedência; paid é
-- concluído e pending é falta de envio. As datas continuam sendo as reais.
create or replace function public.davi_excel_dataset()
returns table(
 id uuid,client_id uuid,client_number integer,client_name text,has_gift boolean,sale_date date,shipping_deadline_display text,shipping_deadline_date date,
 shipped_at timestamptz,sale_type text,volume_ml numeric,perfume_name text,split_completed_at date,amount numeric,
 payment_status text,payment_method text,paid_at date,credit_reference_amount numeric,notes text,
 operational_status text,search_reference text
) language sql stable security definer set search_path=public as $$
 select s.id,s.client_id,c.client_number,c.name,c.has_gift,s.sale_date,
 case
  when s.payment_status='cancelled' or s.shipping_operational_status='CANCELADO' then 'CANCELADO'
  when s.payment_status='paid' then 'ENVIADO'
  when s.payment_status='pending' then 'FALTANDO ENVIAR'
  when coalesce(active_shipment.posted_at,s.shipped_at) is not null then 'ENVIADO'
  when s.shipping_available_date is not null and s.shipping_availability_confirmed_at is null then to_char(s.shipping_available_date,'DD/MM/YYYY')
  else null end,
 s.shipping_available_date,coalesce(active_shipment.posted_at,s.shipped_at),s.sale_type,s.volume_ml,p.full_name_raw,s.split_completed_at,s.amount,s.payment_status::text,s.payment_method,s.paid_at,s.credit_reference_amount,s.notes,
 case
  when s.payment_status='cancelled' or s.shipping_operational_status='CANCELADO' then 'CANCELADO'
  when s.payment_status='paid' then 'ENVIADO'
  when s.payment_status='pending' then 'FALTANDO ENVIAR'
  when coalesce(active_shipment.posted_at,s.shipped_at) is not null then 'ENVIADO'
  when active_shipment.shipment_id is not null then 'ENVIO EM ANDAMENTO'
  when active_client.request_id is not null and own_request.request_id is null then 'PRÓXIMO ENVIO'
  when own_request.request_id is not null then 'ENVIO EM ANDAMENTO'
  when s.shipping_availability_confirmed_at is null then 'AGUARDANDO PERFUME'
  when coalesce(prep.prepared_ml,0)<coalesce(a.quantity_ml,s.volume_ml,0) then 'AGUARDANDO PREPARAÇÃO'
  else 'PRONTO PARA ENVIO' end,
 coalesce(s.import_signature,'')
 from public.sales s
 join public.clients c on c.id=s.client_id and c.organization_id=s.organization_id
 left join public.perfumes p on p.id=s.perfume_id
 left join public.inventory_allocations a on a.sale_id=s.id and a.status in('reserved','shipping','shipped')
 left join lateral(select sum(bi.quantity_ml) prepared_ml from public.preparation_batch_items bi join public.preparation_batches b on b.id=bi.batch_id and b.status='confirmed' where bi.allocation_id=a.id) prep on true
 left join lateral(select sh.id shipment_id,sh.status,sh.posted_at from public.shipment_items si join public.shipments sh on sh.id=si.shipment_id where si.sale_id=s.id and si.removed_at is null and sh.status<>'cancelled' order by sh.created_at desc limit 1) active_shipment on true
 left join lateral(select r.id request_id from public.customer_shipment_request_items ri join public.customer_shipment_requests r on r.id=ri.request_id left join public.shipments sh on sh.id=r.converted_shipment_id where ri.allocation_id=a.id and ((r.status='requested' and r.converted_shipment_id is null) or(r.status='converted' and sh.status not in('posted','delivered','cancelled'))) limit 1) own_request on true
 left join lateral(select r.id request_id from public.customer_shipment_requests r left join public.shipments sh on sh.id=r.converted_shipment_id where r.client_id=s.client_id and ((r.status='requested' and r.converted_shipment_id is null) or(r.status='converted' and sh.status not in('posted','delivered','cancelled'))) limit 1) active_client on true
 where s.organization_id in(select public.current_user_org_ids())
 and public.has_org_permission(s.organization_id,'sales.view') and s.deleted_at is null;
$$;
revoke all on function public.davi_excel_dataset() from public,anon;
grant execute on function public.davi_excel_dataset() to authenticated;

commit;
