begin;

-- RUAH — Priority 0B: identidade física do FRASCO DE SPLIT (vidro
-- fracionado), um terceiro objeto distinto de PERFUME (produto) e de
-- FRASCO FONTE (inventory_bottles). Modelado como irmã direta de
-- inventory_bottles (mesma forma de colunas/RLS/convenção de status
-- text+check) porque é exatamente o mesmo tipo de problema: uma unidade
-- física individual com código e barcode únicos — não um novo SKU de
-- produto, não o frasco fonte.
--
-- REGRA CRÍTICA: criar splits é TRANSFERÊNCIA FÍSICA INTERNA, nunca
-- entrada de estoque. inventory_items.physical_ml (o pooled do perfume)
-- NUNCA é tocado aqui — só inventory_bottles.physical_ml (do frasco fonte)
-- desce exatamente o total fracionado, e os splits nascem já somando esse
-- mesmo total. O saldo pooled do perfume é o mesmo antes e depois.
create table public.inventory_split_units (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  perfume_id uuid not null references public.perfumes(id),
  inventory_item_id uuid not null references public.inventory_items(id) on delete cascade,
  source_bottle_id uuid not null references public.inventory_bottles(id),

  split_code text not null,
  barcode_value text not null,
  quantity_ml numeric(14,3) not null check(quantity_ml > 0),
  status text not null default 'available' check(status in('available','consumed','void')),

  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  consumed_at timestamptz,

  unique(organization_id,split_code),
  unique(organization_id,barcode_value)
);
create index inventory_split_units_source_bottle_idx on public.inventory_split_units(source_bottle_id);
create index inventory_split_units_item_idx on public.inventory_split_units(inventory_item_id) where status='available';

alter table public.inventory_split_units enable row level security;
create policy inventory_split_units_select on public.inventory_split_units for select
  using(organization_id in(select public.current_user_org_ids()));
-- Só via RPC (security definer), igual a inventory_bottles: nunca escrita direta da app.
revoke insert,update,delete on public.inventory_split_units from authenticated;

-- shipment_items ganha um vínculo opcional a um split, irmão de bottle_id
-- (Fase 1) — uma linha é vendida de um frasco fonte OU de um split
-- pré-fracionado, nunca ambos. A exclusividade é reforçada abaixo por uma
-- check constraint: não é só regra operacional, o banco recusa a linha.
alter table public.shipment_items
  add column if not exists split_unit_id uuid references public.inventory_split_units(id);
create index if not exists shipment_items_split_unit_idx on public.shipment_items(split_unit_id) where split_unit_id is not null;
-- Diferente do frasco fonte (ver correção em 202608190001): um SPLIT é uma
-- unidade física já fracionada e de tamanho fixo — uma vez enviado, aquele
-- vidro específico acabou, não sobra capacidade para reivindicar de novo.
-- "No máximo uma reivindicação ativa, para sempre" é a semântica CORRETA
-- aqui (ao contrário do frasco fonte, que precisa ser reutilizável).
create unique index if not exists shipment_items_active_split_unit_uidx
  on public.shipment_items(split_unit_id) where split_unit_id is not null and removed_at is null;

-- Uma linha operacional usa UM frasco fonte OU UM split, nunca os dois —
-- bottle_id (202608190001) e split_unit_id (acima) não coexistem numa
-- mesma linha. Constraint nova (não existe em migration anterior).
alter table public.shipment_items
  add constraint shipment_items_single_physical_source_chk
  check (
    not (
      bottle_id is not null
      and split_unit_id is not null
    )
  );

-- ---------------------------------------------------------------------
-- Fracionar um frasco fonte em N unidades de split, atômico: trava o
-- frasco fonte, valida ml suficiente, desconta o total de uma vez, cria as
-- N linhas com código sequencial POR FRASCO (S000185-001, -002, ... — a
-- sequência reinicia a cada frasco fonte, sob o mesmo lock, então duas
-- fracionações concorrentes do mesmo frasco nunca colidem no número). Erro
-- em qualquer etapa desfaz tudo (transação da migration/RPC padrão).
-- ---------------------------------------------------------------------
create or replace function public.inventory_split_bottle(
  p_source_bottle_id uuid,p_quantity_ml numeric,p_count integer
) returns setof public.inventory_split_units
language plpgsql security definer set search_path=public
as $$
declare
  v_bottle public.inventory_bottles; v_total numeric; v_seq integer; v_split_code text; v_row public.inventory_split_units; i integer;
begin
  select * into v_bottle from public.inventory_bottles where id=p_source_bottle_id for update;
  if v_bottle.id is null then raise exception 'bottle_not_found'; end if;
  -- admin/manager só, igual a inventory_bottle_generate: fracionar cria
  -- identidades novas de estoque, não é bipagem/separação de rotina
  -- (essa continua admin/manager/operator em shipment_item_scan_bottle).
  if not public.has_org_role(v_bottle.organization_id,array['admin','manager']::public.member_role[])
    then raise exception 'inventory_write_forbidden'; end if;
  if p_quantity_ml is null or p_quantity_ml<=0 then raise exception 'invalid_quantity'; end if;
  if p_count is null or p_count<=0 or p_count>500 then raise exception 'invalid_count'; end if;
  if v_bottle.status<>'active' then raise exception 'bottle_unavailable'; end if;

  v_total:=p_quantity_ml*p_count;
  if v_bottle.physical_ml<v_total then raise exception 'insufficient_bottle_inventory'; end if;

  -- Sequência por frasco fonte, sob o lock já tomado acima — duas
  -- fracionações concorrentes do MESMO frasco serializam aqui, nunca
  -- geram o mesmo split_code (mesma garantia que inventory_bottle_generate
  -- já usa para bottle_code, só que por frasco em vez de por organização).
  select count(*) into v_seq from public.inventory_split_units where source_bottle_id=p_source_bottle_id;

  update public.inventory_bottles set
    physical_ml=physical_ml-v_total,
    status=case when physical_ml-v_total=0 then 'empty' else status end,
    updated_at=now()
  where id=p_source_bottle_id;

  for i in 1..p_count loop
    v_seq:=v_seq+1;
    v_split_code:='S'||substring(v_bottle.bottle_code from 2)||'-'||lpad(v_seq::text,3,'0');
    insert into public.inventory_split_units(
      organization_id,perfume_id,inventory_item_id,source_bottle_id,split_code,barcode_value,quantity_ml,created_by
    ) values(
      v_bottle.organization_id,v_bottle.perfume_id,v_bottle.inventory_item_id,p_source_bottle_id,
      v_split_code,'RUAH-'||v_split_code,p_quantity_ml,auth.uid()
    ) returning * into v_row;
    return next v_row;
  end loop;

  insert into public.audit_logs(organization_id,actor_id,action,entity_type,entity_id,metadata)
  values(v_bottle.organization_id,auth.uid(),'inventory_bottle_split','inventory_bottle',p_source_bottle_id::text,
    jsonb_build_object('quantity_ml',p_quantity_ml,'count',p_count,'total_ml',v_total,'physical_ml_before',v_bottle.physical_ml,'physical_ml_after',v_bottle.physical_ml-v_total));
  return;
end;
$$;
grant execute on function public.inventory_split_bottle(uuid,numeric,integer) to authenticated,service_role;

create or replace function public.inventory_split_units_for_bottle(p_source_bottle_id uuid)
returns setof public.inventory_split_units
language sql stable security invoker set search_path=public
as $$
  select * from public.inventory_split_units where source_bottle_id=p_source_bottle_id order by split_code;
$$;
grant execute on function public.inventory_split_units_for_bottle(uuid) to authenticated,service_role;

-- ---------------------------------------------------------------------
-- "true replace" da Fase 1 (202608190001): mesmo corpo, só um bloco novo
-- ANTES da resolução por frasco — tenta resolver como SPLIT primeiro (mais
-- específico); só cai na lógica de frasco (inalterada, mesmo texto de
-- antes) se não bater com nenhum split. Nunca aceita "mesmo perfume,
-- unidade errada": exige o split_code/barcode exato E quantity_ml igual
-- ao que o item pede — se o split achado for de tamanho diferente, retorna
-- erro estruturado em vez de aceitar silenciosamente.
-- ---------------------------------------------------------------------
create or replace function public.shipment_item_scan_bottle(
  p_shipment_id uuid,p_allocation_id uuid,p_scan_value text
) returns jsonb
language plpgsql security definer set search_path=public
as $$
declare
  v_shipment public.shipments; v_item public.shipment_items; v_allocation public.inventory_allocations;
  v_bottle public.inventory_bottles; v_split public.inventory_split_units; v_normalized text; v_conflict_id uuid;
  v_committed_ml numeric;
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

  -- 1) Tenta como SPLIT UNIT primeiro — código mais específico, nunca ambíguo com bottle_code/barcode_value de frasco.
  select su.* into v_split from public.inventory_split_units su
    where su.organization_id=v_shipment.organization_id
      and (upper(su.barcode_value)=upper(v_normalized) or upper(su.split_code)=upper(v_normalized))
    limit 1;

  if v_split.id is not null then
    if v_split.perfume_id<>v_allocation.perfume_id then
      return jsonb_build_object('ok',false,'reason','wrong_perfume','split_code',v_split.split_code);
    end if;
    if v_split.status<>'available' then
      return jsonb_build_object('ok',false,'reason','split_unavailable','status',v_split.status);
    end if;
    if v_split.quantity_ml<>v_item.quantity_ml then
      return jsonb_build_object('ok',false,'reason','split_quantity_mismatch','split_ml',v_split.quantity_ml,'needed_ml',v_item.quantity_ml);
    end if;
    select si.shipment_id into v_conflict_id from public.shipment_items si
      where si.split_unit_id=v_split.id and si.removed_at is null and si.id<>v_item.id;
    if v_conflict_id is not null then
      return jsonb_build_object('ok',false,'reason','split_already_assigned');
    end if;

    begin
      update public.shipment_items set
        split_unit_id=v_split.id,
        bottle_id=null,
        separated_at=coalesce(separated_at,now()),
        separated_by=coalesce(separated_by,auth.uid())
      where id=v_item.id;
    exception when unique_violation then
      return jsonb_build_object('ok',false,'reason','split_already_assigned');
    end;

    insert into public.audit_logs(organization_id,actor_id,action,entity_type,entity_id,metadata)
    values(v_shipment.organization_id,auth.uid(),'shipment_item_split_scanned','shipment_item',v_item.id::text,
      jsonb_build_object('shipment_id',p_shipment_id,'allocation_id',p_allocation_id,'split_unit_id',v_split.id,'split_code',v_split.split_code));

    return jsonb_build_object('ok',true,'kind','split','split_unit_id',v_split.id,'split_code',v_split.split_code,
      'quantity_ml',v_split.quantity_ml,'needed_ml',v_item.quantity_ml);
  end if;

  -- 2) Sem match de split: lógica de frasco fonte.
  --
  -- CORREÇÃO: frasco fonte é REUTILIZÁVEL entre pedidos sequenciais (ver
  -- nota em 202608190001) — a proteção real não é "só uma reivindicação",
  -- é "a soma das reivindicações ATIVAS nunca ultrapassa o físico atual".
  -- `for update` trava a linha do frasco ANTES de somar e comparar: duas
  -- bipagens concorrentes do mesmo frasco serializam aqui (a segunda só
  -- lê o estado já atualizado pela primeira, depois que ela commitar) —
  -- exatamente o cenário "dois operadores veem 5ml, cada um reivindica
  -- 5ml, o frasco só tinha 5ml" fica impossível.
  select b.* into v_bottle from public.inventory_bottles b
    where b.organization_id=v_shipment.organization_id
      and (b.qr_token=v_normalized or upper(b.barcode_value)=upper(v_normalized) or upper(b.bottle_code)=upper(v_normalized))
    limit 1
    for update;
  if v_bottle.id is null then
    return jsonb_build_object('ok',false,'reason','bottle_not_found');
  end if;

  if v_bottle.perfume_id<>v_allocation.perfume_id then
    return jsonb_build_object('ok',false,'reason','wrong_perfume','bottle_label',v_bottle.bottle_label,'bottle_code',v_bottle.bottle_code);
  end if;
  if v_bottle.status<>'active' then
    return jsonb_build_object('ok',false,'reason','bottle_unavailable','status',v_bottle.status);
  end if;

  -- Compromissos ativos: outras linhas (não removidas) que já apontam pra
  -- este frasco, cujo ENVIO ainda não chegou a um estado terminal. Postado/
  -- entregue/cancelado saem da soma automaticamente — posted/delivered
  -- porque o ml já foi fisicamente decrementado do frasco em post_shipment
  -- (contar de novo seria dobrar), cancelado porque cancel_draft_shipment
  -- já marca esses shipment_items com removed_at (então nem entram no
  -- filtro removed_at is null pra começo de conversa — a exclusão de
  -- status aqui é defesa em profundidade, não a única barreira).
  select coalesce(sum(si.quantity_ml),0) into v_committed_ml
    from public.shipment_items si
    join public.shipments s2 on s2.id=si.shipment_id
    where si.bottle_id=v_bottle.id and si.removed_at is null and si.id<>v_item.id
      and s2.status not in('posted','delivered','cancelled');

  if v_bottle.physical_ml-v_committed_ml<v_item.quantity_ml then
    return jsonb_build_object('ok',false,'reason','insufficient_ml','available_ml',v_bottle.physical_ml-v_committed_ml,'needed_ml',v_item.quantity_ml);
  end if;

  update public.shipment_items set
    bottle_id=v_bottle.id,
    split_unit_id=null,
    separated_at=coalesce(separated_at,now()),
    separated_by=coalesce(separated_by,auth.uid())
  where id=v_item.id;

  insert into public.audit_logs(organization_id,actor_id,action,entity_type,entity_id,metadata)
  values(v_shipment.organization_id,auth.uid(),'shipment_item_bottle_scanned','shipment_item',v_item.id::text,
    jsonb_build_object('shipment_id',p_shipment_id,'allocation_id',p_allocation_id,'bottle_id',v_bottle.id,'bottle_code',v_bottle.bottle_code));

  return jsonb_build_object('ok',true,'kind','bottle','bottle_id',v_bottle.id,'bottle_code',v_bottle.bottle_code,'bottle_label',v_bottle.bottle_label,
    'physical_ml',v_bottle.physical_ml,'needed_ml',v_item.quantity_ml);
end;
$$;
grant execute on function public.shipment_item_scan_bottle(uuid,uuid,text) to authenticated,service_role;

-- ---------------------------------------------------------------------
-- "true replace" de post_shipment (definição vigente: 202608190001): corpo
-- igual, mais duas correções desta revisão de arquitetura:
--
-- 1. Marcador de consumo do split (quando a linha tem um vinculado) ao
--    lado do bloco de frasco já existente. O pooled (inventory_items.
--    physical_ml) SEMPRE desce aqui, exatamente uma vez por allocation,
--    seja a origem física bottle ou split — fracionar (inventory_split_
--    bottle) é transferência física INTERNA entre frasco fonte e splits,
--    nunca mexe no pooled; é só na postagem do envio que o ml sai de
--    fato do pooled. Marcar 'consumed' aqui é bookkeeping de qual unidade
--    física específica foi de fato enviada, não uma segunda baixa.
--
-- 2. GATE FINAL DE AUDITORIA DE ENVIO (correção do Deviation Report):
--    para item com rastreamento físico ATIVO, postar exige bottle_id OU
--    split_unit_id já confirmado — nunca é mais "só um aviso no
--    frontend". A regra é 100% determinística pelo próprio banco
--    (inventory_items.bottle_tracking_status='active'), o frontend não
--    decide nada. Perfis sem rastreamento ativo (a esmagadora maioria,
--    hoje), stock_managed=false, vendas históricas e envios já postados
--    (idempotência no topo da função) continuam absolutamente inalterados
--    — o gate só existe dentro do "if r.stock_managed" e só dispara
--    quando bottle_tracking_status='active' for verdadeiro.
--
--    Nota de auditoria: a confirmação em si (o bipe bem-sucedido) já fica
--    permanentemente registrada em audit_logs por shipment_item_scan_bottle
--    (quem/quando/qual envio/qual item/qual frasco ou split — ver essa
--    função) — reaproveitado aqui em vez de duplicar infraestrutura de
--    log. Este RAISE EXCEPTION, quando dispara, é chamado por
--    apply_superfrete_state (202608130003) como reação ao sync externo da
--    SuperFrete — a mesma propagação que insufficient_physical_inventory
--    e as demais exceções desta função já tinham antes desta correção,
--    não um comportamento novo introduzido só para este gate.
-- ---------------------------------------------------------------------
create or replace function public.post_shipment(p_shipment_id uuid)
returns void language plpgsql security definer set search_path=public as $$
declare v public.shipments; r record; v_bottle_id uuid; v_bottle_physical numeric; v_split_id uuid; v_tracking_status text;
begin
  select * into v from public.shipments where id=p_shipment_id for update;
  if v.id is null or not public.has_org_role(v.organization_id,array['admin','manager']::public.member_role[]) then raise exception 'forbidden'; end if;
  if v.status in('posted','delivered') then return; end if;
  if v.status not in('label_released','customer_approved') then raise exception 'shipment_not_ready_to_post'; end if;
  for r in select a.* from public.inventory_allocations a where a.shipment_id=v.id and a.status='shipping' for update loop
    v_bottle_id:=null;
    v_split_id:=null;
    v_tracking_status:=null;
    if r.stock_managed then
      perform 1 from public.inventory_items where id=r.inventory_item_id and physical_ml>=r.quantity_ml for update;
      if not found then raise exception 'insufficient_physical_inventory'; end if;

      select si.bottle_id,si.split_unit_id into v_bottle_id,v_split_id from public.shipment_items si
        where si.shipment_id=v.id and si.allocation_id=r.id and si.removed_at is null;
      if v_bottle_id is not null and v_split_id is not null then
        raise exception 'multiple_physical_sources_confirmed';
      end if;
      select bottle_tracking_status into v_tracking_status from public.inventory_items where id=r.inventory_item_id;
      if v_tracking_status='active' and v_bottle_id is null and v_split_id is null then
        raise exception 'physical_source_not_confirmed';
      end if;

      -- Pooled desce exatamente uma vez por allocation, independentemente
      -- da origem física (bottle ou split) ser confirmada abaixo.
      update public.inventory_items set physical_ml=physical_ml-r.quantity_ml,updated_at=now() where id=r.inventory_item_id;

      if v_bottle_id is not null then
        select physical_ml into v_bottle_physical from public.inventory_bottles where id=v_bottle_id for update;
        if not found then raise exception 'bottle_not_found'; end if;
        if v_bottle_physical<r.quantity_ml then raise exception 'insufficient_bottle_inventory'; end if;
        update public.inventory_bottles set
          physical_ml=physical_ml-r.quantity_ml,
          status=case when physical_ml-r.quantity_ml=0 then 'empty' else status end,
          updated_at=now()
        where id=v_bottle_id;
      end if;
      if v_split_id is not null then
        -- Origem split: NÃO diminui o frasco fonte de novo (já desceu na
        -- criação do split). Só marca a unidade específica como consumida
        -- — e só se ela ainda está disponível e bate exatamente com o ml
        -- da allocation, para nunca aceitar uma unidade de tamanho errado.
        update public.inventory_split_units
          set status='consumed',consumed_at=now()
          where id=v_split_id and status='available' and quantity_ml=r.quantity_ml;
        if not found then raise exception 'split_unit_unavailable'; end if;
      end if;
    end if;
    update public.inventory_allocations set status='shipped',shipped_at=now(),updated_at=now() where id=r.id;
  end loop;
  update public.shipments set status='posted',posted_at=now(),updated_at=now() where id=v.id;
  insert into public.shipment_events(organization_id,shipment_id,event_type,from_status,to_status,actor_id)
    values(v.organization_id,v.id,'shipment_posted',v.status,'posted',auth.uid());
end;$$;

commit;
