-- Bug real de produção (logs do Edge Function): superfrete-sync-shipment
-- falhava consistentemente na etapa "print_health_persist" com
-- db_error_code=42501 (insufficient_privilege) em múltiplos shipments
-- (23d9a28c-1e92-4c24-9dff-0c194241cc43, 627e6f50-7c82-4341-9877-64839b1f67de).
--
-- Causa raiz: esse bloco fazia um UPDATE DIRETO em public.shipments via
-- ctx.client (Supabase client com anon key + JWT do chamador, role
-- "authenticated" no Postgres) — mas 202608130001_operational_foundation
-- já revoga explicitamente todo INSERT/UPDATE/DELETE em public.shipments
-- de "authenticated" ("Escritas operacionais passam apenas pelas RPCs
-- transacionais abaixo"), reafirmado de novo em
-- 202608140001_final_operational_pass ("alterações em shipments passam
-- pelos RPCs security definer, nunca por update direto"). Isso é um GRANT
-- revogado, não uma policy de RLS que falhou — por isso 42501 acontecia
-- SEMPRE, independente de role/organização/permissão do chamador: era o
-- único write de shipments em todo o projeto que não passava por uma RPC.
--
-- Correção: uma RPC estreita, no mesmo padrão de todas as outras
-- (post_shipment, shipment_item_scan_bottle, etc. — CREATE OR REPLACE,
-- security definer, has_org_permission). Não usa service_role como atalho;
-- preserva o modelo "JWT do caller + RPC autorizada". Só escreve os campos
-- técnicos de saúde de impressão da SuperFrete — nunca recipient, tracking,
-- estoque, physical source ou status operacional.

create or replace function public.shipment_set_superfrete_print_health(
  p_shipment_id uuid,
  p_print_url text,
  p_label_pdf_url text,
  p_print_available boolean,
  p_print_http_status integer,
  p_print_content_type text,
  p_integration_error text
) returns public.shipments
language plpgsql
security definer
set search_path = public
as $$
declare v public.shipments;
begin
  select * into v from public.shipments where id = p_shipment_id for update;
  if v.id is null then
    raise exception 'shipment_not_found';
  end if;
  -- shipping.label = "Gerenciar etiqueta de envio" (já existente no
  -- catálogo, já concedida ao preset "entregas" e coberta por
  -- access_total). Nenhum código novo inventado. has_org_permission já
  -- nega sozinho para um chamador sem membership ativo na organização do
  -- envio — mesmo padrão de post_shipment/shipment_item_scan_bottle acima.
  if not public.has_org_permission(v.organization_id, 'shipping.label') then
    raise exception 'forbidden';
  end if;

  update public.shipments set
    print_url = p_print_url,
    label_pdf_url = p_label_pdf_url,
    print_available = coalesce(p_print_available, false),
    print_http_status = p_print_http_status,
    print_content_type = p_print_content_type,
    print_checked_at = now(),
    integration_error = p_integration_error
  where id = v.id
  returning * into v;

  return v;
end;
$$;

revoke all on function public.shipment_set_superfrete_print_health(uuid,text,text,boolean,integer,text,text) from public,anon;
grant execute on function public.shipment_set_superfrete_print_health(uuid,text,text,boolean,integer,text,text) to authenticated,service_role;

-- Mesmo bug, mesma causa raiz, segunda ocorrência no mesmo arquivo: o ramo
-- "physical_source_not_confirmed" de superfrete-sync-shipment também fazia
-- um UPDATE direto em shipments (só para marcar integration_error como
-- pendente de conferência), sujeito ao mesmo 42501. RPC separada e mais
-- estreita ainda — não aceita nenhum valor livre de texto para
-- integration_error, só marca este código operacional fixo.
create or replace function public.shipment_mark_superfrete_pending_conference(
  p_shipment_id uuid
) returns public.shipments
language plpgsql
security definer
set search_path = public
as $$
declare v public.shipments;
begin
  select * into v from public.shipments where id = p_shipment_id for update;
  if v.id is null then
    raise exception 'shipment_not_found';
  end if;
  if not public.has_org_permission(v.organization_id, 'shipping.label') then
    raise exception 'forbidden';
  end if;

  update public.shipments set
    integration_error = 'PHYSICAL_CONFERENCE_PENDING',
    superfrete_updated_at = now()
  where id = v.id
  returning * into v;

  return v;
end;
$$;

revoke all on function public.shipment_mark_superfrete_pending_conference(uuid) from public,anon;
grant execute on function public.shipment_mark_superfrete_pending_conference(uuid) to authenticated,service_role;
