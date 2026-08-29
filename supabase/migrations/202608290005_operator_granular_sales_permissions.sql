begin;

-- Corrige um conflito arquitetural pré-existente entre dois sistemas de
-- autorização, encontrado no preflight do módulo Cobranças V1.
--
-- AUDITORIA DA VERSÃO ATIVA (definida em 202607300010_period_delivery_
-- reports_ai.sql, nunca redefinida depois daquela migration):
--
--   create or replace function public.protect_operator_sale_changes()
--   returns trigger ... security definer set search_path=public as $$
--   declare user_role public.member_role;
--   begin
--     if auth.uid() is null then return new; end if;
--     select role into user_role from public.organization_members
--       where organization_id=old.organization_id and user_id=auth.uid();
--     if user_role='viewer' then raise exception 'viewer_read_only'; end if;
--     if user_role='operator' and (
--       new.client_id is distinct from old.client_id
--       or new.sale_date is distinct from old.sale_date
--       or new.amount is distinct from old.amount
--       or new.payment_status is distinct from old.payment_status
--       or new.payment_method is distinct from old.payment_method
--       or new.perfume_id is distinct from old.perfume_id
--       or new.sale_type is distinct from old.sale_type
--       or new.volume_ml is distinct from old.volume_ml
--     ) then raise exception 'operator_shipping_only'; end if;
--     return new;
--   end; $$;
--
-- O que ela permite/bloqueia hoje para role='operator' (comparando OLD x
-- NEW, oito colunas, todas em public.sales):
--   BLOQUEADAS incondicionalmente: client_id, sale_date, amount,
--     payment_status, payment_method, perfume_id, sale_type, volume_ml.
--   NÃO estão nesta lista (já editáveis por operator hoje, sem mudança
--     nenhuma aqui): shipped_at, paid_at, credit_reference_amount,
--     shipping_deadline_date, shipping_deadline_raw, notes, e qualquer
--     outra coluna de sales fora dessas oito.
-- organization_id vem de OLD.organization_id (a linha já gravada, nunca de
-- um valor enviado pelo cliente) — correto, mantido sem alteração. role vem
-- de organization_members chaveado por auth.uid() — correto, mantido sem
-- alteração. auth.uid() é obrigatório: sessão nula (auth.uid() is null)
-- sempre passa direto, igual a hoje — este trigger nunca decide sozinho
-- para chamadas sem sessão.
--
-- Pelo menos 13 caminhos diferentes fazem UPDATE public.sales hoje
-- (davi_excel_update_sale, collections_register_payment, importações
-- incrementais, recebimento por scan, snapshot de envio, etc.) e todos
-- disparam este mesmo trigger sem exceção — é o único portão de proteção
-- de role para escrita em sales.
--
-- O PROBLEMA: davi_excel_update_sale e collections_register_payment já
-- checam has_org_permission(...,'sales.edit') como gate PRÓPRIO antes de
-- emitir o UPDATE — mas isso nunca impediu ESTE trigger de barrar o mesmo
-- UPDATE depois, incondicionalmente, só por causa do role antigo
-- ('operator') gravado em organization_members. Dois sistemas de
-- autorização (role legado x permissão granular) nunca conversavam entre
-- si, então um operator com sales.edit explicitamente concedido ainda
-- recebia 'operator_shipping_only' ao tentar registrar um pagamento — em
-- Cobranças e também no Davi Excel.
--
-- REGRA NOVA: role antigo não pode sobrepor uma permissão granular já
-- concedida para a ação comercial equivalente. Adiciona-se só
-- "and not has_org_permission(old.organization_id,'sales.edit')" à mesma
-- condição que já existia:
--   • Nenhum campo novo é liberado — continuam sendo exatamente os mesmos
--     oito (é a MESMA lista OLD x NEW acima, char por char).
--   • Nenhuma exceção por nome de RPC/sessão/aplicação — o trigger não
--     enxerga quem o chamou, só o role e a permissão de quem está logado;
--     vale igual para Davi Excel, Cobranças ou qualquer UPDATE futuro.
--   • admin/manager: sem mudança — nunca entraram nesta condição.
--   • viewer: sem mudança — continua bloqueado incondicionalmente, sem
--     checar permissão nenhuma (fora do escopo pedido: a correção é só
--     para o par role='operator' + sales.edit).
--   • operator SEM sales.edit: sem mudança — bloqueado exatamente como
--     antes, nos mesmos oito campos.
--   • Nada fora de public.sales é tocado por esta migration. Não redefine
--     sync_sale_inventory_allocation nem qualquer trigger/tabela de
--     estoque/físico/shipment/preparation — o comportamento de
--     inventory_allocations/available_ml ao marcar uma venda elegível
--     como paid continua exatamente igual.
create or replace function public.protect_operator_sale_changes()
returns trigger language plpgsql security definer set search_path=public
as $$
declare user_role public.member_role;
begin
  if auth.uid() is null then return new; end if;
  select role into user_role from public.organization_members
    where organization_id=old.organization_id and user_id=auth.uid();
  if user_role='viewer' then raise exception 'viewer_read_only'; end if;
  if user_role='operator'
     and not public.has_org_permission(old.organization_id,'sales.edit')
     and (
    new.client_id is distinct from old.client_id
    or new.sale_date is distinct from old.sale_date
    or new.amount is distinct from old.amount
    or new.payment_status is distinct from old.payment_status
    or new.payment_method is distinct from old.payment_method
    or new.perfume_id is distinct from old.perfume_id
    or new.sale_type is distinct from old.sale_type
    or new.volume_ml is distinct from old.volume_ml
  ) then raise exception 'operator_shipping_only'; end if;
  return new;
end;
$$;

commit;
