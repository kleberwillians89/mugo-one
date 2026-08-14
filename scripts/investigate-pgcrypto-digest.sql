-- READ-ONLY. Paste into the Supabase SQL editor for the production project.
-- Nothing here writes, updates, or deletes anything. Safe to run before
-- applying 202608140005_fix_pgcrypto_digest_resolution.sql.

-- 1) Where is pgcrypto actually installed?
select
  e.extname,
  n.nspname as extension_schema
from pg_extension e
join pg_namespace n on n.oid = e.extnamespace
where e.extname = 'pgcrypto';

-- 2) Which digest(text,text) signature actually resolves in each schema?
select
  to_regprocedure('extensions.digest(text,text)') as extensions_digest,
  to_regprocedure('public.digest(text,text)')     as public_digest;

-- 3) Confirm the fix's helper function exists and resolves once
--    202608140005 is applied (run again after applying, expect non-null).
select to_regprocedure('public.ai_sha256_hex(text)') as ai_sha256_hex;

-- 4) Sanity: does the search_path used by the affected SECURITY DEFINER
--    functions actually include "extensions" anywhere? (expected: no —
--    the fix intentionally keeps search_path=public and fully qualifies
--    extensions.digest instead of widening search_path.)
select
  p.proname,
  p.prosecdef as security_definer,
  p.proconfig
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname in ('confirm_ai_sales_batch','confirm_ai_sales_batch_multi','ai_sha256_hex');
