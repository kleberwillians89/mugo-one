begin;

-- ==========================================================================
-- FIX — public.has_org_permission(org_id, permission_code) lançava
-- "column reference permission_code is ambiguous" para QUALQUER usuário sem
-- access_total/view_all checando uma permissão granular explícita (ex.:
-- sales.edit, inventory.adjust, clients.edit, cost_margin.edit — qualquer
-- código que não termine em ".view"). A query final da função comparava
-- "permission_code = has_org_permission.permission_code": o lado direito
-- estava corretamente qualificado, mas o ESQUERDO ficava sem qualificação e
-- colide com o parâmetro de mesmo nome sob plpgsql.variable_conflict=error
-- (padrão do Postgres) — dando erro em runtime em vez de aplicar a regra.
-- Descoberto ao testar localmente as novas RPCs de split_status (que
-- dependem desta função para 'sales.edit'), não por um bug relatado — mas
-- como o mesmo has_org_permission gate toda escrita não-owner/admin do CRM,
-- o alcance da correção é maior que esta única feature.
-- Mesma assinatura (org_id uuid, texto) — CREATE OR REPLACE não quebra
-- nenhum call site (todas as chamadas no código são posicionais).
-- ==========================================================================
create or replace function public.has_org_permission(org_id uuid, permission_code text)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_member public.organization_members;
  v_override boolean;
  p_code text := permission_code;
begin
  select * into v_member
  from public.organization_members
  where organization_id = org_id and user_id = auth.uid();

  if not found or v_member.status <> 'active' then
    return false;
  end if;

  if v_member.access_total then
    return true;
  end if;

  if v_member.view_all
     and p_code like '%.view'
     and p_code not in ('team.view', 'audit.view') then
    return true;
  end if;

  select granted into v_override
  from public.organization_member_permissions omp
  where omp.organization_id = has_org_permission.org_id and omp.user_id = auth.uid()
    and omp.permission_code = p_code;

  if found then
    return v_override;
  end if;

  return false;
end;
$$;
grant execute on function public.has_org_permission(uuid, text) to authenticated, service_role;

commit;
