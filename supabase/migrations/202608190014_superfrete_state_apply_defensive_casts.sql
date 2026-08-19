-- Bug real de produção: um pedido SuperFrete released (etiqueta pronta e
-- imprimível no painel oficial) falhava ao sincronizar no RUAH com um erro
-- genérico "SUPERFRETE_NETWORK_ERROR" — mesmo a chamada de rede em si tendo
-- funcionado. Causa raiz: apply_superfrete_state (202608130003) faz cast
-- direto (::numeric / ::integer / ::timestamptz) de campos SECUNDÁRIOS que
-- vêm literalmente da resposta externa da SuperFrete (price, delivery,
-- delivery_min, delivery_max, generated_at, posted_at, delivered_at,
-- cancelled_at/canceled_at). Um valor inesperado em QUALQUER um desses
-- campos (formato que a API pode variar sem aviso) faz o cast levantar
-- exceção, abortando a transação inteira — inclusive a gravação dos campos
-- PRIMÁRIOS (status, tracking, print_url) que já tinham sido confirmados
-- com sucesso pela SuperFrete. O erro então escapa como uma exceção comum,
-- sem `.status` HTTP, e cai no branch genérico de safeProviderError()
-- (Edge Function superfrete-sync-shipment) — daí o rótulo enganoso de
-- "erro de rede" para um problema que é 100% local/de persistência.
--
-- Esta migration NÃO adiciona colunas, NÃO mexe em post_shipment, NÃO mexe
-- em permissões/RLS/has_org_role, NÃO muda a lógica de cancelamento nem o
-- gate físico (physical_source_not_confirmed) — só torna os casts dos
-- campos secundários tolerantes a formato inesperado (retornam null em vez
-- de abortar), preservando exatamente o mesmo comportamento de antes para
-- qualquer valor bem-formado (mesma cadeia de coalesce, mesmo fallback para
-- o valor já persistido).

create or replace function public.superfrete_safe_numeric(p_text text)
returns numeric language plpgsql immutable as $$
begin
  return p_text::numeric;
exception when others then return null;
end;$$;

create or replace function public.superfrete_safe_int(p_text text)
returns integer language plpgsql immutable as $$
begin
  return p_text::integer;
exception when others then return null;
end;$$;

create or replace function public.superfrete_safe_timestamptz(p_text text)
returns timestamptz language plpgsql immutable as $$
begin
  return p_text::timestamptz;
exception when others then return null;
end;$$;

revoke all on function public.superfrete_safe_numeric(text) from public,anon;
revoke all on function public.superfrete_safe_int(text) from public,anon;
revoke all on function public.superfrete_safe_timestamptz(text) from public,anon;
grant execute on function public.superfrete_safe_numeric(text) to authenticated,service_role;
grant execute on function public.superfrete_safe_int(text) to authenticated,service_role;
grant execute on function public.superfrete_safe_timestamptz(text) to authenticated,service_role;

create or replace function public.apply_superfrete_state(p_shipment_id uuid,p_run_id uuid,p_state jsonb)
returns public.shipments language plpgsql security definer set search_path=public as $$
declare v public.shipments; external_status text; internal_status public.shipment_status;
begin
  select * into v from public.shipments where id=p_shipment_id for update;
  if v.id is null or not public.has_org_role(v.organization_id,array['admin','manager']::public.member_role[]) then raise exception 'forbidden'; end if;
  external_status:=lower(coalesce(p_state->>'status',v.superfrete_status,''));
  internal_status:=case external_status when 'released' then 'label_released' when 'posted' then 'posted'
    when 'delivered' then 'delivered' when 'cancelled' then 'cancelled' when 'canceled' then 'cancelled' else v.status end;
  if internal_status in('posted','delivered') and v.status not in('posted','delivered') then
    if v.status not in('label_released','customer_approved') then update public.shipments set status='label_released',updated_at=now() where id=v.id; end if;
    perform public.post_shipment(v.id); select * into v from public.shipments where id=v.id;
  end if;
  if internal_status='cancelled' and v.status not in('posted','delivered','cancelled') then
    update public.inventory_allocations set status='reserved',shipment_id=null,updated_at=now()
      where shipment_id=v.id and status='shipping';
    update public.shipment_items set removed_at=coalesce(removed_at,now()) where shipment_id=v.id and removed_at is null;
  end if;
  update public.shipments set status=case when internal_status='posted' then status else internal_status end,
    superfrete_status=nullif(external_status,''),tracking_code=coalesce(p_state->>'tracking',tracking_code),
    print_url=coalesce(p_state->'print'->>'url',p_state->>'print_url',print_url),
    label_pdf_url=coalesce(p_state->'print'->>'url',p_state->>'print_url',label_pdf_url),
    shipping_price=coalesce(public.superfrete_safe_numeric(nullif(p_state->>'price','')),shipping_price),
    delivery_days=coalesce(public.superfrete_safe_int(nullif(p_state->>'delivery','')),delivery_days),
    delivery_min=coalesce(public.superfrete_safe_int(nullif(p_state->>'delivery_min','')),delivery_min),
    delivery_max=coalesce(public.superfrete_safe_int(nullif(p_state->>'delivery_max','')),delivery_max),
    label_generated_at=coalesce(public.superfrete_safe_timestamptz(nullif(p_state->>'generated_at','')),label_generated_at),
    posted_at=coalesce(public.superfrete_safe_timestamptz(nullif(p_state->>'posted_at','')),posted_at),
    delivered_at=coalesce(public.superfrete_safe_timestamptz(nullif(p_state->>'delivered_at','')),delivered_at),
    cancelled_at=coalesce(public.superfrete_safe_timestamptz(nullif(p_state->>'canceled_at','')),public.superfrete_safe_timestamptz(nullif(p_state->>'cancelled_at','')),cancelled_at),
    checkout_status=case when external_status='released' then 'released' else checkout_status end,
    checkout_completed_at=case when external_status='released' then coalesce(checkout_completed_at,now()) else checkout_completed_at end,
    superfrete_updated_at=now(),integration_error=null,updated_at=now() where id=v.id returning * into v;
  if p_run_id is not null then update public.integration_runs set status='succeeded',completed_at=now() where id=p_run_id and entity_id=v.id; end if;
  return v;
end;$$;

revoke all on function public.apply_superfrete_state(uuid,uuid,jsonb) from public,anon;
grant execute on function public.apply_superfrete_state(uuid,uuid,jsonb) to authenticated,service_role;
