begin;

-- RUAH — correção de produção: 23505 em inventory_items_organization_id_perfume_id_key.
--
-- CAUSA RAIZ: public.inventory_create_item (202607300012_inventory_module.sql)
-- fazia um INSERT cru em public.inventory_items, sem nenhuma proteção contra
-- (organization_id, perfume_id) já existente. O caller (Estoque → "Cadastrar
-- perfume") lista TODOS os perfumes da organização no seletor, sem excluir os
-- que já têm inventory_item — então bastava escolher um perfume que já tinha
-- estoque (ex.: criado por bootstrap_ai_batch_inventory) para o INSERT bater
-- na unique constraint e o erro cru do Postgres subir até a tela.
--
-- ARQUITETURA CANÔNICA (inalterada): 1 organization + 1 perfume = 1
-- inventory_items pooled row, soberana. Esta correção NUNCA sobrescreve
-- physical_ml/available_ml/reconciliation_status/bootstrap_pending_verification/
-- bottle_tracking_status de uma linha existente — só passa a REUTILIZAR a
-- linha já lá, exatamente como já é feito em initialize_inventory_from_stock_rows
-- (202607300014) e no defensive re-check de bootstrap_ai_batch_inventory
-- (202608140004): insert ... on conflict do nothing, e se não inseriu, lê a
-- linha existente e a devolve como está.
--
-- 202607300012_inventory_module.sql já está aplicada remotamente — não
-- editada. Mesma assinatura (uuid,uuid,numeric,numeric,date,text) e mesmo
-- RETURNS public.inventory_items — CREATE OR REPLACE é seguro, sem DROP.

create or replace function public.inventory_create_item(
  p_organization_id uuid,p_perfume_id uuid,p_opening_ml numeric,p_minimum_ml numeric,
  p_reference_date date,p_notes text default null
) returns public.inventory_items
language plpgsql security definer set search_path=public
as $$
declare v_item public.inventory_items;
begin
  if not public.has_org_role(p_organization_id,array['admin','manager']::public.member_role[])
    then raise exception 'inventory_write_forbidden'; end if;
  if p_opening_ml<0 or p_minimum_ml<0 then raise exception 'invalid_inventory_amount'; end if;
  if not exists(select 1 from public.perfumes where id=p_perfume_id and organization_id=p_organization_id)
    then raise exception 'perfume_not_found'; end if;

  insert into public.inventory_items(organization_id,perfume_id,reference_date,available_ml,minimum_ml,notes,created_by)
  values(p_organization_id,p_perfume_id,p_reference_date,0,p_minimum_ml,p_notes,auth.uid())
  on conflict (organization_id,perfume_id) do nothing
  returning * into v_item;

  if v_item.id is null then
    -- Já existia: a linha é soberana. Devolve exatamente como está — nunca
    -- reaplica p_opening_ml/p_minimum_ml/p_notes por cima de estoque real.
    select * into v_item from public.inventory_items
      where organization_id=p_organization_id and perfume_id=p_perfume_id;
    return v_item;
  end if;

  if p_opening_ml>0 then
    perform public.inventory_apply(v_item.id,p_opening_ml,'opening','Saldo inicial do estoque',p_notes,null);
  end if;
  select * into v_item from public.inventory_items where id=v_item.id;
  return v_item;
end;
$$;

commit;
