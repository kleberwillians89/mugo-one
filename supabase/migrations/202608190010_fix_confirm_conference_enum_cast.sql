begin;

-- RUAH — corrige 42883 ("function public.inventory_apply(uuid, numeric,
-- text, text, text, unknown, unknown) does not exist") no smoke real do
-- fluxo de conferência por QR.
--
-- CAUSA RAIZ (confirmada por auditoria de todos os callers internos de
-- inventory_apply, não por suposição): public.inventory_bottle_confirm_
-- conference (202608180001, já aplicada remotamente) chama inventory_apply
-- passando como terceiro argumento:
--
--   case when v_delta>0 then 'positive_adjustment' else 'negative_adjustment' end
--
-- Uma expressão CASE cujos dois ramos são literais de string SEM nenhum
-- contexto de tipo externo. A regra de resolução de tipo do Postgres para
-- CASE/COALESCE nessa situação promove os literais para `text` — não para
-- `unknown` (que teria coerção implícita livre para qualquer tipo) nem
-- para public.inventory_movement_type. Como não existe cast implícito de
-- text para um enum definido pelo usuário, a chamada nunca bateu com
-- nenhuma sobrecarga de inventory_apply — mascarado até agora porque
-- nenhum smoke humano tinha exercitado esta função com v_delta<>0.
--
-- Diferente de um bare literal como 'entry' (inventory_bottle_add_new,
-- linha 210 do mesmo arquivo) ou 'opening'/'sale_out'/'cancellation_
-- reversal' (demais callers, auditados abaixo) — esses ficam "unknown"
-- até a resolução da chamada e coagem livremente para o enum. Só a
-- expressão CASE tem esse problema.
--
-- AUDITORIA COMPLETA DE CALLERS INTERNOS (rg -n "inventory_apply\(" em
-- supabase/ e src/) — todos os outros já passam o enum corretamente:
--   inventory_bottle_add_new        (202608180001:210)              — 'entry' bare literal, OK
--   inventory_sale_sync             (202607300016 / 202607300012)    — 'cancellation_reversal'/'sale_out' bare literais, OK
--                                      (função órfã: a trigger que a chamava
--                                      foi substituída por
--                                      sync_sale_inventory_allocation em
--                                      202608130001 — não executa mais, mas
--                                      corrigida na mesma migration original
--                                      se algum dia for reconectada não muda
--                                      nada aqui)
--   inventory_create_item           (202608190008, versão vigente)   — 'opening' bare literal, OK
--   sync_sale_inventory_allocation  (202608130001)                   — nunca chama inventory_apply
-- Único caller quebrado: inventory_bottle_confirm_conference.
--
-- CORREÇÃO: cast explícito do resultado da expressão CASE para o enum
-- canônico. Mesma assinatura (uuid,numeric,boolean,timestamptz) — true
-- replace, sem DROP. Corpo idêntico ao vigente, só a linha da chamada
-- muda; NULLs também tipados explicitamente (p_sale_id) para eliminar
-- qualquer ambiguidade remanescente, mesmo não sendo a causa deste bug.
-- inventory_apply em si (assinatura, corpo) NÃO é tocado — só este caller.

create or replace function public.inventory_bottle_confirm_conference(
  p_bottle_id uuid,
  p_observed_ml numeric,
  p_apc_available boolean,
  p_expected_updated_at timestamptz
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_bottle public.inventory_bottles;
  v_ml_before numeric;
  v_apc_before boolean;
  v_delta numeric;
  v_movement public.inventory_movements;
  v_conference public.inventory_bottle_conferences;
begin
  select * into v_bottle from public.inventory_bottles where id = p_bottle_id for update;
  if not found then
    raise exception 'bottle_not_found';
  end if;
  if v_bottle.organization_id not in (select public.current_user_org_ids()) then
    raise exception 'bottle_not_found';
  end if;
  if not public.has_org_role(
    v_bottle.organization_id,
    array['admin','manager','operator']::public.member_role[]
  ) then
    raise exception 'inventory_write_forbidden';
  end if;
  if p_observed_ml is null or p_observed_ml < 0 then
    raise exception 'invalid_observed_amount';
  end if;
  if p_expected_updated_at is distinct from v_bottle.updated_at then
    raise exception 'stale_conference';
  end if;

  -- Capturados ANTES de qualquer update — v_bottle é reaproveitada abaixo
  -- (returning * into v_bottle) e passaria a refletir os valores NOVOS.
  v_ml_before := v_bottle.physical_ml;
  v_apc_before := v_bottle.apc_unit_available;
  v_delta := p_observed_ml - v_ml_before;
  if v_delta <> 0 then
    v_movement := public.inventory_apply(
      v_bottle.inventory_item_id,
      v_delta,
      (case when v_delta > 0 then 'positive_adjustment' else 'negative_adjustment' end)::public.inventory_movement_type,
      'Conferência física de frasco (' || v_bottle.bottle_code || ')',
      v_bottle.bottle_label,
      null::uuid,
      'qr_conference'
    );
  end if;

  update public.inventory_bottles set
    physical_ml = p_observed_ml,
    apc_unit_available = p_apc_available,
    status = case when p_observed_ml = 0 then 'empty' when status = 'empty' and p_observed_ml > 0 then 'active' else status end,
    updated_at = now()
  where id = v_bottle.id returning * into v_bottle;

  insert into public.inventory_bottle_conferences(
    organization_id, bottle_id, inventory_item_id, movement_id,
    ml_before, ml_after, apc_before, apc_after, conferred_by
  ) values (
    v_bottle.organization_id, v_bottle.id, v_bottle.inventory_item_id, v_movement.id,
    v_ml_before, p_observed_ml, v_apc_before, p_apc_available, auth.uid()
  ) returning * into v_conference;

  if v_delta = 0 then
    insert into public.audit_logs(organization_id, actor_id, action, entity_type, entity_id, metadata)
    values (
      v_bottle.organization_id, auth.uid(), 'inventory_bottle_conference_no_change', 'inventory_bottle', v_bottle.id::text,
      jsonb_build_object('bottle_code', v_bottle.bottle_code, 'ml', p_observed_ml, 'apc_unit_available', p_apc_available)
    );
  end if;

  return jsonb_build_object(
    'bottle_id', v_bottle.id,
    'physical_ml', v_bottle.physical_ml,
    'apc_unit_available', v_bottle.apc_unit_available,
    'status', v_bottle.status,
    'updated_at', v_bottle.updated_at,
    'delta', v_delta,
    'conference_id', v_conference.id
  );
end;
$$;

-- CREATE OR REPLACE preserva grants existentes desta MESMA assinatura, mas
-- reaplicamos explicitamente por segurança (idempotente, sem custo).
grant execute
  on function public.inventory_bottle_confirm_conference(uuid, numeric, boolean, timestamptz)
  to authenticated, service_role;

commit;
