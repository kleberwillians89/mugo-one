begin;

-- Expõe a marca/casa do perfume (public.perfumes.brand_house, já existente)
-- no retorno de collections_pending_sales — pedido explícito da imagem de
-- cobrança (Davi precisa ver a marca, não só o nome do perfume). Mudar a
-- lista de colunas de uma função RETURNS TABLE exige DROP + CREATE (CREATE
-- OR REPLACE não permite alterar o tipo de retorno de uma função existente).
drop function if exists public.collections_pending_sales(text);

create function public.collections_pending_sales(p_search text default null)
returns table(
  id uuid,client_id uuid,client_number integer,client_name text,
  sale_date date,perfume_name text,perfume_brand text,sale_type text,volume_ml numeric,amount numeric,payment_status text,
  last_message_copied_at timestamptz,message_copied_count integer
) language sql stable security definer set search_path=public as $$
  select s.id,s.client_id,c.client_number,c.name,s.sale_date,p.full_name_raw,p.brand_house,s.sale_type,s.volume_ml,s.amount,s.payment_status::text,
    ce.last_at,coalesce(ce.total,0)::integer
  from public.sales s
  join public.clients c on c.id=s.client_id and c.organization_id=s.organization_id
  left join public.perfumes p on p.id=s.perfume_id
  left join lateral(
    select max(e.created_at) last_at,count(*) total from public.collection_events e
    where e.client_id=s.client_id and e.organization_id=s.organization_id and e.event_type='message_copied'
  ) ce on true
  where s.organization_id in(select public.current_user_org_ids())
    and public.has_org_permission(s.organization_id,'sales.view')
    and s.deleted_at is null
    and s.payment_status='pending'
    and(
      coalesce(btrim(p_search),'')=''
      or c.name ilike '%'||btrim(p_search)||'%'
      or c.client_number::text ilike '%'||btrim(p_search)||'%'
      or p.full_name_raw ilike '%'||btrim(p_search)||'%'
    )
  order by s.sale_date asc,s.id asc;
$$;
revoke all on function public.collections_pending_sales(text) from public,anon;
grant execute on function public.collections_pending_sales(text) to authenticated;

commit;
