begin;

-- ==========================================================================
-- CLIENTE COM BRINDE
-- --------------------------------------------------------------------------
-- O brinde pertence ao CLIENTE. Existe UMA flag canônica por cliente
-- (clients.has_gift); as vendas do cliente apenas a refletem visualmente.
-- Nada aqui toca public.sales, estoque, ML, allocation, RUAH-P, physical_ml,
-- purchase entries, preparação ou envio.
-- ==========================================================================
alter table public.clients add column if not exists has_gift boolean not null default false;
alter table public.clients add column if not exists gift_notes text;

alter table public.clients add constraint clients_gift_notes_requires_gift
  check (gift_notes is null or has_gift = true);

comment on column public.clients.has_gift is
  'Cliente possui um brinde previsto. Flag canônica única (não replicada em public.sales); não afeta estoque, ML, allocation, RUAH-P, preparação ou envio.';
comment on column public.clients.gift_notes is
  'Observação livre e opcional sobre o brinde do cliente. NULL quando has_gift=false.';

create index clients_org_has_gift_idx on public.clients (organization_id)
  where has_gift = true and deleted_at is null;

-- --------------------------------------------------------------------------
-- Único escritor de has_gift / gift_notes. Valida tenant, permissão
-- clients.edit, optimistic concurrency opcional e grava audit before/after.
-- Marcar/desmarcar brinde NUNCA cria venda nem dispara escrita operacional.
-- --------------------------------------------------------------------------
create or replace function public.davi_excel_set_client_gift(
  p_client_id uuid,
  p_has_gift boolean,
  p_gift_notes text default null,
  p_expected_updated_at timestamptz default null
) returns jsonb
language plpgsql security definer set search_path=public as $$
declare before_row public.clients; after_row public.clients; next_gift boolean:=coalesce(p_has_gift,false); next_notes text;
begin
  if auth.uid() is null then raise exception 'authentication_required'; end if;

  select * into before_row from public.clients
    where id=p_client_id
      and organization_id in (select public.current_user_org_ids())
      and deleted_at is null
    for update;
  if before_row.id is null then raise exception 'client_not_found'; end if;

  if not public.has_org_permission(before_row.organization_id,'clients.edit') then raise exception 'forbidden'; end if;

  if p_expected_updated_at is not null and before_row.updated_at is distinct from p_expected_updated_at then
    raise exception 'stale_client';
  end if;

  next_notes := case when next_gift then nullif(btrim(p_gift_notes),'') else null end;

  if before_row.has_gift = next_gift and before_row.gift_notes is not distinct from next_notes then
    return jsonb_build_object('id',before_row.id,'has_gift',before_row.has_gift,
      'gift_notes',before_row.gift_notes,'updated_at',before_row.updated_at,'changed',false);
  end if;

  update public.clients set
    has_gift=next_gift,
    gift_notes=next_notes,
    updated_at=now()
  where id=before_row.id
  returning * into after_row;

  insert into public.audit_logs(organization_id,actor_id,action,entity_type,entity_id,metadata)
  values(before_row.organization_id,auth.uid(),'client_gift_updated','client',before_row.id::text,
    jsonb_build_object(
      'before',jsonb_build_object('has_gift',before_row.has_gift,'gift_notes',before_row.gift_notes),
      'after',jsonb_build_object('has_gift',after_row.has_gift,'gift_notes',after_row.gift_notes),
      'sale_created',false,'inventory_untouched',true));

  return jsonb_build_object('id',after_row.id,'has_gift',after_row.has_gift,
    'gift_notes',after_row.gift_notes,'updated_at',after_row.updated_at,'changed',true);
end;$$;
revoke all on function public.davi_excel_set_client_gift(uuid,boolean,text,timestamptz) from public,anon;
grant execute on function public.davi_excel_set_client_gift(uuid,boolean,text,timestamptz) to authenticated;

-- --------------------------------------------------------------------------
-- Read model Davi Excel: expõe clients.has_gift (leitura + filtro). Não
-- duplica a informação: dez vendas da mesma cliente leem a mesma flag.
-- --------------------------------------------------------------------------
drop function if exists public.davi_excel_dataset();
create function public.davi_excel_dataset()
returns table(
 id uuid,client_id uuid,client_number integer,client_name text,has_gift boolean,sale_date date,shipping_deadline_display text,shipping_deadline_date date,
 shipped_at timestamptz,sale_type text,volume_ml numeric,perfume_name text,split_completed_at date,amount numeric,
 payment_status text,payment_method text,paid_at date,credit_reference_amount numeric,notes text,
 operational_status text,search_reference text
) language sql stable security definer set search_path=public as $$
 select s.id,s.client_id,c.client_number,c.name,c.has_gift,s.sale_date,
 case when coalesce(active_shipment.posted_at,s.shipped_at) is not null then 'ENVIADO' when s.payment_status='cancelled' then 'CANCELADO' when s.shipping_available_date is not null and s.shipping_availability_confirmed_at is null then to_char(s.shipping_available_date,'DD/MM/YYYY') else null end,
 s.shipping_available_date,coalesce(active_shipment.posted_at,s.shipped_at),s.sale_type,s.volume_ml,p.full_name_raw,s.split_completed_at,s.amount,s.payment_status::text,s.payment_method,s.paid_at,s.credit_reference_amount,s.notes,
 case when s.payment_status='cancelled' then 'CANCELADO' when coalesce(active_shipment.posted_at,s.shipped_at) is not null then 'ENVIADO' when active_shipment.shipment_id is not null then 'ENVIO EM ANDAMENTO' when active_client.request_id is not null and own_request.request_id is null then 'PRÓXIMO ENVIO' when own_request.request_id is not null then 'ENVIO EM ANDAMENTO' when s.shipping_availability_confirmed_at is null then 'AGUARDANDO PERFUME' when coalesce(prep.prepared_ml,0)<coalesce(a.quantity_ml,s.volume_ml,0) then 'AGUARDANDO PREPARAÇÃO' else 'PRONTO PARA ENVIO' end,
 coalesce(s.import_signature,'')
 from public.sales s
 join public.clients c on c.id=s.client_id and c.organization_id=s.organization_id
 left join public.perfumes p on p.id=s.perfume_id
 left join public.inventory_allocations a on a.sale_id=s.id and a.status in('reserved','shipping','shipped')
 left join lateral(select sum(bi.quantity_ml) prepared_ml from public.preparation_batch_items bi join public.preparation_batches b on b.id=bi.batch_id and b.status='confirmed' where bi.allocation_id=a.id) prep on true
 left join lateral(select sh.id shipment_id,sh.status,sh.posted_at from public.shipment_items si join public.shipments sh on sh.id=si.shipment_id where si.sale_id=s.id and si.removed_at is null and sh.status<>'cancelled' order by sh.created_at desc limit 1) active_shipment on true
 left join lateral(select r.id request_id from public.customer_shipment_request_items ri join public.customer_shipment_requests r on r.id=ri.request_id left join public.shipments sh on sh.id=r.converted_shipment_id where ri.allocation_id=a.id and ((r.status='requested' and r.converted_shipment_id is null) or(r.status='converted' and sh.status not in('posted','delivered','cancelled'))) limit 1) own_request on true
 left join lateral(select r.id request_id from public.customer_shipment_requests r left join public.shipments sh on sh.id=r.converted_shipment_id where r.client_id=s.client_id and ((r.status='requested' and r.converted_shipment_id is null) or(r.status='converted' and sh.status not in('posted','delivered','cancelled'))) limit 1) active_client on true
 where s.organization_id in(select public.current_user_org_ids())
 and public.has_org_permission(s.organization_id,'sales.view') and s.deleted_at is null;
$$;
revoke all on function public.davi_excel_dataset() from public,anon;
grant execute on function public.davi_excel_dataset() to authenticated;

create or replace function public.davi_excel_list_multi(
 p_filters jsonb default '{}'::jsonb,p_page integer default 0,p_page_size integer default 100,
 p_sorts jsonb default '[{"column":"sale_date","direction":"asc"},{"column":"perfume","direction":"asc"},{"column":"type","direction":"asc"},{"column":"volume","direction":"desc"}]'::jsonb
) returns jsonb language plpgsql stable security definer set search_path=public as $$
declare level jsonb;column_name text;direction text;expression text;order_clause text:='';result jsonb;position integer:=0;
begin
 if jsonb_typeof(p_sorts)<>'array' then raise exception 'invalid_sort';end if;
 for level in select value from jsonb_array_elements(p_sorts) loop
  position:=position+1;if position>5 then exit;end if;
  column_name:=level->>'column';direction:=lower(level->>'direction');
  if direction not in('asc','desc') then raise exception 'invalid_sort_direction';end if;
  expression:=case column_name
   when 'client' then 'public.davi_excel_sort_text(client_name)'
   when 'sale_date' then 'sale_date'
   when 'deadline' then 'shipping_deadline_date'
   when 'shipped_at' then 'shipped_at'
   when 'type' then 'public.davi_excel_sort_text(sale_type)'
   when 'volume' then 'volume_ml'
   when 'perfume' then 'public.davi_excel_sort_text(perfume_name)'
   when 'split_completed_at' then 'split_completed_at'
   when 'amount' then 'amount'
   when 'payment' then 'public.davi_excel_sort_text(payment_status)'
   when 'method' then 'public.davi_excel_sort_text(payment_method)'
   when 'paid_at' then 'paid_at'
   when 'credit' then 'credit_reference_amount'
   when 'notes' then 'public.davi_excel_sort_text(notes)'
   else null end;
  if expression is null then raise exception 'invalid_sort_column';end if;
  order_clause:=order_clause||case when order_clause='' then '' else ',' end||expression||' '||direction||' nulls last';
 end loop;
 if order_clause='' then order_clause:='sale_date asc nulls last,public.davi_excel_sort_text(perfume_name) asc nulls last,public.davi_excel_sort_text(sale_type) asc nulls last,volume_ml desc nulls last';end if;
 execute format($query$
  with filtered as(
   select * from public.davi_excel_dataset() d where
   (coalesce($1->>'search','')='' or d.client_name ilike '%%'||($1->>'search')||'%%' or d.perfume_name ilike '%%'||($1->>'search')||'%%' or d.notes ilike '%%'||($1->>'search')||'%%' or d.search_reference ilike '%%'||($1->>'search')||'%%') and
   (coalesce($1->>'split','all')='all' or ($1->>'split'='completed' and d.sale_type='SPLIT' and d.split_completed_at is not null) or ($1->>'split'='pending' and d.sale_type='SPLIT' and d.split_completed_at is null)) and
   (coalesce($1->>'gift','all')='all' or ($1->>'gift'='with' and d.has_gift) or ($1->>'gift'='without' and not d.has_gift)) and
   public.davi_excel_filter_matches($1#>'{columns,client}',d.client_name,null,null,'text') and
   public.davi_excel_filter_matches($1#>'{columns,sale_date}',d.sale_date::text,null,d.sale_date,'date') and
   public.davi_excel_filter_matches($1#>'{columns,deadline}',coalesce(d.shipping_deadline_display,d.operational_status),null,d.shipping_deadline_date,'date') and
   public.davi_excel_filter_matches($1#>'{columns,shipped_at}',d.shipped_at::date::text,null,d.shipped_at::date,'date') and
   public.davi_excel_filter_matches($1#>'{columns,type}',d.sale_type,null,null,'text') and
   public.davi_excel_filter_matches($1#>'{columns,volume}',d.volume_ml::text,d.volume_ml,null,'number') and
   public.davi_excel_filter_matches($1#>'{columns,perfume}',d.perfume_name,null,null,'text') and
   public.davi_excel_filter_matches($1#>'{columns,split_completed_at}',d.split_completed_at::text,null,d.split_completed_at,'date') and
   public.davi_excel_filter_matches($1#>'{columns,amount}',d.amount::text,d.amount,null,'number') and
   public.davi_excel_filter_matches($1#>'{columns,payment}',d.payment_status,null,null,'text') and
   public.davi_excel_filter_matches($1#>'{columns,method}',d.payment_method,null,null,'text') and
   public.davi_excel_filter_matches($1#>'{columns,paid_at}',d.paid_at::text,null,d.paid_at,'date') and
   public.davi_excel_filter_matches($1#>'{columns,credit}',d.credit_reference_amount::text,d.credit_reference_amount,null,'number') and
   public.davi_excel_filter_matches($1#>'{columns,notes}',d.notes,null,null,'text')
  ),counted as(select *,count(*)over() total_count from filtered),ordered as(
   select * from counted order by %s,id desc limit $2 offset $3
  ) select jsonb_build_object('rows',coalesce(jsonb_agg(to_jsonb(ordered)-'total_count'-'search_reference'-'shipping_deadline_date'),'[]'::jsonb),'total',coalesce(max(total_count),0)) from ordered
 $query$,order_clause) into result using coalesce(p_filters,'{}'::jsonb),least(greatest(p_page_size,1),500),greatest(p_page,0)*least(greatest(p_page_size,1),500);
 return result;
end;$$;
revoke all on function public.davi_excel_list_multi(jsonb,integer,integer,jsonb) from public,anon;
grant execute on function public.davi_excel_list_multi(jsonb,integer,integer,jsonb) to authenticated;

create or replace function public.davi_excel_distinct(p_column text,p_filters jsonb default '{}'::jsonb,p_search text default '',p_offset integer default 0,p_limit integer default 200)
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare cleaned jsonb:=coalesce(p_filters,'{}'::jsonb);result jsonb;
begin
 if p_column not in('client','sale_date','deadline','shipped_at','type','volume','perfume','split_completed_at','amount','payment','method','paid_at','credit','notes') then raise exception 'invalid_filter_column';end if;
 cleaned:=jsonb_set(cleaned,'{columns}',coalesce(cleaned->'columns','{}'::jsonb)-p_column,true);
 with filtered as(
  select d.* from public.davi_excel_dataset() d where
  (coalesce(cleaned->>'search','')='' or d.client_name ilike '%'||(cleaned->>'search')||'%' or d.perfume_name ilike '%'||(cleaned->>'search')||'%' or d.notes ilike '%'||(cleaned->>'search')||'%') and
  (coalesce(cleaned->>'split','all')='all' or (cleaned->>'split'='completed' and d.sale_type='SPLIT' and d.split_completed_at is not null) or (cleaned->>'split'='pending' and d.sale_type='SPLIT' and d.split_completed_at is null)) and
  (coalesce(cleaned->>'gift','all')='all' or (cleaned->>'gift'='with' and d.has_gift) or (cleaned->>'gift'='without' and not d.has_gift)) and
  public.davi_excel_filter_matches(cleaned#>'{columns,client}',d.client_name,null,null,'text') and public.davi_excel_filter_matches(cleaned#>'{columns,sale_date}',d.sale_date::text,null,d.sale_date,'date') and public.davi_excel_filter_matches(cleaned#>'{columns,deadline}',coalesce(d.shipping_deadline_display,d.operational_status),null,d.shipping_deadline_date,'date') and public.davi_excel_filter_matches(cleaned#>'{columns,shipped_at}',d.shipped_at::date::text,null,d.shipped_at::date,'date') and public.davi_excel_filter_matches(cleaned#>'{columns,type}',d.sale_type,null,null,'text') and public.davi_excel_filter_matches(cleaned#>'{columns,volume}',d.volume_ml::text,d.volume_ml,null,'number') and public.davi_excel_filter_matches(cleaned#>'{columns,perfume}',d.perfume_name,null,null,'text') and public.davi_excel_filter_matches(cleaned#>'{columns,split_completed_at}',d.split_completed_at::text,null,d.split_completed_at,'date') and public.davi_excel_filter_matches(cleaned#>'{columns,amount}',d.amount::text,d.amount,null,'number') and public.davi_excel_filter_matches(cleaned#>'{columns,payment}',d.payment_status,null,null,'text') and public.davi_excel_filter_matches(cleaned#>'{columns,method}',d.payment_method,null,null,'text') and public.davi_excel_filter_matches(cleaned#>'{columns,paid_at}',d.paid_at::text,null,d.paid_at,'date') and public.davi_excel_filter_matches(cleaned#>'{columns,credit}',d.credit_reference_amount::text,d.credit_reference_amount,null,'number') and public.davi_excel_filter_matches(cleaned#>'{columns,notes}',d.notes,null,null,'text')
 ),valueset as(
  select case p_column when 'client' then client_name when 'sale_date' then sale_date::text when 'deadline' then coalesce(shipping_deadline_display,operational_status) when 'shipped_at' then shipped_at::date::text when 'type' then sale_type when 'volume' then volume_ml::text when 'perfume' then perfume_name when 'split_completed_at' then split_completed_at::text when 'amount' then amount::text when 'payment' then payment_status when 'method' then payment_method when 'paid_at' then paid_at::text when 'credit' then credit_reference_amount::text when 'notes' then notes end value,count(*) amount from filtered group by 1
 ),searched as(select * from valueset where coalesce(value,'') ilike '%'||coalesce(p_search,'')||'%'),windowed as(select *,count(*)over() total_values from searched order by value nulls first limit least(greatest(p_limit,1),250) offset greatest(p_offset,0))
 select jsonb_build_object('values',coalesce(jsonb_agg(jsonb_build_object('value',coalesce(value,'__BLANK__'),'count',amount) order by value nulls first),'[]'::jsonb),'total',coalesce(max(total_values),0),'has_more',coalesce(max(total_values),0)>greatest(p_offset,0)+least(greatest(p_limit,1),250)) into result from windowed;
 return coalesce(result,jsonb_build_object('values','[]'::jsonb,'total',0,'has_more',false));
end;$$;
revoke all on function public.davi_excel_distinct(text,jsonb,text,integer,integer) from public,anon;
grant execute on function public.davi_excel_distinct(text,jsonb,text,integer,integer) to authenticated;

commit;
