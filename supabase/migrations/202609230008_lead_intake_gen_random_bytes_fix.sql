begin;

-- ============================================================
-- MUGÔ ONE — Sprint M (Lead Intake + Source + Touchpoints + Dedupe)
--
-- gen_random_bytes vive no schema "extensions" (pgcrypto), não em
-- "public" — achado ao vivo durante o smoke test desta sprint:
-- rotate_lead_intake_endpoint_key (SECURITY DEFINER, search_path
-- fixado em "public") falhava com "function gen_random_bytes does not
-- exist" porque a chamada não estava qualificada. O default da coluna
-- em lead_intake_endpoints tinha o mesmo risco (funciona só quando a
-- sessão que faz o INSERT já tem "extensions" no search_path, o que
-- não é garantido dentro de outra função SECURITY DEFINER). Corrigido
-- qualificando extensions.gen_random_bytes nos dois lugares — aditivo,
-- sem reescrever a migration original.
-- ============================================================

alter table public.lead_intake_endpoints
  alter column public_key set default encode(extensions.gen_random_bytes(32), 'hex');

create or replace function public.rotate_lead_intake_endpoint_key(p_endpoint_id uuid)
returns public.lead_intake_endpoints
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.lead_intake_endpoints;
begin
  select * into v_row from public.lead_intake_endpoints where id = p_endpoint_id;
  if not found then
    raise exception 'endpoint_not_found';
  end if;
  if not public.has_org_permission(v_row.organization_id, 'lead_intake.manage') then
    raise exception 'permission_denied' using errcode = '42501';
  end if;

  update public.lead_intake_endpoints
  set public_key = encode(extensions.gen_random_bytes(32), 'hex')
  where id = p_endpoint_id
  returning * into v_row;

  insert into public.audit_logs (organization_id, actor_id, action, entity_type, entity_id, metadata)
  values (v_row.organization_id, auth.uid(), 'lead_intake_endpoint_key_rotated', 'lead_intake_endpoint', v_row.id::text,
    jsonb_build_object('name', v_row.name));

  return v_row;
end;
$$;

commit;
