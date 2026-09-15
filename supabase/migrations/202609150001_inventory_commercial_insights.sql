begin;

alter table public.inventory_items
  add column if not exists sale_price_per_ml numeric(14,2)
  check (sale_price_per_ml is null or sale_price_per_ml >= 0);

create or replace function public.extract_commercial_quote_per_ml(value text)
returns numeric language plpgsql immutable parallel safe set search_path=public as $$
declare matched text[];
begin
  matched:=regexp_match(coalesce(value,''),'Cotaç[aã]o[^\n]*R\$\s*([0-9]+(?:[.,][0-9]{1,2})?)','i');
  if matched is null then return null; end if;
  return replace(replace(matched[1],'.',''),',','.')::numeric;
exception when others then return null;
end;$$;

with latest as(
  select distinct on(b.organization_id,b.perfume_id)
    b.organization_id,b.perfume_id,public.extract_commercial_quote_per_ml(b.source_text) price
  from public.ai_sales_batches b
  where b.perfume_id is not null
    and public.extract_commercial_quote_per_ml(b.source_text) is not null
  order by b.organization_id,b.perfume_id,b.sale_date desc,b.created_at desc
)
update public.inventory_items i set sale_price_per_ml=latest.price,updated_at=now()
from latest where latest.organization_id=i.organization_id and latest.perfume_id=i.perfume_id
  and i.sale_price_per_ml is distinct from latest.price;

create or replace function public.sync_sale_inventory_quote_per_ml()
returns trigger language plpgsql security definer set search_path=public as $$
declare price numeric;
begin
  select public.extract_commercial_quote_per_ml(b.source_text) into price
  from public.ai_sales_batches b
  where b.organization_id=new.organization_id and b.perfume_id=new.perfume_id
    and new.source_key like b.fingerprint||'|%'
  order by b.sale_date desc,b.created_at desc limit 1;
  if price is not null then
    update public.inventory_items set sale_price_per_ml=price,updated_at=now()
    where id=new.inventory_item_id and organization_id=new.organization_id
      and sale_price_per_ml is distinct from price;
  end if;
  return new;
end;$$;

drop trigger if exists sale_inventory_quote_per_ml on public.sale_inventory_births;
create trigger sale_inventory_quote_per_ml after insert on public.sale_inventory_births
for each row execute function public.sync_sale_inventory_quote_per_ml();

create or replace function public.inventory_set_sale_price(p_item_id uuid,p_price_per_ml numeric)
returns public.inventory_items language plpgsql security definer set search_path=public as $$
declare before_item public.inventory_items;after_item public.inventory_items;
begin
  if p_price_per_ml is not null and p_price_per_ml<0 then raise exception 'invalid_sale_price';end if;
  select * into before_item from public.inventory_items
  where id=p_item_id and organization_id in(select public.current_user_org_ids()) for update;
  if before_item.id is null then raise exception 'inventory_item_not_found';end if;
  if not public.has_org_permission(before_item.organization_id,'inventory.adjust') then raise exception 'forbidden';end if;
  update public.inventory_items set sale_price_per_ml=p_price_per_ml,updated_at=now()
  where id=before_item.id returning * into after_item;
  insert into public.audit_logs(organization_id,actor_id,action,entity_type,entity_id,metadata)
  values(before_item.organization_id,auth.uid(),'inventory_sale_price_updated','inventory_item',before_item.id::text,
    jsonb_build_object('before',before_item.sale_price_per_ml,'after',after_item.sale_price_per_ml));
  return after_item;
end;$$;
revoke all on function public.inventory_set_sale_price(uuid,numeric) from public,anon;
grant execute on function public.inventory_set_sale_price(uuid,numeric) to authenticated;

create or replace function public.inventory_sales_insights(org_id uuid,start_date date,end_date date)
returns table(item_id uuid,perfume_id uuid,sales_count bigint,buyers_count bigint,total_ml numeric,
  total_sold numeric,total_collected numeric,sale_price_per_ml numeric)
language sql stable security invoker set search_path=public as $$
  select i.id,p.id,count(s.id),count(distinct s.client_id),coalesce(sum(s.volume_ml),0),
    coalesce(sum(s.amount),0),coalesce(sum(s.amount) filter(where s.payment_status='paid'),0),i.sale_price_per_ml
  from public.inventory_items i join public.perfumes p on p.id=i.perfume_id
  join public.sales s on s.organization_id=i.organization_id and s.perfume_id=i.perfume_id
    and s.deleted_at is null and s.payment_status<>'cancelled' and s.sale_date between start_date and end_date
  where i.organization_id=org_id and i.status='active'
    and org_id in(select public.current_user_org_ids())
  group by i.id,p.id,i.sale_price_per_ml order by p.full_name_raw;
$$;
revoke all on function public.inventory_sales_insights(uuid,date,date) from public,anon;
grant execute on function public.inventory_sales_insights(uuid,date,date) to authenticated,service_role;

notify pgrst,'reload schema';
commit;
