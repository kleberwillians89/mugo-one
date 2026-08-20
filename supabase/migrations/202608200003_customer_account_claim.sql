begin;

-- ============================================================
-- RUAH — Vínculo de conta do portal (ativação/primeiro acesso).
--
-- A criação real do auth.users e o disparo do e-mail de convite
-- (admin.auth.admin.inviteUserByEmail — autoridade nativa do Supabase
-- Auth, sem infraestrutura de e-mail própria) acontecem nas Edge
-- Functions customer-claim-start / customer-account-invite, com
-- service_role — NUNCA no frontend. Aqui só ficam os dois RPCs que
-- rodam DEPOIS que o Supabase Auth já verificou a posse do e-mail (o
-- link do convite só autentica de verdade quem clicou nele): vincular a
-- conta (chamado pela própria cliente já autenticada) e checar
-- elegibilidade (chamado pelo staff antes de convidar).
-- ============================================================

-- Chamado pela cliente já autenticada (pelo link de convite do Supabase
-- Auth) para finalizar o vínculo. Nunca aceita client_id do navegador —
-- só confirma que auth.uid() é exatamente quem a Edge Function de convite
-- já vinculou anteriormente a esta client_accounts.id específica.
create or replace function public.customer_claim_complete(p_account_id uuid)
returns text
language plpgsql security definer set search_path = public as $$
declare v public.client_accounts;
begin
  select * into v from public.client_accounts where id = p_account_id for update;
  if v.id is null or v.auth_user_id is null or v.auth_user_id <> auth.uid() then
    raise exception 'forbidden';
  end if;
  if v.status = 'disabled' then raise exception 'account_disabled'; end if;
  update public.client_accounts set status = 'active', verified_at = coalesce(verified_at, now()), updated_at = now()
    where id = v.id;
  insert into public.audit_logs(organization_id, actor_id, action, entity_type, entity_id, metadata)
    values (v.organization_id, auth.uid(), 'customer_account_claimed', 'client_account', v.id::text, jsonb_build_object('client_id', v.client_id));
  return 'active';
end;
$$;
grant execute on function public.customer_claim_complete(uuid) to authenticated;

-- Elegibilidade de ativação manual pelo staff ("ENVIAR ACESSO"). Nunca
-- cria auth.users aqui (isso é só service_role, na Edge Function) — só
-- garante idempotência (não reconvida quem já está ativo) e devolve a
-- linha client_accounts para a Edge Function preencher/atualizar.
create or replace function public.client_account_prepare_invite(p_client_id uuid, p_email text)
returns public.client_accounts
language plpgsql security definer set search_path = public as $$
declare v_client public.clients; v_row public.client_accounts;
begin
  select * into v_client from public.clients where id = p_client_id and deleted_at is null;
  if v_client.id is null or not public.has_org_role(v_client.organization_id, array['admin','manager']::public.member_role[])
    then raise exception 'forbidden'; end if;
  select * into v_row from public.client_accounts where client_id = p_client_id for update;
  if v_row.id is not null and v_row.status = 'active' then raise exception 'account_already_active'; end if;
  insert into public.client_accounts(organization_id, client_id, status, claim_email, last_invited_at)
  values (v_client.organization_id, p_client_id, 'pending_verification', p_email, now())
  on conflict (client_id) do update set claim_email = excluded.claim_email, last_invited_at = now(), updated_at = now()
  returning * into v_row;
  return v_row;
end;
$$;
revoke all on function public.client_account_prepare_invite(uuid, text) from public, anon;
grant execute on function public.client_account_prepare_invite(uuid, text) to authenticated, service_role;

-- Chamada pela Edge Function (service_role) só depois que
-- admin.auth.admin.inviteUserByEmail/createUser já criou o auth.users —
-- grava o auth_user_id resultante na linha já preparada acima.
create or replace function public.client_account_link_auth_user(p_account_id uuid, p_auth_user_id uuid)
returns public.client_accounts
language plpgsql security definer set search_path = public as $$
declare v public.client_accounts;
begin
  update public.client_accounts set auth_user_id = p_auth_user_id, updated_at = now()
    where id = p_account_id returning * into v;
  if v.id is null then raise exception 'account_not_found'; end if;
  return v;
end;
$$;
revoke all on function public.client_account_link_auth_user(uuid, uuid) from public, anon, authenticated;
grant execute on function public.client_account_link_auth_user(uuid, uuid) to service_role;

commit;
