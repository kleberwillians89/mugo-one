-- READ-ONLY. Paste into the Supabase SQL editor for the production project.
-- Nothing here writes, updates, or deletes anything. Confirms (or refutes)
-- the overload-ambiguity diagnosis behind Postgres error 42725 on
-- public.inventory_apply before applying 202608190009_inventory_apply_single_overload.sql.
--
-- Expected BEFORE the fix migration: two rows —
--   (uuid, numeric, inventory_movement_type, text, text, uuid)             -- obsolete, 6-arg
--   (uuid, numeric, inventory_movement_type, text, text, uuid, text)       -- canonical, 7-arg (p_origin)
-- Expected AFTER the fix migration: exactly one row — only the 7-arg signature.

select
  p.oid::regprocedure as signature,
  pg_get_function_identity_arguments(p.oid) as identity_arguments,
  pg_get_function_arguments(p.oid) as full_arguments,
  pg_get_function_result(p.oid) as result_type
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname = 'inventory_apply'
order by 1;
