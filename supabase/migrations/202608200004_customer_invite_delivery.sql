begin;
alter table public.client_accounts
  add column if not exists sent_email_at timestamptz,
  add column if not exists sent_whatsapp_at timestamptz,
  add column if not exists invite_last_error jsonb,
  add column if not exists invite_attempted_at timestamptz;

drop function if exists public.client_portal_status(uuid);
create function public.client_portal_status(p_client_id uuid)
returns table(account_status text, claim_email text, verified_at timestamptz, last_invited_at timestamptz,
  sent_email_at timestamptz, sent_whatsapp_at timestamptz, invite_last_error jsonb,
  open_requests bigint, open_tickets bigint)
language sql stable security invoker set search_path=public as $$
  select ca.status,ca.claim_email,ca.verified_at,ca.last_invited_at,ca.sent_email_at,ca.sent_whatsapp_at,ca.invite_last_error,
    (select count(*) from public.customer_shipment_requests where client_id=p_client_id and status='requested'),
    (select count(*) from public.customer_support_tickets where client_id=p_client_id and status<>'resolved')
  from public.clients c left join public.client_accounts ca on ca.client_id=c.id
  where c.id=p_client_id and c.organization_id in (select public.current_user_org_ids());
$$;
grant execute on function public.client_portal_status(uuid) to authenticated;
commit;
