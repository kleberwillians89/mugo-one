begin;

-- ============================================================
-- MUGÔ ONE — Sprint P (Fiscal Foundation + Nuvem Fiscal + NFS-e)
--
-- update_fiscal_document_status: só a Edge Function fiscal-issue chama
-- (service_role). Nunca regride de um status terminal, e só emite
-- evento quando o status realmente muda (briefing §22).
-- ============================================================

create or replace function public.update_fiscal_document_status(
  p_fiscal_document_id uuid,
  p_status text,
  p_provider_document_id text default null,
  p_provider_status text default null,
  p_number text default null,
  p_series text default null,
  p_access_key text default null,
  p_error_code text default null,
  p_error_message text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_document public.fiscal_documents;
  v_previous_status text;
begin
  if auth.role() <> 'service_role' then
    raise exception 'permission_denied' using errcode = '42501';
  end if;
  if p_status not in ('processing', 'authorized', 'rejected', 'failed') then
    raise exception 'invalid_status';
  end if;

  select * into v_document from public.fiscal_documents where id = p_fiscal_document_id;
  if not found then return jsonb_build_object('status', 'not_found'); end if;

  if v_document.status in ('authorized', 'cancelled') then
    return jsonb_build_object('status', 'ignored_terminal', 'fiscal_document_id', v_document.id);
  end if;
  if v_document.status = p_status then
    return jsonb_build_object('status', 'unchanged', 'fiscal_document_id', v_document.id);
  end if;

  v_previous_status := v_document.status;

  update public.fiscal_documents set
    status = p_status,
    provider_document_id = coalesce(p_provider_document_id, provider_document_id),
    provider_status = coalesce(p_provider_status, provider_status),
    number = coalesce(p_number, number),
    series = coalesce(p_series, series),
    access_key = coalesce(p_access_key, access_key),
    issued_at = case when p_status = 'processing' and issued_at is null then now() else issued_at end,
    authorized_at = case when p_status = 'authorized' then now() else authorized_at end,
    error_code = case when p_status in ('rejected', 'failed') then p_error_code else error_code end,
    error_message = case when p_status in ('rejected', 'failed') then p_error_message else error_message end
  where id = p_fiscal_document_id;

  perform public.log_activity(
    v_document.organization_id, 'sale', v_document.sale_id,
    case p_status when 'authorized' then 'fiscal_document_authorized' when 'rejected' then 'fiscal_document_rejected' when 'failed' then 'fiscal_document_failed' else 'fiscal_document_processing' end,
    null,
    case p_status when 'authorized' then 'NFS-e autorizada' when 'rejected' then 'NFS-e rejeitada' when 'failed' then 'NFS-e falhou' else 'NFS-e em processamento' end,
    null, jsonb_build_object('fiscal_document_id', v_document.id)
  );

  perform public.emit_domain_event(
    v_document.organization_id, 'fiscal.' || p_status, 'sale', v_document.sale_id,
    jsonb_build_object('fiscal_document_id', v_document.id, 'sale_id', v_document.sale_id, 'document_type', v_document.document_type, 'status', p_status),
    'update_fiscal_document_status', null, null, null
  );

  return jsonb_build_object('status', 'updated', 'fiscal_document_id', v_document.id, 'from', v_previous_status, 'to', p_status);
end;
$$;

revoke all on function public.update_fiscal_document_status(uuid, text, text, text, text, text, text, text, text) from public, anon, authenticated;
grant execute on function public.update_fiscal_document_status(uuid, text, text, text, text, text, text, text, text) to service_role;

-- ============================================================
-- cancel_fiscal_document: só a intenção local nesta sprint (briefing
-- §45 — "implementar somente se fluxo NFS-e atual/provider for
-- claro"; sem provider vivo para confirmar o cancelamento remoto,
-- fica documentado como próximo passo quando um adapter real existir).
-- ============================================================

create or replace function public.cancel_fiscal_document(p_fiscal_document_id uuid, p_reason text default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_document public.fiscal_documents;
begin
  select * into v_document from public.fiscal_documents where id = p_fiscal_document_id;
  if not found then raise exception 'fiscal_document_not_found'; end if;
  if not public.has_org_permission(v_document.organization_id, 'fiscal.cancel') then
    raise exception 'forbidden';
  end if;
  if v_document.status not in ('requested', 'processing', 'authorized') then
    raise exception 'FISCAL_DOCUMENT_NOT_CANCELLABLE';
  end if;

  update public.fiscal_documents set status = 'cancelled', cancelled_at = now() where id = p_fiscal_document_id;

  perform public.log_activity(
    v_document.organization_id, 'sale', v_document.sale_id, 'fiscal_document_cancelled', auth.uid(),
    'NFS-e cancelada', p_reason, jsonb_build_object('fiscal_document_id', v_document.id)
  );

  perform public.emit_domain_event(
    v_document.organization_id, 'fiscal.cancelled', 'sale', v_document.sale_id,
    jsonb_build_object('fiscal_document_id', v_document.id, 'sale_id', v_document.sale_id, 'document_type', v_document.document_type, 'status', 'cancelled'),
    'cancel_fiscal_document', auth.uid(), null, null
  );

  return jsonb_build_object('fiscal_document_id', v_document.id, 'status', 'cancelled');
end;
$$;

revoke all on function public.cancel_fiscal_document(uuid, text) from public, anon;
grant execute on function public.cancel_fiscal_document(uuid, text) to authenticated;

commit;
