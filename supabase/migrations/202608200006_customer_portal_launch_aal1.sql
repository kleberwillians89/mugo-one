begin;

-- Lançamento do Minha RUAH sem MFA obrigatório. A autorização continua
-- vinculada exclusivamente ao auth.uid() da sessão e a uma conta ativa;
-- nenhum RPC privado recebe client_id do navegador.
create or replace function public.current_customer_client()
returns uuid language sql stable security definer set search_path=public as $$
  select ca.client_id
  from public.client_accounts ca
  where auth.uid() is not null
    and ca.auth_user_id=auth.uid()
    and ca.status='active';
$$;
revoke all on function public.current_customer_client() from public,anon;
grant execute on function public.current_customer_client() to authenticated;

-- A confirmação do e-mail já entrega uma sessão autenticada. Nesta fase a
-- finalização aceita AAL1, mas nunca aceita identidade/client_id por parâmetro:
-- a solicitação é localizada somente pelo auth.uid() do JWT.
create or replace function public.customer_identity_finalize()
returns text language plpgsql security definer set search_path=public,auth as $$
declare r public.customer_identity_requests; email_ids uuid[]; phone_ids uuid[]; candidates uuid[]; target uuid; created_client uuid;
begin
  if auth.uid() is null then raise exception 'authentication_required'; end if;
  select * into r from public.customer_identity_requests where auth_user_id=auth.uid() for update;
  if r.id is null then raise exception 'identity_request_not_found'; end if;
  select coalesce(array_agg(id),'{}') into email_ids from public.clients where organization_id=r.organization_id and deleted_at is null and lower(btrim(email))=lower(btrim(r.email));
  select coalesce(array_agg(id),'{}') into phone_ids from public.clients where organization_id=r.organization_id and deleted_at is null and normalized_whatsapp=public.normalize_br_phone(r.phone);
  select array_agg(distinct x) into candidates from unnest(email_ids||phone_ids) x;
  if cardinality(email_ids)>1 or cardinality(phone_ids)>1 or (cardinality(email_ids)=1 and cardinality(phone_ids)=1 and email_ids[1]<>phone_ids[1]) then
    update public.customer_identity_requests set status='review_required',email_verified_at=coalesce(email_verified_at,now()) where id=r.id;
    insert into public.customer_identity_reviews(organization_id,request_id,auth_user_id,reason,candidate_client_ids)
      values(r.organization_id,r.id,auth.uid(),'identity_conflict',coalesce(candidates,'{}')) on conflict(request_id) do nothing;
    insert into public.audit_logs(organization_id,actor_id,action,entity_type,entity_id) values(r.organization_id,auth.uid(),'CLIENT_LINK_REVIEW_REQUIRED','customer_identity_request',r.id::text);
    return 'review_required';
  end if;
  target:=coalesce(email_ids[1],phone_ids[1]);
  if target is null then
    insert into public.clients(organization_id,name,email,phone,whatsapp_phone,status,source)
      values(r.organization_id,r.full_name,r.email,r.phone,r.phone,'active','manual') returning id into created_client;
    target:=created_client;
  end if;
  insert into public.client_accounts(organization_id,client_id,auth_user_id,status,claim_email,verified_at)
    values(r.organization_id,target,auth.uid(),'active',r.email,now());
  update public.customer_identity_requests set status='linked',email_verified_at=coalesce(email_verified_at,now()),resolved_client_id=target,resolved_at=now() where id=r.id;
  insert into public.audit_logs(organization_id,actor_id,action,entity_type,entity_id,metadata) values(r.organization_id,auth.uid(),'CLIENT_LINKED','client',target::text,jsonb_build_object('request_id',r.id,'assurance_level',coalesce(auth.jwt()->>'aal','aal1')));
  return 'linked';
exception when unique_violation then
  update public.customer_identity_requests set status='review_required' where id=r.id;
  insert into public.customer_identity_reviews(organization_id,request_id,auth_user_id,reason,candidate_client_ids)
    values(r.organization_id,r.id,auth.uid(),'unique_link_conflict',coalesce(candidates,'{}')) on conflict(request_id) do nothing;
  return 'review_required';
end;$$;
revoke all on function public.customer_identity_finalize() from public,anon;
grant execute on function public.customer_identity_finalize() to authenticated;

commit;
