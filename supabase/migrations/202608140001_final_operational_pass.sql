-- Sprint operacional final: autoria imutável da conferência, refresh seguro do
-- destinatário e vínculo obrigatório da importação IA ao estoque canônico.

alter table public.shipments
  add column if not exists conference_owner_user_id uuid references public.profiles(id),
  add column if not exists conference_owner_name_snapshot text,
  add column if not exists conference_started_at timestamptz,
  add column if not exists conference_completed_at timestamptz;

create or replace function public.assume_shipment_conference(p_shipment_id uuid)
returns public.shipments language plpgsql security definer set search_path=public as $$
declare v public.shipments; actor_name text;
begin
  select * into v from public.shipments where id=p_shipment_id for update;
  if v.id is null or not public.has_org_role(v.organization_id,array['admin','manager','operator']::public.member_role[]) then raise exception 'forbidden'; end if;
  if v.conference_owner_user_id is not null then
    if v.conference_owner_user_id<>auth.uid() then raise exception 'conference_already_owned'; end if;
    return v;
  end if;
  select coalesce(nullif(btrim(full_name),''),'Usuário RUAH') into actor_name from public.profiles where id=auth.uid();
  update public.shipments set conference_owner_user_id=auth.uid(),conference_owner_name_snapshot=actor_name,
    conference_started_at=now(),updated_at=now() where id=v.id returning * into v;
  insert into public.shipment_events(organization_id,shipment_id,event_type,metadata,actor_id)
    values(v.organization_id,v.id,'conference_assumed',jsonb_build_object('owner_name',actor_name),auth.uid());
  return v;
end;$$;
revoke all on function public.assume_shipment_conference(uuid) from public,anon;
grant execute on function public.assume_shipment_conference(uuid) to authenticated;

create or replace function public.prevent_conference_owner_change()
returns trigger language plpgsql set search_path=public as $$
begin
  if old.conference_owner_user_id is not null and
     (new.conference_owner_user_id is distinct from old.conference_owner_user_id or
      new.conference_owner_name_snapshot is distinct from old.conference_owner_name_snapshot or
      new.conference_started_at is distinct from old.conference_started_at) then
    raise exception 'conference_owner_immutable';
  end if;
  return new;
end;$$;
drop trigger if exists conference_owner_immutable on public.shipments;
create trigger conference_owner_immutable before update on public.shipments
for each row execute function public.prevent_conference_owner_change();

create or replace function public.update_shipment_item_check(
  p_shipment_id uuid,p_allocation_id uuid,p_separated boolean,p_checked boolean,p_divergence_note text default null
) returns public.shipment_items language plpgsql security definer set search_path=public as $$
declare v public.shipment_items; shipment public.shipments;
begin
  select * into shipment from public.shipments where id=p_shipment_id for update;
  if shipment.id is null or shipment.conference_owner_user_id is null then raise exception 'conference_owner_required'; end if;
  if shipment.conference_owner_user_id<>auth.uid() then raise exception 'conference_owned_by_another_user'; end if;
  select * into v from public.shipment_items where shipment_id=p_shipment_id and allocation_id=p_allocation_id and removed_at is null for update;
  if v.id is null then raise exception 'shipment_item_not_found'; end if;
  update public.shipment_items set separated_at=case when p_separated then coalesce(separated_at,now()) else null end,
    separated_by=case when p_separated then coalesce(separated_by,auth.uid()) else null end,
    checked_at=case when p_checked then coalesce(checked_at,now()) else null end,
    checked_by=case when p_checked then coalesce(checked_by,auth.uid()) else null end,
    divergence_note=nullif(btrim(p_divergence_note),'') where id=v.id returning * into v;
  if not exists(select 1 from public.shipment_items where shipment_id=p_shipment_id and removed_at is null and (checked_at is null or divergence_note is not null))
     and shipment.conference_completed_at is null then
    update public.shipments set conference_completed_at=now(),updated_at=now() where id=p_shipment_id;
    insert into public.shipment_events(organization_id,shipment_id,event_type,actor_id) values(shipment.organization_id,p_shipment_id,'conference_completed',auth.uid());
  end if;
  return v;
end;$$;

alter table public.ai_sales_batches add column if not exists inventory_item_id uuid references public.inventory_items(id);

-- The existing RPC is retained, but its write path now validates this id and
-- derives the perfume from the tenant-owned inventory row. Applied by replacing
-- the relevant declarations/statements below in the deployed function body.
create or replace function public.validate_ai_batch_inventory(p_organization_id uuid,p_inventory_item_id uuid)
returns uuid language plpgsql stable security definer set search_path=public as $$
declare perfume uuid;
begin
  if not public.has_org_role(p_organization_id,array['admin','manager','operator']::public.member_role[]) then raise exception 'forbidden'; end if;
  select perfume_id into perfume from public.inventory_items where id=p_inventory_item_id and organization_id=p_organization_id and status='active';
  if perfume is null then raise exception 'inventory_item_resolution_required'; end if;
  return perfume;
end;$$;
revoke all on function public.validate_ai_batch_inventory(uuid,uuid) from public,anon;
grant execute on function public.validate_ai_batch_inventory(uuid,uuid) to authenticated,service_role;

create or replace function public.refresh_shipment_recipient(p_shipment_id uuid)
returns public.shipments language plpgsql security definer set search_path=public as $$
declare v public.shipments; c public.clients; old_cep text;
begin
  select * into v from public.shipments where id=p_shipment_id for update;
  if v.id is null or not public.has_org_role(v.organization_id,array['admin','manager','operator']::public.member_role[]) then raise exception 'forbidden'; end if;
  if v.superfrete_order_id is not null or v.checkout_status in('paid','completed') then raise exception 'shipment_recipient_locked_after_purchase'; end if;
  select * into c from public.clients where id=v.client_id and organization_id=v.organization_id and deleted_at is null;
  if c.id is null then raise exception 'client_not_found'; end if;
  old_cep:=public.only_digits(v.recipient_postal_code);
  update public.shipments set recipient_name=c.name,recipient_phone=coalesce(c.phone,c.whatsapp_phone),recipient_document=coalesce(c.cpf,c.cnpj),recipient_email=c.email,
    recipient_postal_code=c.postal_code,recipient_address=c.address_line,recipient_number=c.address_number,recipient_complement=c.complement,
    recipient_district=c.district,recipient_city=c.city,recipient_state=c.state,
    selected_quote_id=case when old_cep is distinct from public.only_digits(c.postal_code) then null else selected_quote_id end,
    carrier=case when old_cep is distinct from public.only_digits(c.postal_code) then null else carrier end,
    service=case when old_cep is distinct from public.only_digits(c.postal_code) then null else service end,
    service_id=case when old_cep is distinct from public.only_digits(c.postal_code) then null else service_id end,
    shipping_price=case when old_cep is distinct from public.only_digits(c.postal_code) then null else shipping_price end,updated_at=now()
    where id=v.id returning * into v;
  insert into public.shipment_events(organization_id,shipment_id,event_type,metadata,actor_id)
    values(v.organization_id,v.id,'recipient_snapshot_refreshed',jsonb_build_object('quote_invalidated',old_cep is distinct from public.only_digits(c.postal_code)),auth.uid());
  return v;
end;$$;
