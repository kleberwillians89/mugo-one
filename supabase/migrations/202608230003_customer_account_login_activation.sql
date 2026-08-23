begin;

-- Repara convites antigos que já possuem auth_user_id e senha válida, mas
-- ficaram pending_verification porque o callback antigo não concluiu o claim.
-- Nunca recebe client_id: a identidade vem exclusivamente do JWT autenticado.
create or replace function public.customer_account_activate_current()
returns boolean
language plpgsql
security definer
set search_path=public
as $$
declare
  v_account public.client_accounts;
begin
  if auth.uid() is null then raise exception 'authentication_required'; end if;

  select * into v_account
  from public.client_accounts
  where auth_user_id=auth.uid()
  for update;

  if v_account.id is null then return false; end if;
  if v_account.status='disabled' then raise exception 'account_disabled'; end if;
  if v_account.status='active' then return true; end if;
  if v_account.status<>'pending_verification' then raise exception 'invalid_account_status'; end if;
  if not exists(
    select 1 from jsonb_array_elements(coalesce(auth.jwt()->'amr','[]'::jsonb)) factor
    where factor->>'method'='password'
  ) then raise exception 'password_login_required'; end if;

  update public.client_accounts
  set status='active',verified_at=coalesce(verified_at,now()),updated_at=now()
  where id=v_account.id and status='pending_verification';

  insert into public.audit_logs(organization_id,actor_id,action,entity_type,entity_id,metadata)
  values(v_account.organization_id,auth.uid(),'customer_account_activated_on_login','client_account',v_account.id::text,
    jsonb_build_object('client_id',v_account.client_id,'source','authenticated_login'));

  return true;
end;
$$;

revoke all on function public.customer_account_activate_current() from public,anon;
grant execute on function public.customer_account_activate_current() to authenticated;

commit;
