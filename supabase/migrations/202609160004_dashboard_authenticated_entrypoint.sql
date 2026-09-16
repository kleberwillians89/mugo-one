begin;

-- Entrada RPC pequena e sem organization_id controlado pelo navegador.
-- Resolve o tenant exclusivamente pela sessão autenticada e delega todo o
-- cálculo para dashboard_summary, já validado para os perfis reais.
create or replace function public.dashboard_home_summary(
  p_period text default 'today',
  p_start_date date default null,
  p_end_date date default null
) returns jsonb
language plpgsql stable security definer set search_path=public as $$
declare
  v_org_id uuid;
begin
  if auth.uid() is null then raise exception 'authentication_required'; end if;
  select om.organization_id into v_org_id
  from public.organization_members om
  where om.user_id=auth.uid() and om.status='active'
  order by om.created_at,om.organization_id
  limit 1;
  if v_org_id is null then raise exception 'organization_access_denied'; end if;
  return public.dashboard_summary(v_org_id,p_period,p_start_date,p_end_date);
end;$$;

revoke all on function public.dashboard_home_summary(text,date,date) from public,anon;
grant execute on function public.dashboard_home_summary(text,date,date) to authenticated,service_role;

-- Valida pelo mesmo papel usado pelo PostgREST, não como dono do banco.
select set_config('request.jwt.claim.sub','3f34fe2b-87c4-466c-8f4c-71400efa8fed',true);
select set_config('request.jwt.claims','{"sub":"3f34fe2b-87c4-466c-8f4c-71400efa8fed","role":"authenticated"}',true);
set local role authenticated;
do $$
declare payload jsonb;
begin
  payload:=public.dashboard_home_summary('30d',null,null);
  if payload is null or not(payload?'metrics') then raise exception 'dashboard_authenticated_validation_failed'; end if;
end;$$;
reset role;

notify pgrst,'reload schema';
commit;
