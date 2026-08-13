alter table public.shipments
  add column if not exists print_available boolean not null default false,
  add column if not exists print_http_status integer,
  add column if not exists print_content_type text,
  add column if not exists print_checked_at timestamptz;

comment on column public.shipments.print_available is 'Disponibilidade confirmada do arquivo oficial; nunca indica nova compra.';
