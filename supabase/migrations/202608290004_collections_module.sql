begin;

-- Módulo Cobranças V1. public.sales continua a única fonte de verdade
-- financeira — este módulo não duplica payment_status/paid_at/payment_method
-- em nenhuma tabela nova. collection_events é só o histórico auditável de
-- CONTATO (mensagem copiada), preparado para, no futuro, ganhar um
-- event_type 'whatsapp_message_sent' sem precisar reconstruir nada aqui:
-- event_type é texto livre (sem enum Postgres a migrar depois), e metadata
-- é jsonb para carregar detalhes do canal quando ele existir.
create table public.collection_events(
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  client_id uuid not null references public.clients(id),
  event_type text not null check(event_type in('message_copied')),
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  metadata jsonb not null default '{}'::jsonb
);
create index collection_events_org_client_idx on public.collection_events(organization_id,client_id,created_at desc);

alter table public.collection_events enable row level security;
create policy collection_events_select on public.collection_events for select using(
  public.has_org_permission(organization_id,'sales.view')
);
-- Escrita só via RPC (security definer) abaixo — nunca insert/update/delete direto do cliente.
revoke insert,update,delete on public.collection_events from authenticated;
grant select on public.collection_events to authenticated;

-- Append-only de verdade, não só por convenção de GRANT: um UPDATE/DELETE
-- aqui é sempre um bug (o histórico de contato nunca deve ser reescrito),
-- então o próprio trigger recusa — vale mesmo para um SECURITY DEFINER
-- futuro que rode com um papel que ignore RLS.
create function public.collection_events_block_mutation() returns trigger language plpgsql set search_path=public as $$
begin
  raise exception 'collection_events_is_append_only';
end;$$;
create trigger collection_events_append_only before update or delete on public.collection_events
  for each row execute function public.collection_events_block_mutation();

-- Lista vendas comercialmente pendentes (payment_status='pending' — a única
-- leitura literal de "pendente" no enum existente; 'unknown' fica de fora de
-- propósito porque significa "não identificado", não "cobrança confirmada",
-- e cobrar por engano um cliente que já pagou é pior que deixar de cobrar um
-- caso ambíguo) agrupável por cliente no frontend. last_message_copied_at/
-- message_copied_count refletem SÓ que a mensagem foi copiada (evento
-- 'message_copied') — nunca que o cliente foi contatado, recebeu ou leu
-- algo: o CRM não sabe disso nesta versão.
create function public.collections_pending_sales(p_search text default null)
returns table(
  id uuid,client_id uuid,client_number integer,client_name text,
  sale_date date,perfume_name text,sale_type text,volume_ml numeric,amount numeric,payment_status text,
  last_message_copied_at timestamptz,message_copied_count integer
) language sql stable security definer set search_path=public as $$
  select s.id,s.client_id,c.client_number,c.name,s.sale_date,p.full_name_raw,s.sale_type,s.volume_ml,s.amount,s.payment_status::text,
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

-- Registra que a mensagem de cobrança foi copiada para aquele cliente.
-- Nunca afirma que a mensagem foi enviada por WhatsApp — o CRM só sabe que
-- Davi copiou o texto (evento 'message_copied').
create function public.collections_log_message_copied(p_client_id uuid,p_metadata jsonb default '{}'::jsonb)
returns public.collection_events language plpgsql security definer set search_path=public as $$
declare c public.clients; ev public.collection_events;
begin
  select * into c from public.clients where id=p_client_id and organization_id in(select public.current_user_org_ids()) and deleted_at is null;
  if c.id is null then raise exception 'client_not_found'; end if;
  if not public.has_org_permission(c.organization_id,'sales.view') then raise exception 'forbidden'; end if;
  insert into public.collection_events(organization_id,client_id,event_type,created_by,metadata)
  values(c.organization_id,c.id,'message_copied',auth.uid(),coalesce(p_metadata,'{}'::jsonb))
  returning * into ev;
  return ev;
end;$$;
revoke all on function public.collections_log_message_copied(uuid,jsonb) from public,anon;
grant execute on function public.collections_log_message_copied(uuid,jsonb) to authenticated;

-- Registra pagamento de uma ou várias vendas selecionadas, transacional
-- (função plpgsql = uma transação implícita: qualquer exceção não capturada
-- desfaz TODAS as linhas já processadas neste loop, inclusive updates e
-- audit_logs anteriores — não há bloco EXCEPTION aqui de propósito, para
-- nunca mascarar uma falha parcial) e idempotente: reenviar a MESMA seleção
-- com a MESMA data/forma sobre vendas já pagas por esta própria chamada
-- anterior não duplica nada (marcado como "skipped", sem novo update nem
-- nova linha de auditoria). Esta função em si só escreve em public.sales
-- (payment_status/paid_at/payment_method/notes) e public.audit_logs —
-- nenhuma tabela de estoque físico é tocada por ELA (sem inventory_items,
-- inventory_movements, inventory_purchase_entries, physical_ml,
-- operational_code, RUAH-P, shipments ou preparation_batches).
--
-- ATENÇÃO — o UPDATE public.sales abaixo dispara os MESMOS triggers
-- canônicos que qualquer outro caminho de escrita já dispara (Davi Excel
-- incluído), sem bypass nem trigger novo criado por este módulo:
--  • audit_sales (202607290002): audita a linha automaticamente.
--  • sync_sale_inventory_allocation (202608130001, redefinida em
--    202608130008/202608230011): quando a venda tem
--    inventory_allocation_eligible=true (só vendas lançadas manualmente no
--    Davi Excel — importações setam false de propósito), marcar como 'paid'
--    PODE criar/ajustar inventory_allocations e mudar available_ml
--    (reserva comercial) — isso é a regra canônica já existente, não algo
--    que Cobranças inventou. Ela NUNCA toca physical_ml/inventory_items
--    físico/inventory_movements/inventory_purchase_entries/shipments/
--    preparation_batches. Se o item não tiver available_ml suficiente, ela
--    levanta 'insufficient_available_inventory', que aborta esta função
--    inteira (nenhuma venda do lote fica parcialmente aplicada).
--  • protect_operator_sale_changes (202607300010): usuário com
--    member_role='operator' NUNCA pode mudar payment_status por aqui — cai
--    em 'operator_shipping_only', mesmo que tenha sales.edit concedido pelo
--    sistema de permissões granular. É a mesma trava que já existe no
--    Davi Excel; Cobranças não abre exceção para ela.
create function public.collections_register_payment(
  p_sale_ids uuid[],
  p_paid_at date,
  p_payment_method text,
  p_notes text default null
) returns jsonb language plpgsql security definer set search_path=public as $$
declare
  ids uuid[]; sale_row public.sales; after_row public.sales;
  changed_ids uuid[]:=array[]::uuid[]; skipped_ids uuid[]:=array[]::uuid[]; resolved_ids uuid[]:=array[]::uuid[];
  note_suffix text; clean_method text;
begin
  if p_sale_ids is null or array_length(p_sale_ids,1) is null then raise exception 'no_sales_selected'; end if;
  if p_paid_at is null then raise exception 'paid_at_required'; end if;
  clean_method:=nullif(btrim(coalesce(p_payment_method,'')),'');
  if clean_method is null then raise exception 'payment_method_required'; end if;
  select array_agg(distinct x) into ids from unnest(p_sale_ids) x;

  for sale_row in
    select * from public.sales
     where id=any(ids) and deleted_at is null and organization_id in(select public.current_user_org_ids())
     order by id for update
  loop
    resolved_ids:=array_append(resolved_ids,sale_row.id);
    if not public.has_org_permission(sale_row.organization_id,'sales.edit') then raise exception 'forbidden'; end if;
    if sale_row.payment_status='cancelled' then raise exception 'sale_cancelled:%',sale_row.id; end if;

    if sale_row.payment_status='paid' then
      if sale_row.paid_at is distinct from p_paid_at or coalesce(sale_row.payment_method,'')<>clean_method then
        raise exception 'sale_already_paid:%',sale_row.id;
      end if;
      skipped_ids:=array_append(skipped_ids,sale_row.id);
      continue;
    end if;

    note_suffix:=nullif(btrim(coalesce(p_notes,'')),'');
    update public.sales set
      payment_status='paid',
      paid_at=p_paid_at,
      payment_method=clean_method,
      notes=case when note_suffix is null then notes
        else trim(both E'\n' from coalesce(notes,'')||case when coalesce(notes,'')<>'' then E'\n' else '' end||'Pagamento: '||note_suffix) end,
      updated_at=now()
     where id=sale_row.id returning * into after_row;

    changed_ids:=array_append(changed_ids,after_row.id);
    insert into public.audit_logs(organization_id,actor_id,action,entity_type,entity_id,metadata)
    values(sale_row.organization_id,auth.uid(),'collections_payment_registered','sale',sale_row.id::text,
      jsonb_build_object('sale_id',sale_row.id,'client_id',sale_row.client_id,
        'status_before',sale_row.payment_status,'status_after',after_row.payment_status,
        'paid_at',after_row.paid_at,'payment_method',after_row.payment_method));
  end loop;

  if array_length(resolved_ids,1) is distinct from array_length(ids,1) then raise exception 'sale_not_found'; end if;

  return jsonb_build_object('changed_sale_ids',to_jsonb(changed_ids),'skipped_sale_ids',to_jsonb(skipped_ids),
    'paid_at',p_paid_at,'payment_method',clean_method);
end;$$;
revoke all on function public.collections_register_payment(uuid[],date,text,text) from public,anon;
grant execute on function public.collections_register_payment(uuid[],date,text,text) to authenticated;

commit;
