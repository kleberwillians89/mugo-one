begin;

-- RUAH — corrige 42725 ("function public.inventory_apply(...) is not
-- unique") no smoke do Estoque.
--
-- CAUSA RAIZ (confirmada por auditoria de migrations + supabase migration
-- list, não por suposição): 202607300012 criou
--   inventory_apply(uuid,numeric,inventory_movement_type,text,text,uuid)  -- 6 args
-- 202608130001 e 202608140002 fizeram "true replace" dessa MESMA
-- assinatura (mesmo tipo de argumento, CREATE OR REPLACE válido). Depois,
-- 202608180001 tentou "estender retrocompatível com p_origin opcional" —
-- mas em Postgres, uma lista de tipos de argumento diferente NUNCA é um
-- true replace, é sempre uma sobrecarga NOVA:
--   inventory_apply(uuid,numeric,inventory_movement_type,text,text,uuid,text) -- 7 args
-- As duas sobrecargas convivem desde então. Qualquer chamada com
-- exatamente 6 argumentos nomeados (como o frontend sempre fez em
-- adjustInventory/records.ts) passa a bater nas DUAS ao mesmo tempo — a de
-- 6 args por igualdade exata, a de 7 args porque p_origin tem default —
-- e o Postgres não consegue escolher: 42725.
--
-- NÃO é possível simplesmente apagar a sobrecarga de 7 args para "voltar
-- a só 6": inventory_bottle_confirm_conference (202608180001, o fluxo de
-- "Confirmar conferência" do QR/bipe) chama inventory_apply
-- POSICIONALMENTE com 7 argumentos, o último sendo 'qr_conference'.
-- Apagar a sobrecarga de 7 args quebraria esse fluxo imediatamente.
--
-- A sobrecarga de 7 args (com p_origin) também tem uma REGRESSÃO real:
-- seu corpo (202608180001) nunca herdou a lógica de confirmação de
-- bootstrap (bootstrap_pending_verification/reconciliation_status) que
-- 202608140002 já tinha adicionado à sobrecarga de 6 args. Esta migration
-- corrige as duas coisas na mesma passada:
--
-- 1. Mantém UMA única assinatura pública (7 args, com p_origin default
--    null — 100% compatível com todo chamador que envia só 6 args, como o
--    frontend faz hoje).
-- 2. Essa assinatura ganha de volta a lógica de confirmação de bootstrap.
-- 3. A sobrecarga de 6 args é removida com DROP FUNCTION por assinatura
--    EXATA (sem CASCADE) — ela nunca é chamada com mais de 6 argumentos
--    posicionais em lugar nenhum do código, então nada depende dela
--    especificamente.

drop function if exists public.inventory_apply(
  uuid,
  numeric,
  public.inventory_movement_type,
  text,
  text,
  uuid
);

create or replace function public.inventory_apply(
  p_item_id uuid,
  p_quantity_ml numeric,
  p_type public.inventory_movement_type,
  p_reason text,
  p_notes text default null,
  p_sale_id uuid default null,
  p_origin text default null
) returns public.inventory_movements
language plpgsql
security definer
set search_path = public
as $$
declare
  v_item public.inventory_items;
  v_movement public.inventory_movements;
  v_after numeric;
  v_physical_after numeric;
  v_confirms boolean;
begin
  select * into v_item from public.inventory_items where id = p_item_id for update;
  if not found then
    raise exception 'inventory_item_not_found';
  end if;

  if auth.uid() is not null
     and not public.has_org_role(
       v_item.organization_id,
       array['admin','manager','operator']::public.member_role[]
     ) then
    raise exception 'inventory_write_forbidden';
  end if;

  if p_quantity_ml = 0 or btrim(coalesce(p_reason, '')) = '' then
    raise exception 'inventory_reason_and_quantity_required';
  end if;

  v_after := v_item.available_ml + p_quantity_ml;
  v_physical_after := v_item.physical_ml + p_quantity_ml;
  if v_after < 0 then
    raise exception 'insufficient_available_inventory';
  end if;
  if v_physical_after < 0 then
    raise exception 'insufficient_physical_inventory';
  end if;

  -- Entrada manual/ajuste é o evento de confirmação humana existente
  -- (Estoque "Entrada"/"Ajustar", e a conferência física por QR/bipe):
  -- limpa bootstrap pendente e reconcilia review_required. Movimentos
  -- automáticos (sale_out, cancellation_reversal, opening) nunca tocam um
  -- humano, então nunca confirmam nada sozinhos.
  v_confirms := p_type in ('entry', 'positive_adjustment', 'negative_adjustment', 'administrative_correction');

  update public.inventory_items set
    available_ml = v_after,
    physical_ml = v_physical_after,
    updated_at = now(),
    bootstrap_pending_verification = case when v_confirms then false else bootstrap_pending_verification end,
    reconciliation_status = case when v_confirms and reconciliation_status = 'review_required' then 'reconciled' else reconciliation_status end
  where id = v_item.id;

  insert into public.inventory_movements(
    organization_id, inventory_item_id, perfume_id, sale_id, movement_type, quantity_ml,
    balance_before, balance_after, reason, notes, created_by, origin
  ) values (
    v_item.organization_id, v_item.id, v_item.perfume_id, p_sale_id, p_type, p_quantity_ml,
    v_item.available_ml, v_after, p_reason, p_notes, auth.uid(), p_origin
  ) returning * into v_movement;

  insert into public.audit_logs(organization_id, actor_id, action, entity_type, entity_id, metadata)
  values (
    v_item.organization_id, auth.uid(), 'inventory_movement', 'inventory_item', v_item.id::text,
    jsonb_build_object(
      'movement_id', v_movement.id,
      'type', p_type,
      'quantity_ml', p_quantity_ml,
      'sale_id', p_sale_id,
      'origin', p_origin,
      'physical_before', v_item.physical_ml,
      'physical_after', v_physical_after
    )
  );

  return v_movement;
end;
$$;

-- CREATE OR REPLACE preserva grants existentes desta MESMA assinatura, mas
-- reaplicamos explicitamente por segurança (idempotente, sem custo).
grant execute
  on function public.inventory_apply(
    uuid, numeric, public.inventory_movement_type, text, text, uuid, text
  )
  to authenticated, service_role;

-- Garante que o PostgREST não sirva um plano de cache com a sobrecarga
-- antiga já removida — barato, não mascara o problema (a causa estrutural
-- já foi corrigida acima).
notify pgrst, 'reload schema';

commit;
