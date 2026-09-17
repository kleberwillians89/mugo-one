begin;

-- ============================================================
-- MUGÔ ONE — Sprint M (Lead Intake + Source + Touchpoints + Dedupe)
--
-- normalize_email: só lower+trim. Deliberadamente SEM heurísticas
-- agressivas (remover "+alias", remover pontos de Gmail) — elas podem
-- fundir identidades DIFERENTES (briefing §11).
--
-- normalize_document: só dígitos, reaproveitando only_digits() já
-- existente. Nunca torna CPF/CNPJ obrigatório em lugar nenhum.
-- ============================================================

create or replace function public.normalize_email(value text)
returns text
language sql
immutable
parallel safe
as $$
  select nullif(lower(btrim(value)), '');
$$;

create or replace function public.normalize_document(value text)
returns text
language sql
immutable
parallel safe
as $$
  select nullif(public.only_digits(value), '');
$$;

commit;
