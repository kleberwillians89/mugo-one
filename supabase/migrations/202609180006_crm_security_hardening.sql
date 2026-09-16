-- ============================================================
-- MUGÔ ONE — Sprint 2 (CRM Universal Foundation)
-- Hardening dos helpers internos e funções de trigger
--
-- Funções recebem EXECUTE de PUBLIC por default no PostgreSQL. Os
-- helpers abaixo não são RPCs: todos são usados exclusivamente por
-- triggers ou por outros helpers internos da Sprint 2.
-- ============================================================

-- Estes wrappers precisam executar helpers cujo EXECUTE público é
-- revogado abaixo. SECURITY DEFINER é necessário aqui para que os
-- triggers continuem funcionando sem reexpor os helpers internos ao
-- papel que originou o DML. Todos já fixam search_path = public.
alter function public.validate_entity_tenant_ownership() security definer;
alter function public.custom_field_values_validate() security definer;

alter function public.clients_log_activity() security definer;
alter function public.companies_log_activity() security definer;
alter function public.contacts_log_activity() security definer;
alter function public.notes_log_activity() security definer;
alter function public.entity_tags_log_activity() security definer;

-- Helpers SECURITY DEFINER internos. Nenhum deles é uma RPC de
-- frontend; somente os wrappers acima podem alcançá-los em runtime.
revoke execute on function public.entity_belongs_to_organization(text, uuid, uuid)
  from public, anon, authenticated;
revoke execute on function public.log_activity(uuid, text, uuid, text, uuid, text, text, jsonb)
  from public, anon, authenticated;

-- Funções de trigger da Sprint 2 também são helpers internos. O
-- PostgreSQL não precisa de EXECUTE do papel que dispara o DML para
-- executar uma função já vinculada a um trigger.
revoke execute on function public.companies_set_updated_at()
  from public, anon, authenticated;
revoke execute on function public.contacts_set_updated_at()
  from public, anon, authenticated;
revoke execute on function public.contacts_validate_tenant_refs()
  from public, anon, authenticated;
revoke execute on function public.validate_entity_tenant_ownership()
  from public, anon, authenticated;
revoke execute on function public.entity_tags_validate_tag_tenant()
  from public, anon, authenticated;
revoke execute on function public.custom_fields_set_updated_at()
  from public, anon, authenticated;
revoke execute on function public.custom_field_values_set_updated_at()
  from public, anon, authenticated;
revoke execute on function public.custom_field_values_validate()
  from public, anon, authenticated;
revoke execute on function public.notes_set_updated_at()
  from public, anon, authenticated;
revoke execute on function public.clients_log_activity()
  from public, anon, authenticated;
revoke execute on function public.companies_log_activity()
  from public, anon, authenticated;
revoke execute on function public.contacts_log_activity()
  from public, anon, authenticated;
revoke execute on function public.notes_log_activity()
  from public, anon, authenticated;
revoke execute on function public.entity_tags_log_activity()
  from public, anon, authenticated;
