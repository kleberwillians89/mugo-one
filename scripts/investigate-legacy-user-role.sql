-- READ-ONLY. Paste into the Supabase SQL editor for the production project.
-- Nothing here writes, updates, or deletes anything. Confirms the CURRENT
-- role/membership of the single legacy user (parfumsruah@gmail.com) before
-- applying 202608190011-013, and previews exactly what the backfill in
-- 202608190011 would do to that row without actually running it.

-- 1) Current auth user + membership.
select
  u.id as user_id,
  u.email,
  u.created_at as user_created_at,
  om.organization_id,
  om.role as current_role,
  om.created_at as member_since
from auth.users u
left join public.organization_members om on om.user_id = u.id
where u.email = 'parfumsruah@gmail.com';

-- 2) How many total members does that same organization have right now?
-- (Confirms the "único usuário" claim independently.)
select
  om.organization_id,
  count(*) as total_members
from public.organization_members om
where om.organization_id = (
  select organization_id from public.organization_members om2
  join auth.users u2 on u2.id = om2.user_id
  where u2.email = 'parfumsruah@gmail.com'
  limit 1
)
group by om.organization_id;

-- 3) Preview of what 202608190011's backfill CASE expression would
-- assign, purely as a function of the role read in query 1 above —
-- doesn't touch the database, just evaluates the same mapping.
select
  role as current_role,
  case role
    when 'admin' then 'administrador'
    when 'manager' then 'gestor'
    when 'viewer' then 'visualizacao'
    else 'personalizado'
  end as would_become_preset,
  (role = 'admin') as would_become_access_total,
  (role in ('admin','viewer')) as would_become_view_all
from public.organization_members om
join auth.users u on u.id = om.user_id
where u.email = 'parfumsruah@gmail.com';
