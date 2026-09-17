begin;

-- ============================================================
-- MUGÔ ONE — Sprint N (Communication Hub Universal)
--
-- Amplia entity_belongs_to_organization/activities.entity_type com o
-- case 'conversation' NA MESMA migration que introduz o primeiro
-- log_activity(..., 'conversation', ...) — lição da Sprint E/F e K/L
-- (activities.entity_type é uma constraint separada de
-- entity_belongs_to_organization, sempre esquecida se não feita junto).
-- ============================================================

create or replace function public.entity_belongs_to_organization(p_entity_type text, p_entity_id uuid, p_organization_id uuid)
returns boolean
language plpgsql
stable security definer
set search_path = public
as $$
declare
  v_found boolean;
begin
  case p_entity_type
    when 'customer' then
      select exists(select 1 from public.clients where id = p_entity_id and organization_id = p_organization_id)
        into v_found;
    when 'company' then
      select exists(select 1 from public.companies where id = p_entity_id and organization_id = p_organization_id)
        into v_found;
    when 'contact' then
      select exists(select 1 from public.contacts where id = p_entity_id and organization_id = p_organization_id)
        into v_found;
    when 'lead' then
      select exists(select 1 from public.leads where id = p_entity_id and organization_id = p_organization_id)
        into v_found;
    when 'deal' then
      select exists(select 1 from public.deals where id = p_entity_id and organization_id = p_organization_id)
        into v_found;
    when 'sale' then
      select exists(select 1 from public.sales where id = p_entity_id and organization_id = p_organization_id)
        into v_found;
    when 'catalog_item' then
      select exists(select 1 from public.catalog_items where id = p_entity_id and organization_id = p_organization_id)
        into v_found;
    when 'task' then
      select exists(select 1 from public.tasks where id = p_entity_id and organization_id = p_organization_id and deleted_at is null)
        into v_found;
    when 'conversation' then
      select exists(select 1 from public.conversations where id = p_entity_id and organization_id = p_organization_id)
        into v_found;
    else
      v_found := false;
  end case;
  return coalesce(v_found, false);
end;
$$;

alter table public.activities drop constraint if exists activities_entity_type_check;
alter table public.activities add constraint activities_entity_type_check
  check (entity_type in ('customer', 'company', 'contact', 'lead', 'deal', 'sale', 'catalog_item', 'task', 'conversation'));

-- ============================================================
-- Task Engine: create_task ganha p_metadata opcional (não um novo
-- entity_type) — tasks.metadata já existe desde a Sprint K/L mas
-- create_task() não o expunha. Usado por "Criar tarefa" a partir de
-- uma conversa, carregando conversation_id em metadata sem abrir
-- entity_type='conversation' em tasks (briefing §29 pede
-- explicitamente para não fazer isso sem avaliar).
-- ============================================================

create or replace function public.create_task(
  p_organization_id uuid,
  p_title text,
  p_description text default null,
  p_priority text default 'normal',
  p_assignee_user_id uuid default null,
  p_due_at timestamptz default null,
  p_entity_type text default null,
  p_entity_id uuid default null,
  p_metadata jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_task_id uuid;
  v_actor uuid := auth.uid();
begin
  if not public.has_org_permission(p_organization_id, 'tasks.create') then
    raise exception 'forbidden';
  end if;
  if coalesce(btrim(p_title), '') = '' then
    raise exception 'task_title_required';
  end if;

  insert into public.tasks (
    organization_id, title, description, priority, assignee_user_id,
    due_at, entity_type, entity_id, created_by_user_id, metadata
  ) values (
    p_organization_id, btrim(p_title), nullif(btrim(coalesce(p_description, '')), ''), p_priority, p_assignee_user_id,
    p_due_at, p_entity_type, p_entity_id, v_actor, coalesce(p_metadata, '{}'::jsonb)
  ) returning id into v_task_id;

  perform public.log_activity(
    p_organization_id, 'task', v_task_id, 'task_created', v_actor,
    'Tarefa criada', p_title,
    jsonb_build_object('priority', p_priority, 'assignee_user_id', p_assignee_user_id)
  );

  return jsonb_build_object('task_id', v_task_id);
end;
$$;

-- ============================================================
-- resolve_or_create_conversation: usada internamente por
-- send_communication_message e simulate_inbound_message — evita
-- duplicar a lógica de "achar ou criar" entre envio real e simulação
-- QA. Não concedida diretamente a authenticated/anon (só chamável de
-- dentro de outra função SECURITY DEFINER).
-- ============================================================

create or replace function public.resolve_or_create_conversation(
  p_organization_id uuid,
  p_channel text,
  p_customer_id uuid,
  p_company_id uuid,
  p_contact_id uuid,
  p_lead_id uuid,
  p_connection_id uuid,
  p_subject text,
  p_conversation_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_conversation public.conversations;
  v_is_new boolean := false;
begin
  if p_conversation_id is not null then
    select * into v_conversation from public.conversations
    where id = p_conversation_id and organization_id = p_organization_id;
    if not found then
      raise exception 'conversation_not_found';
    end if;
    return jsonb_build_object('conversation_id', v_conversation.id, 'is_new', false);
  end if;

  select * into v_conversation from public.conversations
  where organization_id = p_organization_id
    and channel = p_channel
    and status in ('open', 'pending')
    and customer_id is not distinct from p_customer_id
    and company_id is not distinct from p_company_id
    and contact_id is not distinct from p_contact_id
    and lead_id is not distinct from p_lead_id
  order by updated_at desc
  limit 1;

  if found then
    return jsonb_build_object('conversation_id', v_conversation.id, 'is_new', false);
  end if;

  insert into public.conversations (
    organization_id, channel, customer_id, company_id, contact_id, lead_id, connection_id, subject
  ) values (
    p_organization_id, p_channel, p_customer_id, p_company_id, p_contact_id, p_lead_id, p_connection_id, p_subject
  ) returning * into v_conversation;
  v_is_new := true;

  perform public.log_activity(
    p_organization_id, 'conversation', v_conversation.id, 'conversation_started', auth.uid(),
    'Conversa iniciada', p_subject,
    jsonb_build_object('channel', p_channel)
  );

  return jsonb_build_object('conversation_id', v_conversation.id, 'is_new', v_is_new);
end;
$$;

revoke execute on function public.resolve_or_create_conversation(uuid, text, uuid, uuid, uuid, uuid, uuid, text, uuid) from public, anon, authenticated;

commit;
