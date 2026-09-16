begin;

-- Reproduz a chamada exata da Home (wrapper sem organization_id) para cada
-- membro ativo e cada período. Não altera dados; aborta com usuário/perfil e
-- erro original caso qualquer combinação falhe.
do $$
declare
  member record;
  period_key text;
  payload jsonb;
begin
  for member in
    select user_id,permission_preset
    from public.organization_members
    where status='active'
  loop
    perform set_config('request.jwt.claim.sub',member.user_id::text,true);
    perform set_config('request.jwt.claims',jsonb_build_object('sub',member.user_id,'role','authenticated')::text,true);
    foreach period_key in array array['last_hour','today','24h','7d','30d'] loop
      begin
        payload:=public.dashboard_home_summary(period_key,null,null);
        if payload is null or not(payload?'metrics') then raise exception 'empty_payload'; end if;
      exception when others then
        raise exception 'dashboard_entrypoint_failed user=% preset=% period=% error=%',member.user_id,member.permission_preset,period_key,sqlerrm;
      end;
    end loop;
  end loop;
end;
$$;

commit;
