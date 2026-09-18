begin;

-- ============================================================
-- MUGÔ ONE — Sprint P (Fiscal Foundation + Nuvem Fiscal + NFS-e)
--
-- claim_requested_fiscal_documents: usada só pela fiscal-issue Edge
-- Function. Mesmo padrão de claim_queued_messages (Sprint O) — FOR
-- UPDATE SKIP LOCKED evita que duas invocações concorrentes processem
-- o mesmo documento.
-- ============================================================

create or replace function public.claim_requested_fiscal_documents(p_limit integer default 10)
returns table (id uuid, organization_id uuid, document_type text, environment text, total_amount numeric, recipient_snapshot jsonb, issuer_snapshot jsonb, idempotency_key text)
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.role() <> 'service_role' then
    raise exception 'permission_denied' using errcode = '42501';
  end if;

  return query
  select d.id, d.organization_id, d.document_type, d.environment, d.total_amount, d.recipient_snapshot, d.issuer_snapshot, d.idempotency_key
  from public.fiscal_documents d
  where d.status = 'requested'
  order by d.created_at
  limit greatest(1, least(p_limit, 50))
  for update of d skip locked;
end;
$$;

revoke all on function public.claim_requested_fiscal_documents(integer) from public, anon, authenticated;
grant execute on function public.claim_requested_fiscal_documents(integer) to service_role;

commit;
