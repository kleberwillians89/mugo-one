begin;

-- Validação de runtime com uma identidade administrativa já existente.
-- Não grava dados operacionais; a migration só é confirmada se a RPC
-- conseguir montar o payload completo da Home no banco de produção.
do $$
declare
  v_user_id uuid:='3f34fe2b-87c4-466c-8f4c-71400efa8fed'::uuid;
  v_org_id uuid;
  v_payload jsonb;
begin
  select organization_id into v_org_id
  from public.organization_members
  where user_id=v_user_id and status='active'
  limit 1;
  if v_org_id is null then raise exception 'dashboard_validation_identity_not_found'; end if;

  perform set_config('request.jwt.claim.sub',v_user_id::text,true);
  perform set_config('request.jwt.claims',jsonb_build_object('sub',v_user_id,'role','authenticated')::text,true);
  v_payload:=public.dashboard_summary(v_org_id,'today',null,null);
  if v_payload is null or not(v_payload?'metrics') then raise exception 'dashboard_validation_empty_payload'; end if;
end;$$;

commit;
