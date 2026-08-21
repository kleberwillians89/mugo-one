begin;

-- Reversão razoável (manual, se necessária antes de publicar): restaurar a
-- versão anterior de customer_identity_finalize/normalize_client_contacts,
-- remover os três índices *_hardening_* e então remover normalized_email.
-- Nenhum dado comercial ou operacional é modificado por esta migration.

alter table public.clients
  add column if not exists normalized_email text;

-- Segue exatamente o padrão dos demais normalized_*: coluna materializada,
-- função trigger única e backfill preservando o valor original de email.
create or replace function public.normalize_client_contacts()
returns trigger language plpgsql set search_path=public as $$
begin
  new.normalized_phone:=public.normalize_br_phone(new.phone);
  new.normalized_whatsapp:=public.normalize_br_phone(coalesce(new.whatsapp_phone,new.phone));
  new.normalized_cpf:=public.only_digits(new.cpf);
  new.normalized_postal_code:=public.only_digits(new.postal_code);
  new.normalized_email:=nullif(lower(btrim(coalesce(new.email,''))),'');
  new.state:=nullif(upper(btrim(coalesce(new.state,''))),'');
  return new;
end;
$$;

drop trigger if exists normalize_client_contacts on public.clients;
create trigger normalize_client_contacts
before insert or update of phone,whatsapp_phone,cpf,postal_code,email,state
on public.clients for each row execute function public.normalize_client_contacts();

update public.clients
set normalized_email=nullif(lower(btrim(coalesce(email,''))),'')
where normalized_email is distinct from nullif(lower(btrim(coalesce(email,''))),'');

-- Contatos não são UNIQUE: ambiguidades devem ir para revisão humana.
create index if not exists clients_org_normalized_email_hardening_idx
  on public.clients(organization_id,normalized_email)
  where normalized_email is not null and deleted_at is null and merged_into_id is null;

create index if not exists clients_org_normalized_whatsapp_hardening_idx
  on public.clients(organization_id,normalized_whatsapp)
  where normalized_whatsapp is not null and deleted_at is null and merged_into_id is null;

-- Pré-condições explícitas: nunca apagar/fundir automaticamente para fazer a
-- constraint caber. A migration para com diagnóstico se a auditoria regredir.
do $$
begin
  if exists(
    select 1 from public.client_accounts
    where auth_user_id is not null
    group by auth_user_id having count(*)>1
  ) then raise exception 'identity_hardening_precheck: duplicate auth_user_id in client_accounts'; end if;

  if exists(
    select 1 from public.client_accounts
    group by organization_id,client_id having count(*)>1
  ) then raise exception 'identity_hardening_precheck: duplicate organization_id/client_id in client_accounts'; end if;
end;
$$;

-- O primeiro índice já existe na fundação do portal; IF NOT EXISTS preserva
-- instalações atuais e cria a defesa em ambientes que tenham schema parcial.
create unique index if not exists client_accounts_auth_user_uidx
  on public.client_accounts(auth_user_id) where auth_user_id is not null;

create unique index if not exists client_accounts_org_client_hardening_uidx
  on public.client_accounts(organization_id,client_id);

-- A resolução continua partindo exclusivamente de auth.uid(). O lock na
-- solicitação serializa duas finalizações da mesma identidade; o early return
-- torna a segunda chamada idempotente. Os UNIQUE acima são a última defesa
-- para duas identidades concorrentes tentando representar a mesma cliente.
create or replace function public.customer_identity_finalize()
returns text language plpgsql security definer set search_path=public,auth as $$
declare
  r public.customer_identity_requests;
  existing_account public.client_accounts;
  email_ids uuid[];
  phone_ids uuid[];
  candidates uuid[];
  target uuid;
  created_client uuid;
begin
  if auth.uid() is null then raise exception 'authentication_required'; end if;

  select * into r
  from public.customer_identity_requests
  where auth_user_id=auth.uid()
  for update;
  if r.id is null then raise exception 'identity_request_not_found'; end if;

  select * into existing_account
  from public.client_accounts
  where auth_user_id=auth.uid();

  if existing_account.id is not null then
    if existing_account.organization_id=r.organization_id
       and existing_account.status='active'
       and r.status='linked'
       and r.resolved_client_id=existing_account.client_id then
      return 'linked';
    end if;

    update public.customer_identity_requests
      set status='review_required',email_verified_at=coalesce(email_verified_at,now())
      where id=r.id;
    insert into public.customer_identity_reviews(organization_id,request_id,auth_user_id,reason,candidate_client_ids)
      values(r.organization_id,r.id,auth.uid(),'existing_auth_link_conflict',array[existing_account.client_id])
      on conflict(request_id) do nothing;
    return 'review_required';
  end if;

  select coalesce(array_agg(id order by id),'{}') into email_ids
  from public.clients
  where organization_id=r.organization_id
    and normalized_email=nullif(lower(btrim(r.email)),'')
    and normalized_email is not null
    and deleted_at is null
    and merged_into_id is null
    and status='active';

  select coalesce(array_agg(id order by id),'{}') into phone_ids
  from public.clients
  where organization_id=r.organization_id
    and normalized_whatsapp=public.normalize_br_phone(r.phone)
    and normalized_whatsapp is not null
    and deleted_at is null
    and merged_into_id is null
    and status='active';

  select coalesce(array_agg(distinct x order by x),'{}') into candidates
  from unnest(email_ids||phone_ids) x;

  if cardinality(email_ids)>1
     or cardinality(phone_ids)>1
     or (cardinality(email_ids)=1 and cardinality(phone_ids)=1 and email_ids[1]<>phone_ids[1]) then
    update public.customer_identity_requests
      set status='review_required',email_verified_at=coalesce(email_verified_at,now())
      where id=r.id;
    insert into public.customer_identity_reviews(organization_id,request_id,auth_user_id,reason,candidate_client_ids)
      values(r.organization_id,r.id,auth.uid(),'identity_conflict',candidates)
      on conflict(request_id) do nothing;
    insert into public.audit_logs(organization_id,actor_id,action,entity_type,entity_id)
      values(r.organization_id,auth.uid(),'CLIENT_LINK_REVIEW_REQUIRED','customer_identity_request',r.id::text);
    return 'review_required';
  end if;

  target:=coalesce(email_ids[1],phone_ids[1]);
  if target is null then
    insert into public.clients(organization_id,name,email,phone,whatsapp_phone,status,source)
      values(r.organization_id,r.full_name,r.email,r.phone,r.phone,'active','manual')
      returning id into created_client;
    target:=created_client;
  end if;

  insert into public.client_accounts(organization_id,client_id,auth_user_id,status,claim_email,verified_at)
    values(r.organization_id,target,auth.uid(),'active',r.email,now());
  update public.customer_identity_requests
    set status='linked',email_verified_at=coalesce(email_verified_at,now()),resolved_client_id=target,resolved_at=now()
    where id=r.id;
  insert into public.audit_logs(organization_id,actor_id,action,entity_type,entity_id,metadata)
    values(r.organization_id,auth.uid(),'CLIENT_LINKED','client',target::text,
      jsonb_build_object('request_id',r.id,'assurance_level',coalesce(auth.jwt()->>'aal','aal1')));
  return 'linked';
exception when unique_violation then
  update public.customer_identity_requests set status='review_required' where id=r.id;
  insert into public.customer_identity_reviews(organization_id,request_id,auth_user_id,reason,candidate_client_ids)
    values(r.organization_id,r.id,auth.uid(),'unique_link_conflict',coalesce(candidates,'{}'))
    on conflict(request_id) do nothing;
  return 'review_required';
end;
$$;

revoke all on function public.customer_identity_finalize() from public,anon;
grant execute on function public.customer_identity_finalize() to authenticated;

commit;
