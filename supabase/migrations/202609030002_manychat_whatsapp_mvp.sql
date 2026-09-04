begin;

-- Fonte canônica única das vendas em cobrança. A função de tela e o endpoint
-- ManyChat abaixo consomem esta mesma seleção; a regra continua sendo somente
-- sales.payment_status='pending' com venda não excluída.
create function public.collections_pending_sales_canonical(p_organization_id uuid)
returns table(
  id uuid,client_id uuid,client_number integer,client_name text,
  sale_date date,perfume_name text,perfume_brand text,sale_type text,
  volume_ml numeric,amount numeric,payment_status text,
  last_message_copied_at timestamptz,message_copied_count integer
) language sql stable security definer set search_path=public as $$
  select s.id,s.client_id,c.client_number,c.name,s.sale_date,p.full_name_raw,p.brand_house,
    s.sale_type,s.volume_ml,s.amount,s.payment_status::text,
    ce.last_at,coalesce(ce.total,0)::integer
  from public.sales s
  join public.clients c on c.id=s.client_id and c.organization_id=s.organization_id
  left join public.perfumes p on p.id=s.perfume_id
  left join lateral(
    select max(e.created_at) last_at,count(*) total
    from public.collection_events e
    where e.client_id=s.client_id and e.organization_id=s.organization_id and e.event_type='message_copied'
  ) ce on true
  where s.organization_id=p_organization_id
    and s.deleted_at is null
    and s.payment_status='pending';
$$;
revoke all on function public.collections_pending_sales_canonical(uuid) from public,anon,authenticated;
grant execute on function public.collections_pending_sales_canonical(uuid) to service_role;

drop function if exists public.collections_pending_sales(text);
create function public.collections_pending_sales(p_search text default null)
returns table(
  id uuid,client_id uuid,client_number integer,client_name text,
  sale_date date,perfume_name text,perfume_brand text,sale_type text,volume_ml numeric,amount numeric,payment_status text,
  last_message_copied_at timestamptz,message_copied_count integer
) language sql stable security definer set search_path=public as $$
  select pending.*
  from public.current_user_org_ids() as organizations(organization_id)
  cross join lateral public.collections_pending_sales_canonical(organizations.organization_id) pending
  where public.has_org_permission(organizations.organization_id,'sales.view')
    and(
      coalesce(btrim(p_search),'')=''
      or pending.client_name ilike '%'||btrim(p_search)||'%'
      or pending.client_number::text ilike '%'||btrim(p_search)||'%'
      or pending.perfume_name ilike '%'||btrim(p_search)||'%'
    )
  order by pending.sale_date asc,pending.id asc;
$$;
revoke all on function public.collections_pending_sales(text) from public,anon;
grant execute on function public.collections_pending_sales(text) to authenticated;

-- Chamado apenas pela Edge Function com service_role. O tenant vem de secret
-- backend, nunca do webhook ManyChat. Telefone inexistente/duplicado retorna
-- estado controlado e jamais escolhe uma cliente arbitrariamente.
create function public.whatsapp_customer_balance_v1(p_organization_id uuid,p_normalized_phone text)
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare
  candidate_ids uuid[];
  customer public.clients;
  order_count integer;
  pending_total numeric;
begin
  if p_organization_id is null then raise exception 'organization_required'; end if;
  if p_normalized_phone is null or p_normalized_phone !~ '^55[1-9][0-9]{9,10}$' then
    return jsonb_build_object('status','invalid_phone');
  end if;
  select coalesce(array_agg(distinct c.id order by c.id),'{}'::uuid[]) into candidate_ids
  from public.clients c
  where c.organization_id=p_organization_id
    and c.deleted_at is null and c.merged_into_id is null
    and (c.normalized_whatsapp=p_normalized_phone or c.normalized_phone=p_normalized_phone);
  if cardinality(candidate_ids)=0 then return jsonb_build_object('status','not_found'); end if;
  if cardinality(candidate_ids)>1 then return jsonb_build_object('status','ambiguous'); end if;
  select * into customer from public.clients where id=candidate_ids[1] and organization_id=p_organization_id;
  select count(*)::integer,coalesce(sum(pending.amount),0)
    into order_count,pending_total
  from public.collections_pending_sales_canonical(p_organization_id) pending
  where pending.client_id=customer.id;
  return jsonb_build_object('status','ok','customer_name',customer.name,
    'open_orders',order_count,'total_pending',pending_total);
end;
$$;
revoke all on function public.whatsapp_customer_balance_v1(uuid,text) from public,anon,authenticated;
grant execute on function public.whatsapp_customer_balance_v1(uuid,text) to service_role;

commit;
