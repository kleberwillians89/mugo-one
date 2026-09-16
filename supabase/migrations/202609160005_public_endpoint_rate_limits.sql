create table if not exists public.public_endpoint_rate_limits (
  scope text not null,
  key_hash text not null,
  window_started_at timestamptz not null,
  request_count integer not null default 1 check (request_count > 0),
  updated_at timestamptz not null default now(),
  primary key (scope, key_hash, window_started_at)
);

alter table public.public_endpoint_rate_limits enable row level security;
revoke all on table public.public_endpoint_rate_limits from anon, authenticated;

create or replace function public.consume_public_endpoint_rate_limit(
  p_scope text,
  p_key_hash text,
  p_limit integer,
  p_window_seconds integer
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  bucket timestamptz;
  current_count integer;
begin
  if auth.role() <> 'service_role' then
    raise exception 'permission_denied' using errcode = '42501';
  end if;
  if p_scope !~ '^[a-z0-9_.:-]{1,80}$'
     or p_key_hash !~ '^[a-f0-9]{64}$'
     or p_limit not between 1 and 1000
     or p_window_seconds not between 10 and 86400 then
    raise exception 'invalid_rate_limit_input' using errcode = '22023';
  end if;

  bucket := to_timestamp(
    floor(extract(epoch from clock_timestamp()) / p_window_seconds) * p_window_seconds
  );

  insert into public.public_endpoint_rate_limits(scope, key_hash, window_started_at)
  values (p_scope, p_key_hash, bucket)
  on conflict (scope, key_hash, window_started_at)
  do update set request_count = public.public_endpoint_rate_limits.request_count + 1,
                updated_at = now()
  returning request_count into current_count;

  delete from public.public_endpoint_rate_limits
  where window_started_at < now() - interval '7 days';

  return current_count <= p_limit;
end;
$$;

revoke all on function public.consume_public_endpoint_rate_limit(text,text,integer,integer) from public, anon, authenticated;
grant execute on function public.consume_public_endpoint_rate_limit(text,text,integer,integer) to service_role;

