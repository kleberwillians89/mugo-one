begin;

-- ============================================================
-- MUGÔ ONE — Sprint P (Fiscal Foundation + Nuvem Fiscal + NFS-e)
--
-- request_fiscal_document: única porta de criação de fiscal_documents.
-- NÃO chama o provider (isso é a Edge Function fiscal-issue, HTTP fica
-- fora da transação — briefing §21). Aqui: valida, monta os
-- snapshots, garante idempotência (índice parcial da migration
-- anterior), emite fiscal.requested.
-- ============================================================

create or replace function public.request_fiscal_document(
  p_organization_id uuid,
  p_sale_id uuid,
  p_document_type text default 'nfse',
  p_causation_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_sale public.sales;
  v_profile public.organization_fiscal_profiles;
  v_org_settings record;
  v_connection public.fiscal_connections;
  v_existing public.fiscal_documents;
  v_document_id uuid;
  v_recipient_snapshot jsonb;
  v_issuer_snapshot jsonb;
  v_item record;
  v_position integer := 0;
begin
  if auth.role() <> 'service_role' and not public.has_org_permission(p_organization_id, 'fiscal.issue') then
    raise exception 'forbidden';
  end if;
  if p_document_type not in ('nfse', 'nfe', 'nfce') then
    raise exception 'invalid_document_type';
  end if;
  if p_document_type <> 'nfse' then
    -- briefing §10/§55: NF-e/NFC-e ficam com a estrutura pronta, sem
    -- emissão real nesta sprint.
    raise exception 'document_type_not_available_yet';
  end if;

  select * into v_sale from public.sales where id = p_sale_id and organization_id = p_organization_id;
  if not found then raise exception 'sale_organization_mismatch'; end if;
  if v_sale.status = 'cancelled' then raise exception 'sale_cancelled'; end if;

  select * into v_profile from public.organization_fiscal_profiles where organization_id = p_organization_id;
  if not found then raise exception 'MISSING_FISCAL_PROFILE'; end if;
  if not v_profile.nfse_enabled then raise exception 'MISSING_FISCAL_PROFILE'; end if;

  select legal_name, company_name, document, email, phone into v_org_settings
  from public.organization_settings where organization_id = p_organization_id;
  if v_org_settings.document is null then raise exception 'MISSING_FISCAL_PROFILE'; end if;

  select id, name, email, cpf, cnpj, address_line, address_number, district, city, state, postal_code
    into v_item
  from public.clients where id = v_sale.client_id;
  if v_item.id is null then raise exception 'MISSING_RECIPIENT_DOCUMENT'; end if;
  if coalesce(v_item.cpf, v_item.cnpj) is null then raise exception 'MISSING_RECIPIENT_DOCUMENT'; end if;

  -- Idempotência de negócio: pedido repetido (clique duplo, retry,
  -- refresh) para a mesma venda+tipo encontra o já aberto em vez de
  -- criar outro (índice parcial garante isso também no nível do banco).
  select * into v_existing from public.fiscal_documents
  where organization_id = p_organization_id and sale_id = p_sale_id and document_type = p_document_type
    and status not in ('failed', 'cancelled')
  limit 1;
  if v_existing.id is not null then
    return jsonb_build_object('fiscal_document_id', v_existing.id, 'status', v_existing.status, 'already_requested', true);
  end if;

  select * into v_connection from public.fiscal_connections
  where organization_id = p_organization_id and provider = 'nuvem_fiscal';

  v_recipient_snapshot := jsonb_build_object(
    'customer_id', v_item.id, 'name', v_item.name, 'email', v_item.email,
    'document', coalesce(v_item.cnpj, v_item.cpf), 'document_type', case when v_item.cnpj is not null then 'cnpj' else 'cpf' end,
    'address_line', v_item.address_line, 'address_number', v_item.address_number, 'district', v_item.district,
    'city', v_item.city, 'state', v_item.state, 'postal_code', v_item.postal_code
  );
  v_issuer_snapshot := jsonb_build_object(
    'legal_name', v_org_settings.legal_name, 'trade_name', v_org_settings.company_name, 'document', v_org_settings.document,
    'email', v_org_settings.email, 'phone', v_org_settings.phone,
    'state_registration', v_profile.state_registration, 'municipal_registration', v_profile.municipal_registration,
    'tax_regime', v_profile.tax_regime, 'address_line', v_profile.address_line, 'address_number', v_profile.address_number,
    'district', v_profile.district, 'city', v_profile.city, 'state', v_profile.state, 'postal_code', v_profile.postal_code,
    'city_code', v_profile.city_code
  );

  insert into public.fiscal_documents (
    organization_id, sale_id, document_type, provider, environment, status,
    total_amount, recipient_snapshot, issuer_snapshot, idempotency_key, created_by
  ) values (
    p_organization_id, p_sale_id, p_document_type, 'nuvem_fiscal', coalesce(v_connection.environment, v_profile.default_environment), 'requested',
    v_sale.total_amount, v_recipient_snapshot, v_issuer_snapshot, p_sale_id::text || ':' || p_document_type, auth.uid()
  ) returning id into v_document_id;

  v_position := 0;
  for v_item in select si.id, si.catalog_item_id, si.description, si.quantity, si.unit, si.unit_price, si.discount_amount, si.total_amount
    from public.sale_items si where si.sale_id = p_sale_id order by si.position
  loop
    insert into public.fiscal_document_items (
      organization_id, fiscal_document_id, sale_item_id, catalog_item_id, description,
      quantity, unit, unit_price, discount_amount, total_amount, position
    ) values (
      p_organization_id, v_document_id, v_item.id, v_item.catalog_item_id, v_item.description,
      v_item.quantity, v_item.unit, v_item.unit_price, v_item.discount_amount, v_item.total_amount, v_position
    );
    v_position := v_position + 1;
  end loop;

  perform public.log_activity(
    p_organization_id, 'sale', p_sale_id, 'fiscal_document_requested', auth.uid(),
    'NFS-e solicitada', null, jsonb_build_object('fiscal_document_id', v_document_id)
  );

  perform public.emit_domain_event(
    p_organization_id, 'fiscal.requested', 'sale', p_sale_id,
    jsonb_build_object('fiscal_document_id', v_document_id, 'sale_id', p_sale_id, 'document_type', p_document_type, 'status', 'requested'),
    'request_fiscal_document', auth.uid(), null, p_causation_id
  );

  return jsonb_build_object('fiscal_document_id', v_document_id, 'status', 'requested', 'already_requested', false);
end;
$$;

revoke all on function public.request_fiscal_document(uuid, uuid, text, uuid) from public, anon;
grant execute on function public.request_fiscal_document(uuid, uuid, text, uuid) to authenticated, service_role;

commit;
