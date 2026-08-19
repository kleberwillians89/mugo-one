begin;

-- RUAH — Roadmap operacional, FASE 5: delegação de tarefas.
--
-- "Onde a operação está travando?" só tem resposta completa se, além de
-- SABER o que está travado (Fase 2: vendas bloqueadas), o time souber QUEM
-- está cuidando de cada uma — senão duas pessoas resolvem a mesma coisa, ou
-- pior, ninguém resolve. inventory_bottles e o "conference_owner" dos envios
-- já provam esse padrão (reivindicar → imutável → resolver); esta fase
-- generaliza a MESMA ideia para qualquer tipo de pendência, num único lugar,
-- em vez de reinventar "quem está cuidando disso" tabela por tabela.

create table public.task_assignments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  entity_type text not null check (
    entity_type in (
      'blocked_sale',
      'waitlist_item',
      'customer_recovery'
    )
  ),
  entity_id uuid not null,
  assigned_to uuid not null references public.profiles(id),
  assigned_to_name_snapshot text not null,
  assigned_by uuid references public.profiles(id),
  assigned_at timestamptz not null default now(),
  resolved_at timestamptz,
  resolved_by uuid references public.profiles(id),
  notes text
);

create index task_assignments_org_entity_idx
  on public.task_assignments(
    organization_id,
    entity_type,
    entity_id
  );

-- Só uma atribuição ATIVA por entidade.
create unique index task_assignments_active_entity_uidx
  on public.task_assignments(
    organization_id,
    entity_type,
    entity_id
  )
  where resolved_at is null;

alter table public.task_assignments enable row level security;

create policy task_assignments_select
  on public.task_assignments
  for select
  using (
    organization_id in (
      select public.current_user_org_ids()
    )
  );

revoke insert, update, delete
  on public.task_assignments
  from authenticated;

create or replace function public.task_assign(
  p_entity_type text,
  p_entity_id uuid,
  p_assigned_to uuid default null
)
returns public.task_assignments
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org uuid;
  v_target uuid;
  v_name text;
  v_existing public.task_assignments;
  v_row public.task_assignments;
begin
  select organization_id
    into v_org
  from public.organization_members
  where user_id = auth.uid()
  limit 1;

  if v_org is null then
    raise exception 'forbidden';
  end if;

  if not public.has_org_role(
    v_org,
    array['admin','manager','operator']::public.member_role[]
  ) then
    raise exception 'forbidden';
  end if;

  v_target := coalesce(p_assigned_to, auth.uid());

  -- Só admin/manager podem atribuir a outra pessoa.
  -- Operator só pode reivindicar para si.
  if v_target <> auth.uid()
     and not public.has_org_role(
       v_org,
       array['admin','manager']::public.member_role[]
     ) then
    raise exception 'forbidden';
  end if;

  if not exists (
    select 1
    from public.organization_members
    where organization_id = v_org
      and user_id = v_target
  ) then
    raise exception 'assignee_not_in_organization';
  end if;

  select *
    into v_existing
  from public.task_assignments
  where organization_id = v_org
    and entity_type = p_entity_type
    and entity_id = p_entity_id
    and resolved_at is null;

  if v_existing.id is not null then
    if v_existing.assigned_to = v_target then
      return v_existing;
    end if;

    raise exception 'already_assigned_to_someone_else';
  end if;

  select coalesce(
    nullif(btrim(full_name), ''),
    'Usuário RUAH'
  )
    into v_name
  from public.profiles
  where id = v_target;

  insert into public.task_assignments (
    organization_id,
    entity_type,
    entity_id,
    assigned_to,
    assigned_to_name_snapshot,
    assigned_by
  )
  values (
    v_org,
    p_entity_type,
    p_entity_id,
    v_target,
    coalesce(v_name, 'Usuário RUAH'),
    auth.uid()
  )
  returning *
    into v_row;

  insert into public.audit_logs (
    organization_id,
    actor_id,
    action,
    entity_type,
    entity_id,
    metadata
  )
  values (
    v_org,
    auth.uid(),
    'task_assigned',
    p_entity_type,
    p_entity_id::text,
    jsonb_build_object(
      'assigned_to', v_target,
      'assignment_id', v_row.id
    )
  );

  return v_row;
end;
$$;

grant execute
  on function public.task_assign(text, uuid, uuid)
  to authenticated, service_role;


create or replace function public.task_resolve(
  p_assignment_id uuid,
  p_notes text default null
)
returns public.task_assignments
language plpgsql
security definer
set search_path = public
as $$
declare
  v public.task_assignments;
begin
  select *
    into v
  from public.task_assignments
  where id = p_assignment_id
  for update;

  if v.id is null
     or v.organization_id not in (
       select public.current_user_org_ids()
     ) then
    raise exception 'task_not_found';
  end if;

  if v.resolved_at is not null then
    return v;
  end if;

  if v.assigned_to <> auth.uid()
     and not public.has_org_role(
       v.organization_id,
       array['admin','manager']::public.member_role[]
     ) then
    raise exception 'forbidden';
  end if;

  update public.task_assignments
  set
    resolved_at = now(),
    resolved_by = auth.uid(),
    notes = coalesce(
      nullif(btrim(p_notes), ''),
      notes
    )
  where id = v.id
  returning *
    into v;

  insert into public.audit_logs (
    organization_id,
    actor_id,
    action,
    entity_type,
    entity_id,
    metadata
  )
  values (
    v.organization_id,
    auth.uid(),
    'task_resolved',
    v.entity_type,
    v.entity_id::text,
    jsonb_build_object(
      'assignment_id', v.id
    )
  );

  return v;
end;
$$;

grant execute
  on function public.task_resolve(uuid, text)
  to authenticated, service_role;


-- A Fase 2 já criou sales_validation_queue(uuid) com outro RETURNS TABLE.
-- PostgreSQL não permite alterar o tipo de retorno via CREATE OR REPLACE.
-- Como 202608190003 ainda não foi aplicada remotamente, podemos remover
-- a versão anterior e recriar a função com as colunas de atribuição.
drop function if exists public.sales_validation_queue(uuid);

-- "true replace" da Fase 2:
-- mesma consulta, agora acrescentando quem já assumiu
-- cada venda bloqueada.
create or replace function public.sales_validation_queue(
  org_id uuid
)
returns table(
  sale_id uuid,
  client_id uuid,
  client_name text,
  sale_date date,
  amount numeric,
  payment_status text,
  perfume_name text,
  volume_ml numeric,
  blocking_reasons text[],
  assignment_id uuid,
  assigned_to_name text
)
language sql
stable
security invoker
set search_path = public
as $$
  with base as (
    select
      s.id as sale_id,
      s.client_id,
      coalesce(
        c.name,
        s.original_client,
        'Cliente não identificado'
      ) as client_name,
      s.sale_date,
      s.amount,
      s.payment_status::text as payment_status,
      s.perfume_name_raw as perfume_name,
      s.volume_ml,
      array_remove(
        array[
          case
            when s.perfume_id is null
            then 'perfume_nao_identificado'
          end,
          case
            when s.volume_ml is null
              or s.volume_ml <= 0
            then 'volume_nao_informado'
          end,
          case
            when s.payment_status = 'unknown'
            then 'pagamento_nao_identificado'
          end,
          case
            when c.id is not null
             and (
               (c.phone is null and c.whatsapp_phone is null)
               or c.postal_code is null
               or c.address_line is null
               or c.address_number is null
               or c.district is null
               or c.city is null
               or c.state is null
               or (c.cpf is null and c.cnpj is null)
             )
            then 'cadastro_cliente_incompleto'
          end
        ],
        null
      ) as blocking_reasons
    from public.sales s
    left join public.clients c
      on c.id = s.client_id
    where s.organization_id = org_id
      and s.deleted_at is null
      and s.payment_status in ('paid', 'pending')
      and s.shipped_at is null
  )
  select
    base.sale_id,
    base.client_id,
    base.client_name,
    base.sale_date,
    base.amount,
    base.payment_status,
    base.perfume_name,
    base.volume_ml,
    base.blocking_reasons,
    ta.id as assignment_id,
    ta.assigned_to_name_snapshot as assigned_to_name
  from base
  left join public.task_assignments ta
    on ta.organization_id = org_id
   and ta.entity_type = 'blocked_sale'
   and ta.entity_id = base.sale_id
   and ta.resolved_at is null
  where array_length(base.blocking_reasons, 1) > 0
  order by base.sale_date;
$$;

grant execute
  on function public.sales_validation_queue(uuid)
  to authenticated, service_role;

commit;