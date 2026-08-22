begin;

-- Confirma no servidor que a sessão autenticada pertence a um primeiro
-- acesso ainda pendente. Uma sessão antiga, conta já ativa ou rota aberta
-- manualmente nunca recebe autorização para exibir a troca de senha.
create or replace function public.customer_first_access_context_valid()
returns boolean
language sql stable security definer set search_path=public
as $$
  select auth.uid() is not null and (
    exists(select 1 from public.client_accounts where auth_user_id=auth.uid() and status='pending_verification')
    or exists(select 1 from public.customer_identity_requests where auth_user_id=auth.uid() and status in('email_pending','mfa_pending'))
  );
$$;

revoke all on function public.customer_first_access_context_valid() from public,anon;
grant execute on function public.customer_first_access_context_valid() to authenticated;

commit;
