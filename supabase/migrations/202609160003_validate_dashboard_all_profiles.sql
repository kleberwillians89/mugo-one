begin;

-- Exercita a RPC com cada conjunto real de permissões e todas as janelas,
-- sem persistir qualquer mudança operacional.
do $$
declare
  member record;
  period_key text;
  payload jsonb;
begin
  for member in
    select organization_id,user_id,permission_preset
    from public.organization_members where status='active'
  loop
    perform set_config('request.jwt.claim.sub',member.user_id::text,true);
    perform set_config('request.jwt.claims',jsonb_build_object('sub',member.user_id,'role','authenticated')::text,true);
    foreach period_key in array array['last_hour','today','24h','7d','30d'] loop
      begin
        payload:=public.dashboard_summary(member.organization_id,period_key,null,null);
        if payload is null or not(payload?'metrics') then raise exception 'empty_payload'; end if;
      exception when others then
        raise exception 'dashboard_validation_failed user=% preset=% period=% error=%',member.user_id,member.permission_preset,period_key,sqlerrm;
      end;
    end loop;
  end loop;
end;$$;

commit;
