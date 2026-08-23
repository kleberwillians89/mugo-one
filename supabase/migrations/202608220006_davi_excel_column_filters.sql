begin;

-- Read model compartilhado pelas duas RPCs do Davi Excel. Continua sendo
-- apenas uma visão das entidades canônicas; não persiste nem duplica dados.
create or replace function public.davi_excel_dataset()
returns table(
 id uuid,client_name text,sale_date date,shipping_deadline_display text,shipping_deadline_date date,
 shipped_at timestamptz,sale_type text,volume_ml numeric,perfume_name text,amount numeric,
 payment_status text,payment_method text,paid_at date,credit_reference_amount numeric,notes text,
 operational_status text,search_reference text
) language sql stable security definer set search_path=public as $$
 select s.id,c.name,s.sale_date,
 case when coalesce(ship.posted_at,s.shipped_at) is not null then 'ENVIADO' when s.payment_status='cancelled' then 'CANCELADO' when s.shipping_available_date is not null and s.shipping_availability_confirmed_at is null then to_char(s.shipping_available_date,'DD/MM/YYYY') else null end,
 s.shipping_available_date,coalesce(ship.posted_at,s.shipped_at),s.sale_type,s.volume_ml,p.full_name_raw,s.amount,s.payment_status::text,s.payment_method,s.paid_at,s.credit_reference_amount,s.notes,
 case when s.payment_status='cancelled' then 'CANCELADO' when coalesce(ship.posted_at,s.shipped_at) is not null then 'ENVIADO' when active_client.request_id is not null and own_request.request_id is null then 'PRÓXIMO ENVIO' when own_request.request_id is not null then 'ENVIO EM ANDAMENTO' when s.shipping_availability_confirmed_at is null then 'AGUARDANDO PERFUME' when coalesce(prep.prepared_ml,0)<coalesce(a.quantity_ml,s.volume_ml,0) then 'AGUARDANDO PREPARAÇÃO' else 'PRONTO PARA ENVIO' end,
 coalesce(s.import_signature,'')
 from public.sales s
 join public.clients c on c.id=s.client_id and c.organization_id=s.organization_id
 left join public.perfumes p on p.id=s.perfume_id
 left join public.inventory_allocations a on a.sale_id=s.id
 left join lateral(select sum(bi.quantity_ml) prepared_ml from public.preparation_batch_items bi join public.preparation_batches b on b.id=bi.batch_id and b.status='confirmed' where bi.allocation_id=a.id) prep on true
 left join lateral(select sh.posted_at from public.shipment_items si join public.shipments sh on sh.id=si.shipment_id where si.sale_id=s.id and si.removed_at is null order by sh.created_at desc limit 1) ship on true
 left join lateral(select r.id request_id from public.customer_shipment_request_items ri join public.customer_shipment_requests r on r.id=ri.request_id left join public.shipments sh on sh.id=r.converted_shipment_id where ri.allocation_id=a.id and ((r.status='requested' and r.converted_shipment_id is null) or(r.status='converted' and sh.status not in('posted','delivered','cancelled'))) limit 1) own_request on true
 left join lateral(select r.id request_id from public.customer_shipment_requests r left join public.shipments sh on sh.id=r.converted_shipment_id where r.client_id=s.client_id and ((r.status='requested' and r.converted_shipment_id is null) or(r.status='converted' and sh.status not in('posted','delivered','cancelled'))) limit 1) active_client on true
 where s.organization_id in(select public.current_user_org_ids())
 and public.has_org_permission(s.organization_id,'sales.view') and s.deleted_at is null;
$$;
revoke all on function public.davi_excel_dataset() from public,anon;
grant execute on function public.davi_excel_dataset() to authenticated;

-- Um único avaliador permite combinar, com AND, valores e condições de todas
-- as treze colunas sem SQL dinâmico nem nomes de coluna vindos do browser.
create or replace function public.davi_excel_filter_matches(p_filter jsonb,p_text text,p_number numeric,p_date date,p_kind text)
returns boolean language plpgsql immutable set search_path=public as $$
declare op text:=coalesce(p_filter#>>'{condition,operator}','');v1 text:=p_filter#>>'{condition,value}';v2 text:=p_filter#>>'{condition,value2}';values_ok boolean:=true;condition_ok boolean:=true;
begin
 if p_filter is null or p_filter='{}'::jsonb then return true;end if;
 if p_filter?'values' then
  select exists(select 1 from jsonb_array_elements_text(p_filter->'values') x(value) where x.value=coalesce(p_text,'__BLANK__')) into values_ok;
 end if;
 if op<>'' then
  if p_kind='text' then
   condition_ok:=case op when 'contains' then coalesce(p_text,'') ilike '%'||coalesce(v1,'')||'%' when 'not_contains' then coalesce(p_text,'') not ilike '%'||coalesce(v1,'')||'%' when 'starts_with' then coalesce(p_text,'') ilike coalesce(v1,'')||'%' when 'ends_with' then coalesce(p_text,'') ilike '%'||coalesce(v1,'') when 'equals' then lower(coalesce(p_text,''))=lower(coalesce(v1,'')) else true end;
  elsif p_kind='number' then
   condition_ok:=case op when 'eq' then p_number=v1::numeric when 'gt' then p_number>v1::numeric when 'gte' then p_number>=v1::numeric when 'lt' then p_number<v1::numeric when 'lte' then p_number<=v1::numeric when 'between' then p_number between v1::numeric and v2::numeric else true end;
  elsif p_kind='date' then
   condition_ok:=case op when 'eq' then p_date=v1::date when 'before' then p_date<v1::date when 'after' then p_date>v1::date when 'between' then p_date between v1::date and v2::date else true end;
  end if;
 end if;
 return coalesce(values_ok,false) and coalesce(condition_ok,false);
exception when invalid_text_representation or datetime_field_overflow then return false;
end;$$;
revoke all on function public.davi_excel_filter_matches(jsonb,text,numeric,date,text) from public,anon;
grant execute on function public.davi_excel_filter_matches(jsonb,text,numeric,date,text) to authenticated;

create or replace function public.davi_excel_list(p_filters jsonb default '{}'::jsonb,p_page integer default 0,p_page_size integer default 100,p_sort text default 'sale_date_desc')
returns jsonb language sql stable security definer set search_path=public as $$
with filtered as(
 select * from public.davi_excel_dataset() d where
 (coalesce(p_filters->>'search','')='' or d.client_name ilike '%'||(p_filters->>'search')||'%' or d.perfume_name ilike '%'||(p_filters->>'search')||'%' or d.notes ilike '%'||(p_filters->>'search')||'%' or d.search_reference ilike '%'||(p_filters->>'search')||'%') and
 public.davi_excel_filter_matches(p_filters#>'{columns,client}',d.client_name,null,null,'text') and
 public.davi_excel_filter_matches(p_filters#>'{columns,sale_date}',d.sale_date::text,null,d.sale_date,'date') and
 public.davi_excel_filter_matches(p_filters#>'{columns,deadline}',coalesce(d.shipping_deadline_display,d.operational_status),null,d.shipping_deadline_date,'date') and
 public.davi_excel_filter_matches(p_filters#>'{columns,shipped_at}',d.shipped_at::date::text,null,d.shipped_at::date,'date') and
 public.davi_excel_filter_matches(p_filters#>'{columns,type}',d.sale_type,null,null,'text') and
 public.davi_excel_filter_matches(p_filters#>'{columns,volume}',d.volume_ml::text,d.volume_ml,null,'number') and
 public.davi_excel_filter_matches(p_filters#>'{columns,perfume}',d.perfume_name,null,null,'text') and
 public.davi_excel_filter_matches(p_filters#>'{columns,amount}',d.amount::text,d.amount,null,'number') and
 public.davi_excel_filter_matches(p_filters#>'{columns,payment}',d.payment_status,null,null,'text') and
 public.davi_excel_filter_matches(p_filters#>'{columns,method}',d.payment_method,null,null,'text') and
 public.davi_excel_filter_matches(p_filters#>'{columns,paid_at}',d.paid_at::text,null,d.paid_at,'date') and
 public.davi_excel_filter_matches(p_filters#>'{columns,credit}',d.credit_reference_amount::text,d.credit_reference_amount,null,'number') and
 public.davi_excel_filter_matches(p_filters#>'{columns,notes}',d.notes,null,null,'text')
),counted as(select *,count(*)over() total_count from filtered),ordered as(
 select * from counted order by
 case when p_sort='client_asc' then client_name end asc,case when p_sort='client_desc' then client_name end desc,
 case when p_sort='sale_date_asc' then sale_date end asc,case when p_sort='sale_date_desc' then sale_date end desc,
 case when p_sort='deadline_asc' then shipping_deadline_date end asc nulls last,case when p_sort='deadline_desc' then shipping_deadline_date end desc nulls last,
 case when p_sort='shipped_at_asc' then shipped_at end asc,case when p_sort='shipped_at_desc' then shipped_at end desc,
 case when p_sort='type_asc' then sale_type end asc,case when p_sort='type_desc' then sale_type end desc,
 case when p_sort='volume_asc' then volume_ml end asc,case when p_sort='volume_desc' then volume_ml end desc,
 case when p_sort='perfume_asc' then perfume_name end asc,case when p_sort='perfume_desc' then perfume_name end desc,
 case when p_sort='amount_asc' then amount end asc,case when p_sort='amount_desc' then amount end desc,
 case when p_sort='payment_asc' then payment_status end asc,case when p_sort='payment_desc' then payment_status end desc,
 case when p_sort='method_asc' then payment_method end asc,case when p_sort='method_desc' then payment_method end desc,
 case when p_sort='paid_at_asc' then paid_at end asc,case when p_sort='paid_at_desc' then paid_at end desc,
 case when p_sort='credit_asc' then credit_reference_amount end asc,case when p_sort='credit_desc' then credit_reference_amount end desc,
 case when p_sort='notes_asc' then notes end asc,case when p_sort='notes_desc' then notes end desc,id desc
 limit least(greatest(p_page_size,1),500) offset greatest(p_page,0)*least(greatest(p_page_size,1),500)
)
select jsonb_build_object('rows',coalesce(jsonb_agg(to_jsonb(ordered)-'total_count'-'search_reference'-'shipping_deadline_date'),'[]'::jsonb),'total',coalesce(max(total_count),0)) from ordered;
$$;
revoke all on function public.davi_excel_list(jsonb,integer,integer,text) from public,anon;
grant execute on function public.davi_excel_list(jsonb,integer,integer,text) to authenticated;

-- Valores distintos vêm do dataset inteiro já tenant-scoped. Os demais
-- filtros permanecem ativos; apenas o filtro da coluna aberta é removido.
create function public.davi_excel_distinct(p_column text,p_filters jsonb default '{}'::jsonb,p_search text default '',p_offset integer default 0,p_limit integer default 200)
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare cleaned jsonb:=coalesce(p_filters,'{}'::jsonb);result jsonb;
begin
 if p_column not in('client','sale_date','deadline','shipped_at','type','volume','perfume','amount','payment','method','paid_at','credit','notes') then raise exception 'invalid_filter_column';end if;
 cleaned:=jsonb_set(cleaned,'{columns}',coalesce(cleaned->'columns','{}'::jsonb)-p_column,true);
 with filtered as(
  select d.* from public.davi_excel_dataset() d where
  (coalesce(cleaned->>'search','')='' or d.client_name ilike '%'||(cleaned->>'search')||'%' or d.perfume_name ilike '%'||(cleaned->>'search')||'%' or d.notes ilike '%'||(cleaned->>'search')||'%') and
  public.davi_excel_filter_matches(cleaned#>'{columns,client}',d.client_name,null,null,'text') and public.davi_excel_filter_matches(cleaned#>'{columns,sale_date}',d.sale_date::text,null,d.sale_date,'date') and public.davi_excel_filter_matches(cleaned#>'{columns,deadline}',coalesce(d.shipping_deadline_display,d.operational_status),null,d.shipping_deadline_date,'date') and public.davi_excel_filter_matches(cleaned#>'{columns,shipped_at}',d.shipped_at::date::text,null,d.shipped_at::date,'date') and public.davi_excel_filter_matches(cleaned#>'{columns,type}',d.sale_type,null,null,'text') and public.davi_excel_filter_matches(cleaned#>'{columns,volume}',d.volume_ml::text,d.volume_ml,null,'number') and public.davi_excel_filter_matches(cleaned#>'{columns,perfume}',d.perfume_name,null,null,'text') and public.davi_excel_filter_matches(cleaned#>'{columns,amount}',d.amount::text,d.amount,null,'number') and public.davi_excel_filter_matches(cleaned#>'{columns,payment}',d.payment_status,null,null,'text') and public.davi_excel_filter_matches(cleaned#>'{columns,method}',d.payment_method,null,null,'text') and public.davi_excel_filter_matches(cleaned#>'{columns,paid_at}',d.paid_at::text,null,d.paid_at,'date') and public.davi_excel_filter_matches(cleaned#>'{columns,credit}',d.credit_reference_amount::text,d.credit_reference_amount,null,'number') and public.davi_excel_filter_matches(cleaned#>'{columns,notes}',d.notes,null,null,'text')
 ),valueset as(
  select case p_column when 'client' then client_name when 'sale_date' then sale_date::text when 'deadline' then coalesce(shipping_deadline_display,operational_status) when 'shipped_at' then shipped_at::date::text when 'type' then sale_type when 'volume' then volume_ml::text when 'perfume' then perfume_name when 'amount' then amount::text when 'payment' then payment_status when 'method' then payment_method when 'paid_at' then paid_at::text when 'credit' then credit_reference_amount::text when 'notes' then notes end value,count(*) amount from filtered group by 1
 ),searched as(select * from valueset where coalesce(value,'') ilike '%'||coalesce(p_search,'')||'%'),windowed as(select *,count(*)over() total_values from searched order by value nulls first limit least(greatest(p_limit,1),250) offset greatest(p_offset,0))
 select jsonb_build_object('values',coalesce(jsonb_agg(jsonb_build_object('value',coalesce(value,'__BLANK__'),'count',amount) order by value nulls first),'[]'::jsonb),'total',coalesce(max(total_values),0),'has_more',coalesce(max(total_values),0)>greatest(p_offset,0)+least(greatest(p_limit,1),250)) into result from windowed;
 return coalesce(result,jsonb_build_object('values','[]'::jsonb,'total',0,'has_more',false));
end;$$;
revoke all on function public.davi_excel_distinct(text,jsonb,text,integer,integer) from public,anon;
grant execute on function public.davi_excel_distinct(text,jsonb,text,integer,integer) to authenticated;

commit;
