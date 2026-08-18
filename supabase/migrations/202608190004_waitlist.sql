begin;

-- RUAH — Roadmap operacional, FASE 6: lista de espera.
--
-- "Quem está esperando perfume?" — hoje essa informação só existe na
-- memória de quem atende (Davi) ou numa planilha paralela. Tabela nova
-- (não existe nenhum conceito equivalente hoje — radar_watchlist é sobre
-- OPORTUNIDADE DE COMPRA, não interesse de cliente), mas deliberadamente
-- pequena: um pedido de espera por cliente+perfume, com status explícito.
-- "Pronto para avisar" nunca é armazenado — é sempre calculado ao vivo
-- comparando com o estoque disponível atual, para nunca desatualizar.
create type public.waitlist_status as enum ('waiting','notified','fulfilled','cancelled');

create table public.waitlist_entries (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  client_id uuid not null references public.clients(id),
  perfume_id uuid not null references public.perfumes(id),
  requested_ml numeric(14,3) not null check(requested_ml>0),
  notes text,
  status public.waitlist_status not null default 'waiting',
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  notified_at timestamptz,
  notified_by uuid references public.profiles(id),
  fulfilled_at timestamptz,
  fulfilled_sale_id uuid references public.sales(id)
);
create index waitlist_entries_org_status_idx on public.waitlist_entries(organization_id,status);
create index waitlist_entries_perfume_idx on public.waitlist_entries(perfume_id) where status='waiting';
-- Evita o mesmo cliente entrar duas vezes na fila do mesmo perfume enquanto
-- o primeiro pedido ainda está em aberto.
create unique index waitlist_entries_active_uidx
  on public.waitlist_entries(organization_id,client_id,perfume_id) where status in('waiting','notified');

alter table public.waitlist_entries enable row level security;
create policy waitlist_entries_select on public.waitlist_entries for select
  using(organization_id in(select public.current_user_org_ids()));
create policy waitlist_entries_write on public.waitlist_entries for all
  using(public.has_org_role(organization_id,array['admin','manager','operator']::public.member_role[]))
  with check(public.has_org_role(organization_id,array['admin','manager','operator']::public.member_role[]));

create or replace function public.waitlist_add(p_client_id uuid,p_perfume_id uuid,p_requested_ml numeric,p_notes text default null)
returns public.waitlist_entries
language plpgsql security definer set search_path=public
as $$
declare v_org uuid; v_existing public.waitlist_entries; v_row public.waitlist_entries;
begin
  select organization_id into v_org from public.clients where id=p_client_id;
  if v_org is null or v_org not in(select public.current_user_org_ids()) then raise exception 'client_not_found'; end if;
  if not public.has_org_role(v_org,array['admin','manager','operator']::public.member_role[]) then raise exception 'forbidden'; end if;
  if not exists(select 1 from public.perfumes where id=p_perfume_id and organization_id=v_org) then raise exception 'perfume_not_found'; end if;
  if p_requested_ml is null or p_requested_ml<=0 then raise exception 'invalid_requested_amount'; end if;

  select * into v_existing from public.waitlist_entries
    where organization_id=v_org and client_id=p_client_id and perfume_id=p_perfume_id and status in('waiting','notified');
  if v_existing.id is not null then return v_existing; end if;

  insert into public.waitlist_entries(organization_id,client_id,perfume_id,requested_ml,notes,created_by)
  values(v_org,p_client_id,p_perfume_id,p_requested_ml,nullif(btrim(p_notes),''),auth.uid())
  returning * into v_row;
  insert into public.audit_logs(organization_id,actor_id,action,entity_type,entity_id,metadata)
  values(v_org,auth.uid(),'waitlist_entry_added','waitlist_entry',v_row.id::text,jsonb_build_object('client_id',p_client_id,'perfume_id',p_perfume_id,'requested_ml',p_requested_ml));
  return v_row;
end;
$$;
grant execute on function public.waitlist_add(uuid,uuid,numeric,text) to authenticated,service_role;

create or replace function public.waitlist_set_status(p_entry_id uuid,p_status public.waitlist_status,p_sale_id uuid default null)
returns public.waitlist_entries
language plpgsql security definer set search_path=public
as $$
declare v public.waitlist_entries;
begin
  select * into v from public.waitlist_entries where id=p_entry_id for update;
  if v.id is null or v.organization_id not in(select public.current_user_org_ids()) then raise exception 'waitlist_entry_not_found'; end if;
  if not public.has_org_role(v.organization_id,array['admin','manager','operator']::public.member_role[]) then raise exception 'forbidden'; end if;
  if v.status in('fulfilled','cancelled') then raise exception 'waitlist_entry_already_closed'; end if;
  update public.waitlist_entries set
    status=p_status,updated_at=now(),
    notified_at=case when p_status='notified' then coalesce(notified_at,now()) else notified_at end,
    notified_by=case when p_status='notified' then coalesce(notified_by,auth.uid()) else notified_by end,
    fulfilled_at=case when p_status='fulfilled' then now() else fulfilled_at end,
    fulfilled_sale_id=case when p_status='fulfilled' then p_sale_id else fulfilled_sale_id end
  where id=v.id returning * into v;
  insert into public.audit_logs(organization_id,actor_id,action,entity_type,entity_id,metadata)
  values(v.organization_id,auth.uid(),'waitlist_status_changed','waitlist_entry',v.id::text,jsonb_build_object('status',p_status));
  return v;
end;
$$;
grant execute on function public.waitlist_set_status(uuid,public.waitlist_status,uuid) to authenticated,service_role;

-- Leitura: junta com o estoque agregado ATUAL — "pronto" nunca é um campo
-- gravado, é sempre o resultado de comparar com o disponível de agora.
create or replace function public.waitlist_queue(org_id uuid)
returns table(
  entry_id uuid,client_id uuid,client_name text,perfume_id uuid,perfume_name text,brand_house text,
  requested_ml numeric,status text,created_at timestamptz,notes text,available_ml numeric,ready boolean
) language sql stable security invoker set search_path=public
as $$
  select w.id,w.client_id,c.name,w.perfume_id,p.base_name,p.brand_house,w.requested_ml,w.status::text,w.created_at,w.notes,
    coalesce(i.available_ml,0),coalesce(i.available_ml,0)>=w.requested_ml
  from public.waitlist_entries w
  join public.clients c on c.id=w.client_id
  join public.perfumes p on p.id=w.perfume_id
  left join public.inventory_items i on i.organization_id=w.organization_id and i.perfume_id=w.perfume_id and i.status='active'
  where w.organization_id=org_id and w.status in('waiting','notified')
  order by (coalesce(i.available_ml,0)>=w.requested_ml) desc,w.created_at;
$$;
grant execute on function public.waitlist_queue(uuid) to authenticated,service_role;

commit;
