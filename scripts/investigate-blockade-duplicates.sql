-- READ-ONLY. Paste into the Supabase SQL editor for the production project.
-- Nothing here writes, updates, or deletes anything. Safe to run right now,
-- before migration 202608140004 is applied (it does not depend on anything
-- that migration would add).

-- 0) Current RPC signatures for bootstrap_ai_batch_inventory. Confirms
--    there is exactly one signature today (the 7-argument one from
--    202608140002), and after 202608140004 is applied, confirms it is
--    STILL exactly one signature for that name (plus a separately named
--    bootstrap_ai_batch_inventory_resolved — never an overload).
select
  p.oid::regprocedure as signature,
  pg_get_function_arguments(p.oid) as arguments
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname in ('bootstrap_ai_batch_inventory', 'bootstrap_ai_batch_inventory_resolved')
order by p.proname, signature;

-- 1) Exact reproduction of the BLOCKADE case: every perfume row whose
--    canonical (frasco-stripped) normalized name matches, across all orgs
--    you have access to, with brand + whether it already has an inventory
--    item in that org.
select
  p.organization_id,
  p.id as perfume_id,
  p.full_name_raw,
  p.normalized_name as stored_normalized_name,
  public.normalize_ai_perfume_name(p.full_name_raw) as recomputed_canonical_name,
  p.brand_house,
  p.bottle_identifier,
  i.id as inventory_item_id,
  i.status as inventory_status,
  i.reconciliation_status,
  i.bootstrap_pending_verification
from public.perfumes p
left join public.inventory_items i on i.perfume_id = p.id and i.organization_id = p.organization_id
where public.normalize_ai_perfume_name(p.full_name_raw) = public.normalize_ai_perfume_name('BLOCKADE - MIND GAMES')
order by p.organization_id, p.full_name_raw;

-- 2) Org-wide duplicate audit, grouped by the identity the resolver now
--    actually uses: canonical (frasco-stripped) normalized name + brand
--    normalized the same way (lowercase, unaccented, non-alnum collapsed).
--    Inlined here (not depending on normalize_ai_brand, which only exists
--    after 202608140004 is applied) so this can run beforehand.
select
  organization_id,
  public.normalize_ai_perfume_name(full_name_raw) as canonical_name,
  btrim(regexp_replace(lower(unaccent(coalesce(brand_house, ''))), '[^a-z0-9]+', ' ', 'g')) as normalized_brand,
  count(*) as candidate_count,
  array_agg(full_name_raw order by full_name_raw) as raw_names,
  array_agg(id order by full_name_raw) as perfume_ids
from public.perfumes
group by organization_id, public.normalize_ai_perfume_name(full_name_raw),
  btrim(regexp_replace(lower(unaccent(coalesce(brand_house, ''))), '[^a-z0-9]+', ' ', 'g'))
having count(*) > 1
order by candidate_count desc, organization_id;
