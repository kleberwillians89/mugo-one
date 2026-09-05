begin;

alter table public.sales
  add column if not exists legacy_shipping_status text,
  add column if not exists legacy_shipping_status_updated_at timestamptz,
  add column if not exists legacy_shipping_status_updated_by uuid references public.profiles(id);

alter table public.sales drop constraint if exists sales_legacy_shipping_status_check;
alter table public.sales add constraint sales_legacy_shipping_status_check check (
  (legacy_shipping_status is null and legacy_shipping_status_updated_at is null and legacy_shipping_status_updated_by is null)
  or (legacy_shipping_status in ('confirmed', 'to_send', 'out_of_stock') and legacy_shipping_status_updated_at is not null and legacy_shipping_status_updated_by is not null)
);

create index if not exists sales_legacy_shipping_status_idx
  on public.sales(organization_id, legacy_shipping_status, sale_date, id)
  where deleted_at is null;

create or replace function public.guard_legacy_shipping_status_write()
returns trigger language plpgsql set search_path = public as $$
begin
  if (new.legacy_shipping_status, new.legacy_shipping_status_updated_at, new.legacy_shipping_status_updated_by)
     is distinct from
     (old.legacy_shipping_status, old.legacy_shipping_status_updated_at, old.legacy_shipping_status_updated_by)
     and coalesce(current_setting('app.legacy_shipping_status_rpc', true), '') <> 'allowed' then
    raise exception 'legacy_shipping_status_requires_rpc';
  end if;
  return new;
end;
$$;

drop trigger if exists guard_legacy_shipping_status_write on public.sales;
create trigger guard_legacy_shipping_status_write
before update of legacy_shipping_status, legacy_shipping_status_updated_at, legacy_shipping_status_updated_by
on public.sales for each row execute function public.guard_legacy_shipping_status_write();

create or replace function public.set_legacy_shipping_status(
  p_sale_id uuid,
  p_status text,
  p_expected_updated_at timestamptz
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  sale_row public.sales;
  stored_status text := nullif(lower(btrim(coalesce(p_status, ''))), '');
  changed_at timestamptz := clock_timestamp();
  before_state jsonb;
  after_state jsonb;
begin
  if auth.uid() is null then raise exception 'unauthenticated'; end if;
  if stored_status is not null and stored_status not in ('confirmed', 'to_send', 'out_of_stock') then
    raise exception 'invalid_legacy_shipping_status';
  end if;
  if p_expected_updated_at is null then raise exception 'expected_updated_at_required'; end if;

  select s.* into sale_row from public.sales s where s.id = p_sale_id for update;
  if sale_row.id is null or sale_row.deleted_at is not null then raise exception 'sale_not_found'; end if;
  if sale_row.organization_id not in (select public.current_user_org_ids())
     or not public.has_org_permission(sale_row.organization_id, 'sales.edit') then raise exception 'forbidden'; end if;
  if sale_row.updated_at is distinct from p_expected_updated_at then raise exception 'stale_sale'; end if;

  if sale_row.legacy_shipping_status is not distinct from stored_status then
    return jsonb_build_object('sale_id', sale_row.id, 'status', sale_row.legacy_shipping_status,
      'status_updated_at', sale_row.legacy_shipping_status_updated_at,
      'status_updated_by', sale_row.legacy_shipping_status_updated_by,
      'updated_at', sale_row.updated_at, 'changed', false);
  end if;

  before_state := jsonb_build_object('status', sale_row.legacy_shipping_status,
    'status_updated_at', sale_row.legacy_shipping_status_updated_at,
    'status_updated_by', sale_row.legacy_shipping_status_updated_by);

  perform set_config('app.legacy_shipping_status_rpc', 'allowed', true);
  update public.sales set
    legacy_shipping_status = stored_status,
    legacy_shipping_status_updated_at = case when stored_status is null then null else changed_at end,
    legacy_shipping_status_updated_by = case when stored_status is null then null else auth.uid() end,
    updated_at = changed_at
  where id = sale_row.id
  returning jsonb_build_object('status', legacy_shipping_status,
    'status_updated_at', legacy_shipping_status_updated_at,
    'status_updated_by', legacy_shipping_status_updated_by), updated_at into after_state, changed_at;

  insert into public.audit_logs(organization_id, actor_id, action, entity_type, entity_id, metadata)
  values (sale_row.organization_id, auth.uid(), 'legacy_shipping_status_changed', 'sale', sale_row.id::text,
    jsonb_build_object('sale_id', sale_row.id, 'organization_id', sale_row.organization_id,
      'before', before_state, 'after', after_state, 'source', 'manual_legacy_shipping_reconciliation'));

  return jsonb_build_object('sale_id', sale_row.id, 'status', after_state ->> 'status',
    'status_updated_at', after_state ->> 'status_updated_at',
    'status_updated_by', after_state ->> 'status_updated_by',
    'updated_at', changed_at, 'changed', true);
end;
$$;

revoke all on function public.set_legacy_shipping_status(uuid, text, timestamptz) from public, anon, authenticated;
grant execute on function public.set_legacy_shipping_status(uuid, text, timestamptz) to authenticated;

commit;
