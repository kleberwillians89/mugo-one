begin;

-- HOME INTELIGENTE: uma leitura agregada, autorizada e tenant-safe.
-- Janelas horárias usam sales.created_at (instante de entrada no CRM).
-- Janelas por dia usam sales.sale_date (data comercial informada na venda).

create index if not exists sales_org_created_active_idx
  on public.sales(organization_id,created_at desc) where deleted_at is null;
create index if not exists shipments_org_status_created_idx
  on public.shipments(organization_id,status,created_at desc);

-- A Home é o ponto inicial autenticado. Concedê-la não amplia acesso a
-- nenhum módulo: o próprio RPC continua recortando cada bloco pelas
-- permissões efetivas do membro.
insert into public.organization_member_permissions(organization_id,user_id,permission_code,granted)
select om.organization_id,om.user_id,'dashboard.view',true
from public.organization_members om where om.status='active'
on conflict(organization_id,user_id,permission_code) do update set granted=true,updated_at=now();
insert into public.preset_permissions(preset,permission_code) values
  ('entregas','dashboard.view'),('estoque','dashboard.view')
on conflict do nothing;

create or replace function public.dashboard_summary(
  p_organization_id uuid,
  p_period text default 'today',
  p_start_date date default null,
  p_end_date date default null
) returns jsonb
language plpgsql stable security definer set search_path=public as $$
declare
  v_now timestamptz:=now();
  v_today date:=(now() at time zone 'America/Sao_Paulo')::date;
  v_start_ts timestamptz;
  v_end_ts timestamptz;
  v_previous_start_ts timestamptz;
  v_previous_end_ts timestamptz;
  v_start_date date;
  v_end_date date;
  v_previous_start_date date;
  v_previous_end_date date;
  v_hourly boolean:=false;
  v_duration interval;
  v_profile text;
  v_preset text;
  v_finance boolean;
  v_operations boolean;
  v_management boolean;
  v_current jsonb;
  v_previous jsonb;
  v_top jsonb;
  v_recent jsonb;
  v_operations_data jsonb;
  v_alerts jsonb;
  v_day_summary jsonb;
begin
  if auth.uid() is null then raise exception 'authentication_required'; end if;
  if not exists(select 1 from public.organization_members om where om.organization_id=p_organization_id and om.user_id=auth.uid() and om.status='active') then
    raise exception 'organization_access_denied';
  end if;
  if not public.has_org_permission(p_organization_id,'dashboard.view') then raise exception 'permission_denied'; end if;
  if p_period not in ('last_hour','today','24h','7d','30d','custom') then raise exception 'invalid_dashboard_period'; end if;

  select om.permission_preset into v_preset from public.organization_members om
   where om.organization_id=p_organization_id and om.user_id=auth.uid();
  v_finance:=public.has_org_permission(p_organization_id,'cost_margin.view') or public.has_org_permission(p_organization_id,'reports.view');
  v_operations:=public.has_org_permission(p_organization_id,'tasks.split') or public.has_org_permission(p_organization_id,'tasks.shipping');
  v_management:=public.has_org_permission(p_organization_id,'tasks.management') or coalesce(v_preset,'') in('administrador','gestor');
  v_profile:=case when v_management then 'management' when v_finance then 'finance' when v_operations then 'operations'
                  when public.has_org_permission(p_organization_id,'sales.create') then 'commercial'
                  when public.has_org_permission(p_organization_id,'radar.view') or public.has_org_permission(p_organization_id,'waitlist.view') then 'marketing'
                  else 'viewer' end;

  if p_period='last_hour' then
    v_hourly:=true; v_end_ts:=v_now; v_start_ts:=v_now-interval '1 hour';
  elsif p_period='24h' then
    v_hourly:=true; v_end_ts:=v_now; v_start_ts:=v_now-interval '24 hours';
  else
    v_start_date:=case p_period when 'today' then v_today when '7d' then v_today-6 when '30d' then v_today-29 else p_start_date end;
    v_end_date:=case when p_period='custom' then p_end_date else v_today end;
    if v_start_date is null or v_end_date is null or v_end_date<v_start_date then raise exception 'invalid_custom_period'; end if;
    v_start_ts:=v_start_date::timestamp at time zone 'America/Sao_Paulo';
    v_end_ts:=(v_end_date+1)::timestamp at time zone 'America/Sao_Paulo';
  end if;
  v_duration:=v_end_ts-v_start_ts;
  v_previous_end_ts:=v_start_ts; v_previous_start_ts:=v_start_ts-v_duration;
  v_start_date:=coalesce(v_start_date,(v_start_ts at time zone 'America/Sao_Paulo')::date);
  v_end_date:=coalesce(v_end_date,(v_end_ts at time zone 'America/Sao_Paulo')::date);
  v_previous_start_date:=(v_previous_start_ts at time zone 'America/Sao_Paulo')::date;
  v_previous_end_date:=case when v_hourly then (v_previous_end_ts at time zone 'America/Sao_Paulo')::date else v_start_date-1 end;

  with scoped as(
    select s.* from public.sales s where s.organization_id=p_organization_id and s.deleted_at is null and s.payment_status<>'cancelled'
      and (case when v_hourly then s.created_at>=v_start_ts and s.created_at<v_end_ts else s.sale_date between v_start_date and v_end_date end)
  ), first_sales as(
    select client_id,min(sale_date) first_date from public.sales where organization_id=p_organization_id and deleted_at is null and payment_status<>'cancelled' group by client_id
  )
  select jsonb_build_object(
    'sales_count',count(*),'items_sold',count(*),'revenue',case when v_finance then coalesce(sum(s.amount),0) else null end,'ml_sold',coalesce(sum(s.volume_ml),0),
    'unique_perfumes',count(distinct s.perfume_id) filter(where s.perfume_id is not null),
    'average_ticket',case when v_finance then coalesce(avg(s.amount),0) else null end,'buyers',count(distinct s.client_id),
    'new_buyers',count(distinct s.client_id) filter(where f.first_date between v_start_date and v_end_date),
    'returning_buyers',count(distinct s.client_id) filter(where f.first_date<v_start_date),
    'paid_count',count(*) filter(where s.payment_status='paid'),'pending_count',count(*) filter(where s.payment_status in('pending','unknown')),
    'unclassified_perfume_count',count(*) filter(where s.perfume_id is null)
  ) into v_current from scoped s left join first_sales f on f.client_id=s.client_id;

  with scoped as(
    select s.* from public.sales s where s.organization_id=p_organization_id and s.deleted_at is null and s.payment_status<>'cancelled'
      and (case when v_hourly then s.created_at>=v_previous_start_ts and s.created_at<v_previous_end_ts else s.sale_date between v_previous_start_date and v_previous_end_date end)
  ) select jsonb_build_object('sales_count',count(*),'revenue',case when v_finance then coalesce(sum(amount),0) else null end,'ml_sold',coalesce(sum(volume_ml),0),
      'buyers',count(distinct client_id),'average_ticket',case when v_finance then coalesce(avg(amount),0) else null end) into v_previous from scoped;

  with ranked as(
    select s.perfume_id,coalesce(p.full_name_raw,s.perfume_name_raw,'Perfume não identificado') name,
      count(*) items,coalesce(sum(s.volume_ml),0) ml,case when v_finance then coalesce(sum(s.amount),0) else null end revenue,count(distinct s.client_id) buyers
    from public.sales s left join public.perfumes p on p.id=s.perfume_id
    where s.organization_id=p_organization_id and s.deleted_at is null and s.payment_status<>'cancelled'
      and (case when v_hourly then s.created_at>=v_start_ts and s.created_at<v_end_ts else s.sale_date between v_start_date and v_end_date end)
    group by s.perfume_id,coalesce(p.full_name_raw,s.perfume_name_raw,'Perfume não identificado')
    order by ml desc,revenue desc limit 12
  ) select coalesce(jsonb_agg(to_jsonb(ranked)),'[]'::jsonb) into v_top from ranked;

  with recent as(
    select s.id,c.name client_name,s.sale_date,s.created_at,coalesce(p.full_name_raw,s.perfume_name_raw,'Perfume não identificado') perfume_name,
      s.bottle_identifier,s.volume_ml,case when v_finance then s.amount else null end amount,s.payment_status,s.sale_type,
      case when s.sale_type='APC' then s.apc_separation_status when s.sale_type='SPLIT' then s.split_status else null end separation_status,
      sh.status shipment_status
    from public.sales s join public.clients c on c.id=s.client_id left join public.perfumes p on p.id=s.perfume_id
    left join lateral(select h.status from public.shipment_items si join public.shipments h on h.id=si.shipment_id where si.sale_id=s.id and si.removed_at is null order by h.created_at desc limit 1) sh on true
    where s.organization_id=p_organization_id and s.deleted_at is null
      and (case when v_hourly then s.created_at>=v_start_ts and s.created_at<v_end_ts else s.sale_date between v_start_date and v_end_date end)
    order by s.created_at desc limit 15
  ) select coalesce(jsonb_agg(to_jsonb(recent)),'[]'::jsonb) into v_recent from recent;

  select jsonb_build_object(
    'awaiting_separation',count(*) filter(where s.payment_status='paid' and ((s.sale_type='SPLIT' and s.split_status='not_split') or (s.sale_type='APC' and s.apc_separation_status='not_split'))),
    'missing_allocations',count(*) filter(where s.payment_status='paid' and s.inventory_allocation_eligible and coalesce(s.volume_ml,0)>0 and not exists(select 1 from public.inventory_allocations a where a.sale_id=s.id and a.status in('reserved','shipping','shipped'))),
    'paid_older_24h',count(*) filter(where s.payment_status='paid' and coalesce(s.operational_created_at,s.created_at)<v_now-interval '24 hours' and not exists(select 1 from public.shipment_items si where si.sale_id=s.id and si.removed_at is null)),
    'pending_collection',count(*) filter(where s.payment_status in('pending','unknown'))
  ) into v_operations_data from public.sales s where s.organization_id=p_organization_id and s.deleted_at is null;
  v_operations_data:=v_operations_data||jsonb_build_object(
    'shipments_open',(select count(*) from public.shipments h where h.organization_id=p_organization_id and h.status not in('delivered','cancelled')),
    'awaiting_tracking',(select count(*) from public.shipments h where h.organization_id=p_organization_id and h.status not in('draft','cancelled','delivered') and nullif(h.tracking_code,'') is null),
    'labels_pending',(select count(*) from public.shipments h where h.organization_id=p_organization_id and h.status in('customer_approved','label_pending')),
    'critical_stock',(select count(*) from public.replenishment_signals(p_organization_id) r where r.status in('critico','repor'))
  );

  with raw as(
    select 'separation'::text type,'warning'::text severity,'sales'::text entity_id,'Separação pendente'::text title,
      format('%s vendas pagas aguardam separação.',v_operations_data->>'awaiting_separation') description,v_now created_at
      where (v_operations_data->>'awaiting_separation')::int>0
    union all select 'allocation','critical','sales','Venda sem reserva',format('%s vendas pagas ainda não possuem reserva de estoque.',v_operations_data->>'missing_allocations'),v_now where (v_operations_data->>'missing_allocations')::int>0
    union all select 'shipping','warning','shipments','Rastreio pendente',format('%s envios ativos ainda não possuem código de rastreio.',v_operations_data->>'awaiting_tracking'),v_now where (v_operations_data->>'awaiting_tracking')::int>0
    union all select 'shipping','warning','sales','Venda paga sem envio',format('%s vendas pagas há mais de 24 horas ainda não entraram em um envio.',v_operations_data->>'paid_older_24h'),v_now where (v_operations_data->>'paid_older_24h')::int>0
    union all select 'inventory','critical','inventory','Estoque crítico',format('%s perfumes atingiram o estoque mínimo.',v_operations_data->>'critical_stock'),v_now where (v_operations_data->>'critical_stock')::int>0
    union all select 'collection','info','sales','Cobranças pendentes',format('%s vendas aguardam pagamento.',v_operations_data->>'pending_collection'),v_now where (v_operations_data->>'pending_collection')::int>0
  ) select coalesce(jsonb_agg(to_jsonb(raw) order by case severity when 'critical' then 1 when 'warning' then 2 else 3 end),'[]'::jsonb) into v_alerts from raw;

  select jsonb_build_object(
    'today',jsonb_build_object('sales_count',count(*) filter(where s.sale_date=v_today and s.payment_status<>'cancelled'),'revenue',case when v_finance then coalesce(sum(s.amount) filter(where s.sale_date=v_today and s.payment_status<>'cancelled'),0) else null end,'ml',coalesce(sum(s.volume_ml) filter(where s.sale_date=v_today and s.payment_status<>'cancelled'),0)),
    'yesterday',jsonb_build_object('sales_count',count(*) filter(where s.sale_date=v_today-1 and s.payment_status<>'cancelled'),'revenue',case when v_finance then coalesce(sum(s.amount) filter(where s.sale_date=v_today-1 and s.payment_status<>'cancelled'),0) else null end,'ml',coalesce(sum(s.volume_ml) filter(where s.sale_date=v_today-1 and s.payment_status<>'cancelled'),0))
  ) into v_day_summary from public.sales s where s.organization_id=p_organization_id and s.deleted_at is null and s.sale_date between v_today-1 and v_today;

  return jsonb_build_object(
    'generated_at',v_now,'timezone','America/Sao_Paulo',
    'period',jsonb_build_object('key',p_period,'start',v_start_ts,'end',v_end_ts,'uses',case when v_hourly then 'created_at' else 'sale_date' end,'commercial_dates',jsonb_build_array(v_start_date,v_end_date)),
    'viewer',jsonb_build_object('profile',v_profile,'preset',v_preset,'finance_allowed',v_finance,'operations_allowed',v_operations,'management_allowed',v_management),
    'metrics',v_current,'previous_metrics',v_previous,'day_summary',v_day_summary,
    'operations',v_operations_data,'alerts',v_alerts,'top_products',v_top,'recent_sales',v_recent,
    'definitions',jsonb_build_object('sale','Uma linha comercial de sales; o schema não possui entidade de pedido agregador.','item','Uma linha comercial vendida.','ml','Soma de sales.volume_ml.','new_buyer','Primeira compra não cancelada no período.','returning_buyer','Compra anterior não cancelada antes do período.','hourly_time','created_at','daily_time','sale_date')
  );
end;$$;

revoke all on function public.dashboard_summary(uuid,text,date,date) from public,anon;
grant execute on function public.dashboard_summary(uuid,text,date,date) to authenticated,service_role;
notify pgrst,'reload schema';
commit;
