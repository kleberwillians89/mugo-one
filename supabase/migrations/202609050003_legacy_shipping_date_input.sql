begin;

alter table public.sales
  add column if not exists legacy_shipping_date date;

alter table public.sales drop constraint if exists sales_legacy_shipping_confirmation_check;
alter table public.sales add constraint sales_legacy_shipping_confirmation_check check (
  (legacy_shipping_confirmation is null and legacy_shipping_date is null and legacy_shipping_confirmed_at is null and legacy_shipping_confirmed_by is null)
  or (legacy_shipping_confirmation = 'pending' and legacy_shipping_date is null and legacy_shipping_confirmed_at is null and legacy_shipping_confirmed_by is null)
  or (legacy_shipping_confirmation = 'sent' and legacy_shipping_date is not null and legacy_shipping_confirmed_at is not null and legacy_shipping_confirmed_by is not null)
  or (legacy_shipping_confirmation = 'not_sent' and legacy_shipping_date is null and legacy_shipping_confirmed_at is not null and legacy_shipping_confirmed_by is not null)
) not valid;

create or replace function public.guard_legacy_shipping_confirmation_write()
returns trigger language plpgsql set search_path = public as $$
begin
  if (new.legacy_shipping_confirmation, new.legacy_shipping_date, new.legacy_shipping_confirmed_at, new.legacy_shipping_confirmed_by)
     is distinct from
     (old.legacy_shipping_confirmation, old.legacy_shipping_date, old.legacy_shipping_confirmed_at, old.legacy_shipping_confirmed_by)
     and coalesce(current_setting('app.legacy_shipping_confirmation_rpc', true), '') <> 'allowed' then
    raise exception 'legacy_shipping_confirmation_requires_rpc';
  end if;
  return new;
end;
$$;

drop trigger if exists guard_legacy_shipping_confirmation_write on public.sales;
create trigger guard_legacy_shipping_confirmation_write
before update of legacy_shipping_confirmation, legacy_shipping_date, legacy_shipping_confirmed_at, legacy_shipping_confirmed_by
on public.sales for each row execute function public.guard_legacy_shipping_confirmation_write();

create or replace function public.set_legacy_shipping_confirmation(
  p_sale_id uuid,
  p_confirmation text,
  p_expected_updated_at timestamptz,
  p_shipping_date date default null,
  p_note text default null
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  sale_row public.sales;
  normalized_confirmation text := lower(btrim(coalesce(p_confirmation, '')));
  stored_confirmation text;
  stored_shipping_date date;
  changed_at timestamptz := clock_timestamp();
  before_state jsonb;
  after_state jsonb;
begin
  if auth.uid() is null then raise exception 'unauthenticated'; end if;
  if normalized_confirmation not in ('pending', 'sent', 'not_sent') then raise exception 'invalid_legacy_shipping_confirmation'; end if;
  if p_expected_updated_at is null then raise exception 'expected_updated_at_required'; end if;
  if length(coalesce(p_note, '')) > 1000 then raise exception 'legacy_shipping_note_too_long'; end if;
  if normalized_confirmation = 'sent' and p_shipping_date is null then raise exception 'legacy_shipping_date_required'; end if;
  if normalized_confirmation in ('pending', 'not_sent') and p_shipping_date is not null then raise exception 'legacy_shipping_date_not_allowed'; end if;

  select s.* into sale_row from public.sales s where s.id = p_sale_id for update;
  if sale_row.id is null or sale_row.deleted_at is not null then raise exception 'sale_not_found'; end if;
  if sale_row.organization_id not in (select public.current_user_org_ids())
     or not public.has_org_permission(sale_row.organization_id, 'sales.edit') then raise exception 'forbidden'; end if;
  if sale_row.updated_at is distinct from p_expected_updated_at then raise exception 'stale_sale'; end if;

  stored_confirmation := case when normalized_confirmation = 'pending' then null else normalized_confirmation end;
  stored_shipping_date := case when normalized_confirmation = 'sent' then p_shipping_date else null end;

  if normalized_confirmation = 'not_sent' and (
    sale_row.shipped_at is not null
    or upper(btrim(coalesce(sale_row.shipping_operational_status, ''))) in ('ENVIADO', 'POSTADO', 'ENTREGUE', 'DELIVERED')
    or exists (
      select 1 from public.shipment_items si
      join public.shipments sh on sh.id = si.shipment_id and sh.organization_id = sale_row.organization_id
      where si.sale_id = sale_row.id and si.removed_at is null
        and (sh.status in ('posted', 'delivered') or sh.posted_at is not null or sh.delivered_at is not null or nullif(btrim(sh.tracking_code), '') is not null)
    )
  ) then raise exception 'operational_shipment_confirmed'; end if;

  if sale_row.legacy_shipping_confirmation is not distinct from stored_confirmation
     and sale_row.legacy_shipping_date is not distinct from stored_shipping_date then
    return jsonb_build_object('sale_id', sale_row.id, 'confirmation', coalesce(sale_row.legacy_shipping_confirmation, 'pending'),
      'shipping_date', sale_row.legacy_shipping_date, 'confirmed_at', sale_row.legacy_shipping_confirmed_at,
      'confirmed_by', sale_row.legacy_shipping_confirmed_by, 'updated_at', sale_row.updated_at, 'changed', false);
  end if;

  before_state := jsonb_build_object('confirmation', coalesce(sale_row.legacy_shipping_confirmation, 'pending'),
    'shipping_date', sale_row.legacy_shipping_date, 'confirmed_at', sale_row.legacy_shipping_confirmed_at,
    'confirmed_by', sale_row.legacy_shipping_confirmed_by);

  perform set_config('app.legacy_shipping_confirmation_rpc', 'allowed', true);
  update public.sales set
    legacy_shipping_confirmation = stored_confirmation,
    legacy_shipping_date = stored_shipping_date,
    legacy_shipping_confirmed_at = case when stored_confirmation is null then null else changed_at end,
    legacy_shipping_confirmed_by = case when stored_confirmation is null then null else auth.uid() end,
    updated_at = changed_at
  where id = sale_row.id
  returning jsonb_build_object('confirmation', coalesce(legacy_shipping_confirmation, 'pending'),
    'shipping_date', legacy_shipping_date, 'confirmed_at', legacy_shipping_confirmed_at,
    'confirmed_by', legacy_shipping_confirmed_by), updated_at into after_state, changed_at;

  insert into public.audit_logs(organization_id, actor_id, action, entity_type, entity_id, metadata)
  values (sale_row.organization_id, auth.uid(), 'legacy_shipping_confirmation_changed', 'sale', sale_row.id::text,
    jsonb_build_object('sale_id', sale_row.id, 'organization_id', sale_row.organization_id,
      'before', before_state, 'after', after_state, 'confirmed_by', auth.uid(), 'confirmed_at', changed_at,
      'note', nullif(btrim(coalesce(p_note, '')), ''), 'source', 'manual_legacy_shipping_reconciliation'));

  return jsonb_build_object('sale_id', sale_row.id, 'confirmation', after_state ->> 'confirmation',
    'shipping_date', after_state ->> 'shipping_date', 'confirmed_at', after_state ->> 'confirmed_at',
    'confirmed_by', after_state ->> 'confirmed_by', 'updated_at', changed_at, 'changed', true);
end;
$$;

revoke all on function public.set_legacy_shipping_confirmation(uuid, text, timestamptz, date, text) from public, anon, authenticated;
grant execute on function public.set_legacy_shipping_confirmation(uuid, text, timestamptz, date, text) to authenticated;

-- Remove the old RPC surface so sent can never be recorded without its historical date.
drop function if exists public.set_legacy_shipping_confirmation(uuid, text, timestamptz, text);

commit;
