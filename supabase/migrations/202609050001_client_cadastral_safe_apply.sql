begin;

-- ==========================================================================
-- CRUZAMENTO CADASTRAL COM FONTE EXTERNA (planilha "Emily" e equivalentes)
-- --------------------------------------------------------------------------
-- Aplica em lote SOMENTE atualizações cadastrais inequívocas já aprovadas
-- por um dry-run local (scripts/emily-client-reconciliation.mjs). Esta RPC
-- nunca cria cliente, nunca mescla ambíguos, nunca reatribui client_id de
-- vendas e nunca toca em public.sales/inventory_*/shipments/perfumes — só
-- os 10 campos cadastrais abaixo em public.clients, um por um, só quando
-- realmente presentes no proposed_changes de cada linha.
--
-- Segue o mesmo desenho já aprovado em apply_davi_safe_diagnostic_batch
-- (pré-validação integral antes de qualquer escrita, fingerprint do lote,
-- idempotência via import_batches, FOR UPDATE), em davi_excel_set_client_gift
-- (permissão clients.edit, expected_updated_at, audit_logs before/after) e em
-- apply_general_sales_reconciliation/rollback_general_sales_reconciliation
-- (RPC administrativa chamada por script via service_role — não pela sessão
-- do usuário no app —, por isso recebe p_actor_id explícito em vez de
-- depender de auth.uid(), que é null em chamadas com a chave service_role).
-- ==========================================================================

-- Equivalente de has_org_permission(org_id,code), mas para um ator explícito
-- em vez de auth.uid() — necessário porque esta RPC roda via service_role.
create or replace function public.has_org_permission_for_actor(org_id uuid, actor_id uuid, p_permission_code text)
returns boolean language plpgsql stable security definer set search_path=public as $$
declare v_member public.organization_members; v_override boolean;
begin
  select * into v_member from public.organization_members where organization_id=org_id and user_id=actor_id;
  if not found or v_member.status <> 'active' then return false; end if;
  if v_member.access_total then return true; end if;
  if v_member.view_all and p_permission_code like '%.view' and p_permission_code not in ('team.view','audit.view') then return true; end if;
  select omp.granted into v_override from public.organization_member_permissions omp
    where omp.organization_id=org_id and omp.user_id=actor_id and omp.permission_code=p_permission_code;
  if found then return v_override; end if;
  return false;
end;
$$;
revoke all on function public.has_org_permission_for_actor(uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.has_org_permission_for_actor(uuid,uuid,text) to service_role;

-- Fingerprint determinístico do lote: mesma ordem de campos calculada em
-- scripts/emily-client-reconciliation.mjs (buildSafeManifest/CADASTRAL_FIELDS)
-- via concat_ws com separadores ASCII — nunca via JSON.stringify, cuja ordem
-- de chaves não é um contrato estável entre JS e SQL.
create or replace function public.client_cadastral_safe_batch_fingerprint(p_rows jsonb)
returns text language sql immutable as $$
  select public.ai_sha256_hex(string_agg(
    concat_ws(chr(31),
      item.value->>'client_id', coalesce(item.value->>'match_method',''),
      coalesce(item.value->>'expected_updated_at',''), coalesce(item.value->>'source_row',''),
      coalesce(item.value#>>'{proposed_changes,cpf,after}',''), coalesce(item.value#>>'{proposed_changes,phone,after}',''),
      coalesce(item.value#>>'{proposed_changes,email,after}',''), coalesce(item.value#>>'{proposed_changes,postal_code,after}',''),
      coalesce(item.value#>>'{proposed_changes,address_line,after}',''), coalesce(item.value#>>'{proposed_changes,address_number,after}',''),
      coalesce(item.value#>>'{proposed_changes,complement,after}',''), coalesce(item.value#>>'{proposed_changes,district,after}',''),
      coalesce(item.value#>>'{proposed_changes,city,after}',''), coalesce(item.value#>>'{proposed_changes,state,after}','')
    ), chr(30) order by item.value->>'client_id'
  ))
  from jsonb_array_elements(p_rows) as item(value);
$$;
revoke all on function public.client_cadastral_safe_batch_fingerprint(jsonb) from public,anon;

create or replace function public.apply_client_cadastral_safe_batch(
  p_organization_id uuid,
  p_actor_id uuid,
  p_source_file_name text,
  p_source_file_sha256 text,
  p_fingerprint text,
  p_rows jsonb
) returns jsonb language plpgsql security definer set search_path=public as $$
declare
  allowed_fields constant text[] := array['cpf','phone','email','postal_code','address_line','address_number','complement','district','city','state'];
  address_only_fields constant text[] := array['address_line','address_number','complement','district','city','state'];
  computed_fingerprint text; batch_key text; batch_id uuid; existing_batch public.import_batches;
  item jsonb; field text; target_client_id uuid; before_row public.clients; after_row public.clients;
  new_normalized_cpf text; new_normalized_phone text; new_normalized_email text; conflict_id uuid;
  applied_count integer := 0; audit_before jsonb; audit_after jsonb;
begin
  if p_actor_id is null then raise exception 'authentication_required'; end if;
  if not public.has_org_permission_for_actor(p_organization_id,p_actor_id,'clients.edit') then
    raise exception 'permission_denied';
  end if;
  if coalesce(btrim(p_source_file_name),'')='' or p_source_file_sha256 !~ '^[0-9a-f]{64}$' or p_fingerprint !~ '^[0-9a-f]{64}$' then
    raise exception 'invalid_batch_identity';
  end if;
  if jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) = 0 or jsonb_array_length(p_rows) > 5000 then
    raise exception 'invalid_batch_size';
  end if;

  -- Estrutura de cada linha: só os 10 campos aprovados, nunca o objeto
  -- inteiro; client_id só pode aparecer uma vez no lote.
  for item in select value from jsonb_array_elements(p_rows) loop
    if coalesce(item->>'client_id','') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
      raise exception 'invalid_client_id';
    end if;
    if jsonb_typeof(item->'proposed_changes') <> 'object' or (select count(*) from jsonb_object_keys(item->'proposed_changes')) = 0 then
      raise exception 'invalid_proposed_changes:%', item->>'client_id';
    end if;
    for field in select jsonb_object_keys(item->'proposed_changes') loop
      if field <> all(allowed_fields) then raise exception 'field_not_approved:%', field; end if;
    end loop;
  end loop;
  if (select count(distinct candidate.value->>'client_id') from jsonb_array_elements(p_rows) as candidate(value)) <> jsonb_array_length(p_rows) then
    raise exception 'duplicate_client_id';
  end if;

  computed_fingerprint := public.client_cadastral_safe_batch_fingerprint(p_rows);
  if computed_fingerprint is distinct from p_fingerprint then raise exception 'manifest_fingerprint_mismatch'; end if;

  batch_key := public.ai_sha256_hex(p_source_file_sha256||'|'||p_fingerprint);
  perform pg_advisory_xact_lock(hashtextextended(batch_key,202609050001));

  select * into existing_batch from public.import_batches
    where organization_id=p_organization_id and file_hash=batch_key and status='completed' for update;
  if existing_batch.id is not null then
    if existing_batch.metadata->>'source_file_sha256' is distinct from p_source_file_sha256
       or existing_batch.metadata->>'fingerprint' is distinct from p_fingerprint then
      raise exception 'client_cadastral_idempotency_conflict';
    end if;
    return jsonb_build_object('batch_id',existing_batch.id,'idempotent',true,'applied',0);
  end if;

  insert into public.import_batches(organization_id,file_name,file_hash,storage_path,sheet_name,status,total_rows,valid_rows,rejected_rows,duplicate_rows,processed_rows,created_by)
  values(p_organization_id,p_source_file_name,batch_key,'client-cadastral-safe-batch/'||batch_key,'CADASTRO_SEGURO','processing',jsonb_array_length(p_rows),jsonb_array_length(p_rows),0,0,0,p_actor_id)
  returning id into batch_id;

  -- Pré-validação integral: tenant, existência, soft-delete/merge, mesmo
  -- estado (expected_updated_at + valor atual de cada campo proposto ainda
  -- batendo com "before") e nenhuma ambiguidade nova em cpf/e-mail/telefone.
  -- Nenhuma tabela persistente é escrita antes de a última linha passar.
  for item in select value from jsonb_array_elements(p_rows) loop
    target_client_id := (item->>'client_id')::uuid;
    select * into before_row from public.clients
      where id=target_client_id and organization_id=p_organization_id
      for update;
    if before_row.id is null then raise exception 'client_not_found:%', target_client_id; end if;
    if before_row.deleted_at is not null then raise exception 'client_deleted:%', target_client_id; end if;
    if before_row.merged_into_id is not null then raise exception 'client_merged:%', target_client_id; end if;
    if item->>'expected_updated_at' is not null
       and before_row.updated_at is distinct from (item->>'expected_updated_at')::timestamptz then
      raise exception 'stale_client:%', target_client_id;
    end if;

    if item->'proposed_changes' ? 'cpf' then
      if before_row.normalized_cpf is distinct from nullif(item#>>'{proposed_changes,cpf,before}','') then
        raise exception 'stale_field:cpf:%', target_client_id;
      end if;
      new_normalized_cpf := public.only_digits(item#>>'{proposed_changes,cpf,after}');
      select id into conflict_id from public.clients
        where organization_id=p_organization_id and id<>target_client_id and deleted_at is null and merged_into_id is null
          and normalized_cpf=new_normalized_cpf limit 1;
      if conflict_id is not null then raise exception 'cpf_would_create_ambiguity:%', target_client_id; end if;
    end if;
    if item->'proposed_changes' ? 'phone' then
      if before_row.normalized_phone is distinct from nullif(item#>>'{proposed_changes,phone,before}','') then
        raise exception 'stale_field:phone:%', target_client_id;
      end if;
      new_normalized_phone := public.normalize_br_phone(item#>>'{proposed_changes,phone,after}');
      select id into conflict_id from public.clients
        where organization_id=p_organization_id and id<>target_client_id and deleted_at is null and merged_into_id is null
          and normalized_whatsapp=new_normalized_phone limit 1;
      if conflict_id is not null then raise exception 'phone_would_create_ambiguity:%', target_client_id; end if;
    end if;
    if item->'proposed_changes' ? 'email' then
      if before_row.normalized_email is distinct from nullif(item#>>'{proposed_changes,email,before}','') then
        raise exception 'stale_field:email:%', target_client_id;
      end if;
      new_normalized_email := nullif(lower(btrim(item#>>'{proposed_changes,email,after}')),'');
      select id into conflict_id from public.clients
        where organization_id=p_organization_id and id<>target_client_id and deleted_at is null and merged_into_id is null
          and normalized_email=new_normalized_email limit 1;
      if conflict_id is not null then raise exception 'email_would_create_ambiguity:%', target_client_id; end if;
    end if;
    if item->'proposed_changes' ? 'postal_code'
       and before_row.normalized_postal_code is distinct from nullif(item#>>'{proposed_changes,postal_code,before}','') then
      raise exception 'stale_field:postal_code:%', target_client_id;
    end if;
    for field in select unnest(address_only_fields) loop
      if item->'proposed_changes' ? field
         and coalesce(to_jsonb(before_row)->>field,'') is distinct from coalesce(item#>>array['proposed_changes',field,'before'],'') then
        raise exception 'stale_field:%:%', field, target_client_id;
      end if;
    end loop;
  end loop;

  -- Aplicação: só os campos presentes em proposed_changes, nunca o objeto
  -- inteiro; nunca toca perfume/estoque/vendas/pagamentos/shipments.
  for item in select value from jsonb_array_elements(p_rows) loop
    target_client_id := (item->>'client_id')::uuid;
    select * into before_row from public.clients where id=target_client_id and organization_id=p_organization_id;

    update public.clients set
      cpf = case when item->'proposed_changes' ? 'cpf' then item#>>'{proposed_changes,cpf,after}' else cpf end,
      phone = case when item->'proposed_changes' ? 'phone' then item#>>'{proposed_changes,phone,after}' else phone end,
      email = case when item->'proposed_changes' ? 'email' then item#>>'{proposed_changes,email,after}' else email end,
      postal_code = case when item->'proposed_changes' ? 'postal_code' then item#>>'{proposed_changes,postal_code,after}' else postal_code end,
      address_line = case when item->'proposed_changes' ? 'address_line' then item#>>'{proposed_changes,address_line,after}' else address_line end,
      address_number = case when item->'proposed_changes' ? 'address_number' then item#>>'{proposed_changes,address_number,after}' else address_number end,
      complement = case when item->'proposed_changes' ? 'complement' then item#>>'{proposed_changes,complement,after}' else complement end,
      district = case when item->'proposed_changes' ? 'district' then item#>>'{proposed_changes,district,after}' else district end,
      city = case when item->'proposed_changes' ? 'city' then item#>>'{proposed_changes,city,after}' else city end,
      state = case when item->'proposed_changes' ? 'state' then item#>>'{proposed_changes,state,after}' else state end,
      updated_at = now()
    where id=target_client_id
    returning * into after_row;

    audit_before := '{}'::jsonb; audit_after := '{}'::jsonb;
    for field in select jsonb_object_keys(item->'proposed_changes') loop
      audit_before := audit_before || jsonb_build_object(field, to_jsonb(before_row)->field);
      audit_after := audit_after || jsonb_build_object(field, to_jsonb(after_row)->field);
    end loop;

    insert into public.audit_logs(organization_id,actor_id,action,entity_type,entity_id,metadata)
    values(p_organization_id,p_actor_id,'client_cadastral_safe_update','client',target_client_id::text,
      jsonb_build_object('batch_id',batch_id,'source_row',item->>'source_row','match_method',item->>'match_method',
        'before',audit_before,'after',audit_after,'sales_touched',false,'client_id_reassigned',false));

    applied_count := applied_count + 1;
  end loop;

  update public.import_batches set status='completed',processed_rows=applied_count,completed_at=now(),
    metadata=jsonb_build_object('mode','client_cadastral_safe_batch','source_file_sha256',p_source_file_sha256,'fingerprint',p_fingerprint,'applied_rows',applied_count)
  where id=batch_id;

  return jsonb_build_object('batch_id',batch_id,'idempotent',false,'applied',applied_count);
end;$$;
revoke all on function public.apply_client_cadastral_safe_batch(uuid,uuid,text,text,text,jsonb) from public,anon,authenticated;
grant execute on function public.apply_client_cadastral_safe_batch(uuid,uuid,text,text,text,jsonb) to service_role;

-- --------------------------------------------------------------------------
-- Rollback seguro do batch: repõe exatamente os valores de "before" de cada
-- audit_logs gravado por este batch_id, mas só se o valor atual ainda for
-- igual ao "after" que este mesmo batch gravou (senão outra coisa mudou o
-- campo depois — aborta em vez de sobrescrever silenciosamente). Nunca toca
-- em sales/inventory/shipments; só os mesmos campos cadastrais.
-- --------------------------------------------------------------------------
create or replace function public.rollback_client_cadastral_safe_batch(
  p_organization_id uuid,
  p_actor_id uuid,
  p_batch_id uuid
) returns jsonb language plpgsql security definer set search_path=public as $$
declare
  entry public.audit_logs; target_client_id uuid; before_row public.clients; after_row public.clients;
  field text; reverted_count integer := 0; already_rolled_back boolean;
begin
  if p_actor_id is null then raise exception 'authentication_required'; end if;
  if not public.has_org_permission_for_actor(p_organization_id,p_actor_id,'clients.edit') then
    raise exception 'permission_denied';
  end if;

  if not exists(select 1 from public.audit_logs where organization_id=p_organization_id and action='client_cadastral_safe_update' and (metadata->>'batch_id')::uuid=p_batch_id) then
    raise exception 'batch_not_found';
  end if;

  select exists(select 1 from public.audit_logs where organization_id=p_organization_id and action='client_cadastral_safe_batch_rolled_back' and entity_id=p_batch_id::text)
    into already_rolled_back;
  if already_rolled_back then
    return jsonb_build_object('batch_id',p_batch_id,'idempotent',true,'reverted',0);
  end if;

  for entry in
    select * from public.audit_logs
    where organization_id=p_organization_id and action='client_cadastral_safe_update' and (metadata->>'batch_id')::uuid=p_batch_id
    order by id
  loop
    target_client_id := entry.entity_id::uuid;
    select * into before_row from public.clients
      where id=target_client_id and organization_id=p_organization_id and deleted_at is null and merged_into_id is null
      for update;
    if before_row.id is null then raise exception 'client_not_found_for_rollback:%', target_client_id; end if;

    for field in select jsonb_object_keys(entry.metadata->'after') loop
      if coalesce(to_jsonb(before_row)->>field,'') is distinct from coalesce(entry.metadata#>>array['after',field],'') then
        raise exception 'client_changed_since_batch:%:%', field, target_client_id;
      end if;
    end loop;

    update public.clients set
      cpf = case when entry.metadata->'before' ? 'cpf' then entry.metadata#>>'{before,cpf}' else cpf end,
      phone = case when entry.metadata->'before' ? 'phone' then entry.metadata#>>'{before,phone}' else phone end,
      email = case when entry.metadata->'before' ? 'email' then entry.metadata#>>'{before,email}' else email end,
      postal_code = case when entry.metadata->'before' ? 'postal_code' then entry.metadata#>>'{before,postal_code}' else postal_code end,
      address_line = case when entry.metadata->'before' ? 'address_line' then entry.metadata#>>'{before,address_line}' else address_line end,
      address_number = case when entry.metadata->'before' ? 'address_number' then entry.metadata#>>'{before,address_number}' else address_number end,
      complement = case when entry.metadata->'before' ? 'complement' then entry.metadata#>>'{before,complement}' else complement end,
      district = case when entry.metadata->'before' ? 'district' then entry.metadata#>>'{before,district}' else district end,
      city = case when entry.metadata->'before' ? 'city' then entry.metadata#>>'{before,city}' else city end,
      state = case when entry.metadata->'before' ? 'state' then entry.metadata#>>'{before,state}' else state end,
      updated_at = now()
    where id=target_client_id
    returning * into after_row;

    insert into public.audit_logs(organization_id,actor_id,action,entity_type,entity_id,metadata)
    values(p_organization_id,p_actor_id,'client_cadastral_safe_update_reverted','client',target_client_id::text,
      jsonb_build_object('batch_id',p_batch_id,'restored',entry.metadata->'before'));

    reverted_count := reverted_count + 1;
  end loop;

  insert into public.audit_logs(organization_id,actor_id,action,entity_type,entity_id,metadata)
  values(p_organization_id,p_actor_id,'client_cadastral_safe_batch_rolled_back','client_cadastral_batch',p_batch_id::text,
    jsonb_build_object('reverted',reverted_count));

  return jsonb_build_object('batch_id',p_batch_id,'idempotent',false,'reverted',reverted_count);
end;$$;
revoke all on function public.rollback_client_cadastral_safe_batch(uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function public.rollback_client_cadastral_safe_batch(uuid,uuid,uuid) to service_role;

commit;
