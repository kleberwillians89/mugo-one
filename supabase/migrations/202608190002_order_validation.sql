begin;

-- RUAH — Roadmap operacional, FASE 2: validação de pedidos.
--
-- Pergunta do Davi que esta fase responde: "Qual venda está bloqueada?" —
-- hoje essa resposta só existe espalhada, sale a sale, dentro da Venda 360
-- (missingShippingClientFields no cliente) e nunca como uma lista do que
-- precisa de atenção HOJE. Zero coluna nova, zero tabela nova: só uma
-- consulta somando critérios que já existem — perfume não identificado,
-- volume não informado, pagamento não identificado, cadastro do cliente
-- incompleto para envio. security invoker (não definer) porque não precisa
-- bypassar RLS — as políticas já existentes em sales/clients bastam.
create or replace function public.sales_validation_queue(org_id uuid)
returns table(
  sale_id uuid,client_id uuid,client_name text,sale_date date,amount numeric,
  payment_status text,perfume_name text,volume_ml numeric,blocking_reasons text[]
) language sql stable security invoker set search_path=public
as $$
  with base as (
    select
      s.id as sale_id,s.client_id,coalesce(c.name,s.original_client,'Cliente não identificado') as client_name,
      s.sale_date,s.amount,s.payment_status::text as payment_status,s.perfume_name_raw as perfume_name,s.volume_ml,
      array_remove(array[
        case when s.perfume_id is null then 'perfume_nao_identificado' end,
        case when s.volume_ml is null or s.volume_ml<=0 then 'volume_nao_informado' end,
        case when s.payment_status='unknown' then 'pagamento_nao_identificado' end,
        case when c.id is not null and (
          (c.phone is null and c.whatsapp_phone is null) or c.postal_code is null or c.address_line is null
          or c.address_number is null or c.district is null or c.city is null or c.state is null
          or (c.cpf is null and c.cnpj is null)
        ) then 'cadastro_cliente_incompleto' end
      ],null) as blocking_reasons
    from public.sales s left join public.clients c on c.id=s.client_id
    where s.organization_id=org_id and s.deleted_at is null
      and s.payment_status in('paid','pending') and s.shipped_at is null
  )
  select sale_id,client_id,client_name,sale_date,amount,payment_status,perfume_name,volume_ml,blocking_reasons
  from base where array_length(blocking_reasons,1)>0
  order by sale_date;
$$;
grant execute on function public.sales_validation_queue(uuid) to authenticated,service_role;

commit;
