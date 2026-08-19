begin;

-- RUAH — Roadmap operacional, FASE 1: separação por frasco físico.
--
-- Pergunta da Ilde que esta fase responde: "Qual frasco devo pegar? Bipei o
-- frasco correto?" — hoje "separar" um item de envio é só um checkbox
-- (shipment_items.separated_at), sem saber QUAL frasco físico foi de fato
-- usado. Esta fase liga o bipe de um inventory_bottles específico a uma
-- linha de shipment_items, e propaga essa ligação até o post_shipment.
--
-- Estritamente aditivo: perfumes sem bottle_tracking_status='active' (a
-- maioria, hoje) continuam funcionando exatamente como antes — bottle_id
-- fica null, o checkbox manual "MARCAR SEPARADO" nunca deixou de funcionar,
-- e post_shipment só ganha um bloco condicional que não faz nada quando não
-- há frasco vinculado.

-- ---------------------------------------------------------------------
-- 1. shipment_items ganha um vínculo opcional a um frasco físico.
--
--    CORREÇÃO (revisão de arquitetura pós-roadmap): esta migration
--    originalmente criava um índice único parcial em bottle_id
--    (shipment_items_active_bottle_uidx), pensado como proteção de
--    concorrência. Na prática ele implementava a semântica ERRADA: "no
--    máximo UMA reivindicação ativa por frasco, para sempre" — e como
--    post_shipment nunca limpa bottle_id nem seta removed_at ao postar,
--    um frasco fonte de SPLIT (decant), que existe justamente para
--    abastecer MUITAS vendas sequenciais ao longo do tempo, ficava
--    permanentemente travado no primeiro envio que o bipasse.
--
--    O índice foi removido. A proteção de concorrência real —
--    "a soma dos compromissos ATIVOS contra um frasco nunca pode
--    ultrapassar seu physical_ml atual" — é uma invariante de SOMA, não
--    de unicidade, e por isso não é expressável como índice único. Ela é
--    garantida em shipment_item_scan_bottle (true replace mais recente:
--    202608190007) via lock pessimista na linha do frasco (`for update`)
--    antes de somar os compromissos ativos e comparar contra physical_ml
--    — a técnica canônica do Postgres para "verificar-então-agir" sob
--    concorrência, não um índice mal empregado para um invariante que
--    índices não conseguem expressar.
-- ---------------------------------------------------------------------
alter table public.shipment_items
  add column if not exists bottle_id uuid references public.inventory_bottles(id);
create index if not exists shipment_items_bottle_idx on public.shipment_items(bottle_id) where bottle_id is not null;

-- ---------------------------------------------------------------------
-- 2. Bipar o frasco na separação. Casos "normais mas não bem-sucedidos"
--    (frasco não encontrado, frasco de outro perfume, ml insuficiente,
--    frasco já usado noutro envio) retornam um jsonb estruturado — nunca
--    uma exceção genérica — para a UI mostrar exatamente "⚠ FRASCO
--    DIFERENTE" e não um erro técnico. Exceção só para os casos realmente
--    excepcionais (papel sem permissão, envio/linha inexistente).
-- ---------------------------------------------------------------------
create or replace function public.shipment_item_scan_bottle(
  p_shipment_id uuid,p_allocation_id uuid,p_scan_value text
) returns jsonb
language plpgsql security definer set search_path=public
as $$
declare
  v_shipment public.shipments; v_item public.shipment_items; v_allocation public.inventory_allocations;
  v_bottle public.inventory_bottles; v_normalized text; v_conflict_shipment_id uuid;
begin
  select * into v_shipment from public.shipments where id=p_shipment_id;
  if v_shipment.id is null or v_shipment.organization_id not in(select public.current_user_org_ids()) then raise exception 'shipment_not_found'; end if;
  if not public.has_org_role(v_shipment.organization_id,array['admin','manager','operator']::public.member_role[])
    then raise exception 'forbidden'; end if;

  select * into v_item from public.shipment_items
    where shipment_id=p_shipment_id and allocation_id=p_allocation_id and removed_at is null for update;
  if v_item.id is null then raise exception 'shipment_item_not_found'; end if;

  select * into v_allocation from public.inventory_allocations where id=p_allocation_id;
  if v_allocation.id is null or not v_allocation.stock_managed or v_allocation.perfume_id is null then
    return jsonb_build_object('ok',false,'reason','not_bottle_tracked');
  end if;

  v_normalized:=btrim(coalesce(p_scan_value,''));
  select b.* into v_bottle from public.inventory_bottles b
    where b.organization_id=v_shipment.organization_id
      and (b.qr_token=v_normalized or upper(b.barcode_value)=upper(v_normalized) or upper(b.bottle_code)=upper(v_normalized))
    limit 1;
  if v_bottle.id is null then
    return jsonb_build_object('ok',false,'reason','bottle_not_found');
  end if;

  if v_bottle.perfume_id<>v_allocation.perfume_id then
    return jsonb_build_object('ok',false,'reason','wrong_perfume','bottle_label',v_bottle.bottle_label,'bottle_code',v_bottle.bottle_code);
  end if;
  if v_bottle.status<>'active' then
    return jsonb_build_object('ok',false,'reason','bottle_unavailable','status',v_bottle.status);
  end if;
  if v_bottle.physical_ml<v_item.quantity_ml then
    return jsonb_build_object('ok',false,'reason','insufficient_ml','available_ml',v_bottle.physical_ml,'needed_ml',v_item.quantity_ml);
  end if;
  select si.shipment_id into v_conflict_shipment_id from public.shipment_items si
    where si.bottle_id=v_bottle.id and si.removed_at is null and si.id<>v_item.id;
  if v_conflict_shipment_id is not null then
    return jsonb_build_object('ok',false,'reason','bottle_already_assigned');
  end if;

  begin
    update public.shipment_items set
      bottle_id=v_bottle.id,
      separated_at=coalesce(separated_at,now()),
      separated_by=coalesce(separated_by,auth.uid())
    where id=v_item.id;
  exception when unique_violation then
    -- Duas leituras do mesmo frasco correndo ao mesmo tempo: o índice único
    -- parcial pegou a segunda. Mesma resposta amigável, não um erro cru.
    return jsonb_build_object('ok',false,'reason','bottle_already_assigned');
  end;

  insert into public.audit_logs(organization_id,actor_id,action,entity_type,entity_id,metadata)
  values(v_shipment.organization_id,auth.uid(),'shipment_item_bottle_scanned','shipment_item',v_item.id::text,
    jsonb_build_object('shipment_id',p_shipment_id,'allocation_id',p_allocation_id,'bottle_id',v_bottle.id,'bottle_code',v_bottle.bottle_code));

  return jsonb_build_object('ok',true,'bottle_id',v_bottle.id,'bottle_code',v_bottle.bottle_code,'bottle_label',v_bottle.bottle_label,
    'physical_ml',v_bottle.physical_ml,'needed_ml',v_item.quantity_ml);
end;
$$;
grant execute on function public.shipment_item_scan_bottle(uuid,uuid,text) to authenticated,service_role;

-- ---------------------------------------------------------------------
-- 3. post_shipment — "true replace" da versão vigente (202608130008): o
--    corpo é idêntico exceto pelo bloco novo dentro do loop, que só age
--    quando a linha de separação tem um frasco vinculado. Sem frasco
--    vinculado, este bloco nunca executa — nenhum envio hoje muda de
--    comportamento.
-- ---------------------------------------------------------------------
create or replace function public.post_shipment(p_shipment_id uuid)
returns void language plpgsql security definer set search_path=public as $$
declare v public.shipments; r record; v_bottle_id uuid; v_bottle_physical numeric;
begin
  select * into v from public.shipments where id=p_shipment_id for update;
  if v.id is null or not public.has_org_role(v.organization_id,array['admin','manager']::public.member_role[]) then raise exception 'forbidden'; end if;
  if v.status in('posted','delivered') then return; end if;
  if v.status not in('label_released','customer_approved') then raise exception 'shipment_not_ready_to_post'; end if;
  for r in select a.* from public.inventory_allocations a where a.shipment_id=v.id and a.status='shipping' for update loop
    if r.stock_managed then
      perform 1 from public.inventory_items where id=r.inventory_item_id and physical_ml>=r.quantity_ml for update;
      if not found then raise exception 'insufficient_physical_inventory'; end if;
      update public.inventory_items set physical_ml=physical_ml-r.quantity_ml,updated_at=now() where id=r.inventory_item_id;

      select si.bottle_id into v_bottle_id from public.shipment_items si
        where si.shipment_id=v.id and si.allocation_id=r.id and si.removed_at is null;
      if v_bottle_id is not null then
        select physical_ml into v_bottle_physical from public.inventory_bottles where id=v_bottle_id for update;
        if v_bottle_physical is not null then
          if v_bottle_physical<r.quantity_ml then raise exception 'insufficient_bottle_inventory'; end if;
          update public.inventory_bottles set
            physical_ml=physical_ml-r.quantity_ml,
            status=case when physical_ml-r.quantity_ml=0 then 'empty' else status end,
            updated_at=now()
          where id=v_bottle_id;
        end if;
      end if;
    end if;
    update public.inventory_allocations set status='shipped',shipped_at=now(),updated_at=now() where id=r.id;
  end loop;
  update public.shipments set status='posted',posted_at=now(),updated_at=now() where id=v.id;
  insert into public.shipment_events(organization_id,shipment_id,event_type,from_status,to_status,actor_id)
    values(v.organization_id,v.id,'shipment_posted',v.status,'posted',auth.uid());
end;$$;

commit;
