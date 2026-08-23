begin;

create table public.inventory_purchase_entries(
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id),
  perfume_id uuid not null references public.perfumes(id),
  inventory_item_id uuid not null references public.inventory_items(id),
  inventory_movement_id uuid not null references public.inventory_movements(id),
  source_file text,
  source_hash text not null,
  source_row integer not null,
  quantity_units integer not null check(quantity_units>0),
  bottle_volume_ml numeric(14,3) not null check(bottle_volume_ml>0),
  total_volume_ml numeric(14,3) not null check(total_volume_ml>0),
  unit_price_original numeric(14,4),
  currency text check(currency is null or currency in('GBP','EUR','BRL')),
  exchange_rate_brl numeric(14,6),
  unit_price_brl numeric(14,4),
  total_cost_brl numeric(16,4),
  supplier text,
  purchase_date date,
  cost_status text not null default 'known' check(cost_status in('known','pending','zero_review')),
  raw_data jsonb not null default '{}'::jsonb,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  unique(organization_id,source_hash,source_row),
  unique(inventory_movement_id),
  check(total_volume_ml=quantity_units*bottle_volume_ml),
  check(
    cost_status<>'known' or (
      unit_price_original is not null and unit_price_original>=0
      and currency is not null
      and unit_price_brl is not null and unit_price_brl>=0
      and total_cost_brl is not null and total_cost_brl>=0
      and (currency='BRL' or (exchange_rate_brl is not null and exchange_rate_brl>0))
    )
  )
);

create index inventory_purchase_entries_org_idx
  on public.inventory_purchase_entries(organization_id);
create index inventory_purchase_entries_org_perfume_idx
  on public.inventory_purchase_entries(organization_id,perfume_id);
create index inventory_purchase_entries_org_item_idx
  on public.inventory_purchase_entries(organization_id,inventory_item_id);
create index inventory_purchase_entries_org_movement_idx
  on public.inventory_purchase_entries(organization_id,inventory_movement_id);
create index inventory_purchase_entries_org_created_idx
  on public.inventory_purchase_entries(organization_id,created_at desc);

create function public.inventory_purchase_entry_validate_scope()
returns trigger
language plpgsql
security definer
set search_path=public
as $$
declare item public.inventory_items; movement public.inventory_movements;
begin
  select * into item from public.inventory_items
  where id=new.inventory_item_id and organization_id=new.organization_id;
  if not found or item.perfume_id<>new.perfume_id then
    raise exception 'purchase_inventory_item_scope_mismatch';
  end if;

  if not exists(select 1 from public.perfumes
    where id=new.perfume_id and organization_id=new.organization_id) then
    raise exception 'purchase_perfume_scope_mismatch';
  end if;

  select * into movement from public.inventory_movements
  where id=new.inventory_movement_id and organization_id=new.organization_id;
  if not found or movement.inventory_item_id<>new.inventory_item_id
    or movement.perfume_id<>new.perfume_id then
    raise exception 'purchase_movement_scope_mismatch';
  end if;
  if movement.quantity_ml<>new.total_volume_ml or movement.quantity_ml<=0 then
    raise exception 'purchase_movement_volume_mismatch';
  end if;
  return new;
end;
$$;

create trigger inventory_purchase_entry_validate_scope_before_write
before insert or update on public.inventory_purchase_entries
for each row execute function public.inventory_purchase_entry_validate_scope();

alter table public.inventory_purchase_entries enable row level security;

create policy inventory_purchase_entries_select
on public.inventory_purchase_entries for select
using(
  organization_id in(select public.current_user_org_ids())
  and public.has_org_permission(organization_id,'cost_margin.view')
);

create policy inventory_purchase_entries_insert
on public.inventory_purchase_entries for insert
with check(
  organization_id in(select public.current_user_org_ids())
  and public.has_org_permission(organization_id,'inventory.adjust')
  and public.has_org_permission(organization_id,'cost_margin.edit')
);

create policy inventory_purchase_entries_update
on public.inventory_purchase_entries for update
using(
  organization_id in(select public.current_user_org_ids())
  and public.has_org_permission(organization_id,'inventory.adjust')
  and public.has_org_permission(organization_id,'cost_margin.edit')
)
with check(
  organization_id in(select public.current_user_org_ids())
  and public.has_org_permission(organization_id,'inventory.adjust')
  and public.has_org_permission(organization_id,'cost_margin.edit')
);

create policy inventory_purchase_entries_delete
on public.inventory_purchase_entries for delete
using(
  organization_id in(select public.current_user_org_ids())
  and public.has_org_permission(organization_id,'inventory.adjust')
  and public.has_org_permission(organization_id,'cost_margin.edit')
);

revoke all on public.inventory_purchase_entries from public,anon;
grant select,insert,update,delete on public.inventory_purchase_entries to authenticated;

create function public.inventory_purchase_cost_summary(p_organization_id uuid)
returns table(
  perfume_id uuid,
  known_entries bigint,
  known_units bigint,
  known_volume_ml numeric,
  known_total_cost_brl numeric,
  average_cost_per_ml numeric,
  average_cost_per_bottle numeric,
  pending_entries bigint,
  zero_review_entries bigint
)
language sql
stable
security invoker
set search_path=public
as $$
  select
    e.perfume_id,
    count(*) filter(where e.cost_status='known' and e.total_cost_brl is not null),
    coalesce(sum(e.quantity_units) filter(where e.cost_status='known' and e.total_cost_brl is not null),0),
    coalesce(sum(e.total_volume_ml) filter(where e.cost_status='known' and e.total_cost_brl is not null),0),
    coalesce(sum(e.total_cost_brl) filter(where e.cost_status='known' and e.total_cost_brl is not null),0),
    sum(e.total_cost_brl) filter(where e.cost_status='known' and e.total_cost_brl is not null)
      / nullif(sum(e.total_volume_ml) filter(where e.cost_status='known' and e.total_cost_brl is not null),0),
    sum(e.total_cost_brl) filter(where e.cost_status='known' and e.total_cost_brl is not null)
      / nullif(sum(e.quantity_units) filter(where e.cost_status='known' and e.total_cost_brl is not null),0),
    count(*) filter(where e.cost_status='pending'),
    count(*) filter(where e.cost_status='zero_review')
  from public.inventory_purchase_entries e
  where e.organization_id=p_organization_id
    and e.organization_id in(select public.current_user_org_ids())
    and public.has_org_permission(e.organization_id,'cost_margin.view')
  group by e.perfume_id;
$$;

revoke all on function public.inventory_purchase_cost_summary(uuid) from public,anon;
grant execute on function public.inventory_purchase_cost_summary(uuid) to authenticated,service_role;

commit;
