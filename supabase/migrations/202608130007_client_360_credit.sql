create or replace function public.client_360(p_client_id uuid)
returns jsonb language sql stable security invoker set search_path=public as $$
with c as (
  select * from public.clients where id=p_client_id and deleted_at is null
    and organization_id in(select public.current_user_org_ids())
), stats as (
  select count(*) filter(where payment_status<>'cancelled') purchases,
    coalesce(sum(amount) filter(where payment_status<>'cancelled'),0) total_purchased,
    coalesce(sum(amount) filter(where payment_status='paid'),0) paid,
    coalesce(sum(amount) filter(where payment_status='pending'),0) pending,
    coalesce(sum(amount) filter(where payment_status='cancelled'),0) cancelled,
    coalesce(sum(credit_reference_amount) filter(where payment_status<>'cancelled'),0) credit,
    coalesce(avg(amount) filter(where payment_status<>'cancelled'),0) average_ticket,
    coalesce(sum(volume_ml) filter(where payment_status<>'cancelled'),0) total_ml,
    min(sale_date) first_purchase,max(sale_date) last_purchase
  from public.sales where client_id=p_client_id and deleted_at is null
), waiting as (
  select coalesce(sum(quantity_ml),0) waiting_ml,count(*) waiting_products
  from public.inventory_allocations where client_id=p_client_id and status='reserved'
), favorite as (
  select perfume_name_raw,count(*) purchases,coalesce(sum(amount),0) value
  from public.sales where client_id=p_client_id and deleted_at is null and payment_status<>'cancelled'
  group by perfume_name_raw order by purchases desc,value desc nulls last limit 1
)
select jsonb_build_object('client',to_jsonb(c),'commercial',to_jsonb(stats)||jsonb_build_object(
  'top_perfume',(select perfume_name_raw from favorite),'top_perfume_value',(select value from favorite)
),'waiting',to_jsonb(waiting)) from c cross join stats cross join waiting;
$$;
revoke all on function public.client_360(uuid) from public,anon;
grant execute on function public.client_360(uuid) to authenticated,service_role;
