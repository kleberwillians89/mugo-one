begin;

create table public.customer_identity_requests(
  id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id),
  auth_user_id uuid not null references auth.users(id) on delete cascade, full_name text not null,
  email text not null, phone text not null, status text not null default 'email_pending'
    check(status in('email_pending','mfa_pending','review_required','linked','rejected')),
  created_at timestamptz not null default now(), email_verified_at timestamptz, mfa_verified_at timestamptz,
  resolved_client_id uuid references public.clients(id), resolved_at timestamptz,
  unique(auth_user_id)
);
alter table public.customer_identity_requests enable row level security;

create table public.customer_identity_reviews(
  id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id),
  request_id uuid not null unique references public.customer_identity_requests(id) on delete cascade,
  auth_user_id uuid not null references auth.users(id) on delete cascade, reason text not null,
  candidate_client_ids uuid[] not null default '{}', status text not null default 'pending'
    check(status in('pending','linked','created','rejected')), decided_by uuid references auth.users(id),
  decided_at timestamptz, created_at timestamptz not null default now()
);
alter table public.customer_identity_reviews enable row level security;
create policy customer_identity_reviews_staff_select on public.customer_identity_reviews for select
  using(organization_id in(select public.current_user_org_ids()));

-- Portal privado exige MFA em cada chamada, não apenas na interface.
create or replace function public.current_customer_client()
returns uuid language sql stable security definer set search_path=public as $$
  select client_id from public.client_accounts
  where auth_user_id=auth.uid() and status='active' and coalesce(auth.jwt()->>'aal','aal1')='aal2';
$$;

-- Executado somente pela própria conta autenticada, após MFA nativo.
create or replace function public.customer_identity_finalize()
returns text language plpgsql security definer set search_path=public,auth as $$
declare r public.customer_identity_requests; email_ids uuid[]; phone_ids uuid[]; candidates uuid[]; target uuid; created_client uuid;
begin
  if auth.uid() is null or coalesce(auth.jwt()->>'aal','aal1')<>'aal2' then raise exception 'mfa_required'; end if;
  select * into r from public.customer_identity_requests where auth_user_id=auth.uid() for update;
  if r.id is null then raise exception 'identity_request_not_found'; end if;
  select coalesce(array_agg(id),'{}') into email_ids from public.clients where organization_id=r.organization_id and deleted_at is null and lower(btrim(email))=lower(btrim(r.email));
  select coalesce(array_agg(id),'{}') into phone_ids from public.clients where organization_id=r.organization_id and deleted_at is null and normalized_whatsapp=public.normalize_br_phone(r.phone);
  select array_agg(distinct x) into candidates from unnest(email_ids||phone_ids) x;
  if cardinality(email_ids)>1 or cardinality(phone_ids)>1 or (cardinality(email_ids)=1 and cardinality(phone_ids)=1 and email_ids[1]<>phone_ids[1]) then
    update public.customer_identity_requests set status='review_required',email_verified_at=coalesce(email_verified_at,now()),mfa_verified_at=now() where id=r.id;
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
  update public.customer_identity_requests set status='linked',email_verified_at=coalesce(email_verified_at,now()),mfa_verified_at=now(),resolved_client_id=target,resolved_at=now() where id=r.id;
  insert into public.audit_logs(organization_id,actor_id,action,entity_type,entity_id,metadata) values(r.organization_id,auth.uid(),'CLIENT_LINKED','client',target::text,jsonb_build_object('request_id',r.id));
  return 'linked';
exception when unique_violation then
  update public.customer_identity_requests set status='review_required' where id=r.id;
  insert into public.customer_identity_reviews(organization_id,request_id,auth_user_id,reason,candidate_client_ids)
    values(r.organization_id,r.id,auth.uid(),'unique_link_conflict',coalesce(candidates,'{}')) on conflict(request_id) do nothing;
  return 'review_required';
end;$$;
revoke all on function public.customer_identity_finalize() from public,anon;
grant execute on function public.customer_identity_finalize() to authenticated;

create or replace function public.customer_identity_reviews_list()
returns table(id uuid,request_id uuid,full_name text,email text,phone text,reason text,candidate_client_ids uuid[],created_at timestamptz)
language sql stable security definer set search_path=public as $$
  select rv.id,rv.request_id,r.full_name,r.email,r.phone,rv.reason,rv.candidate_client_ids,rv.created_at
  from public.customer_identity_reviews rv join public.customer_identity_requests r on r.id=rv.request_id
  where rv.status='pending' and public.has_org_role(rv.organization_id,array['admin','manager']::public.member_role[])
  order by rv.created_at;
$$;
grant execute on function public.customer_identity_reviews_list() to authenticated;

create or replace function public.customer_identity_review_decide(p_review_id uuid,p_action text,p_client_id uuid default null)
returns text language plpgsql security definer set search_path=public as $$
declare rv public.customer_identity_reviews;r public.customer_identity_requests;target uuid;
begin
  select * into rv from public.customer_identity_reviews where id=p_review_id and status='pending' for update;
  if rv.id is null or not public.has_org_role(rv.organization_id,array['admin','manager']::public.member_role[]) then raise exception 'forbidden';end if;
  select * into r from public.customer_identity_requests where id=rv.request_id for update;
  if p_action='reject' then
    update public.customer_identity_reviews set status='rejected',decided_by=auth.uid(),decided_at=now() where id=rv.id;
    update public.customer_identity_requests set status='rejected',resolved_at=now() where id=r.id;
    insert into public.audit_logs(organization_id,actor_id,action,entity_type,entity_id)values(rv.organization_id,auth.uid(),'CLIENT_LINK_REJECTED','customer_identity_request',r.id::text);return 'rejected';
  elsif p_action='link' then
    select id into target from public.clients where id=p_client_id and organization_id=rv.organization_id and deleted_at is null;
    if target is null then raise exception 'invalid_client';end if;
  elsif p_action='create' then
    insert into public.clients(organization_id,name,email,phone,whatsapp_phone,status,source)values(rv.organization_id,r.full_name,r.email,r.phone,r.phone,'active','manual')returning id into target;
  else raise exception 'invalid_action';end if;
  insert into public.client_accounts(organization_id,client_id,auth_user_id,status,claim_email,verified_at)values(rv.organization_id,target,r.auth_user_id,'active',r.email,now());
  update public.customer_identity_reviews set status=case when p_action='create' then 'created' else 'linked' end,decided_by=auth.uid(),decided_at=now() where id=rv.id;
  update public.customer_identity_requests set status='linked',resolved_client_id=target,resolved_at=now() where id=r.id;
  insert into public.audit_logs(organization_id,actor_id,action,entity_type,entity_id,metadata)values(rv.organization_id,auth.uid(),'CLIENT_LINKED_BY_STAFF','client',target::text,jsonb_build_object('request_id',r.id,'decision',p_action));return 'linked';
end;$$;
revoke all on function public.customer_identity_review_decide(uuid,text,uuid) from public,anon;
grant execute on function public.customer_identity_review_decide(uuid,text,uuid) to authenticated;

commit;
