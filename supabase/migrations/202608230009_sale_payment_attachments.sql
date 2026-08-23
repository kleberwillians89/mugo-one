begin;

create table public.sale_payment_attachments(
 id uuid primary key default gen_random_uuid(),
 organization_id uuid not null references public.organizations(id),
 sale_id uuid not null references public.sales(id),
 storage_path text not null unique,
 original_file_name text not null,
 mime_type text not null,
 file_size bigint not null check(file_size>0 and file_size<=10485760),
 attachment_type text not null default 'payment_proof' check(attachment_type='payment_proof'),
 notes text,
 uploaded_by uuid references auth.users(id),
 created_at timestamptz not null default now(),
 deleted_at timestamptz,
 deleted_by uuid references auth.users(id),
 unique(organization_id,sale_id,id)
);
create index sale_payment_attachments_sale_active_idx on public.sale_payment_attachments(organization_id,sale_id) where deleted_at is null;

alter table public.sale_payment_attachments enable row level security;
create policy sale_payment_attachments_select on public.sale_payment_attachments for select using(
 public.has_org_permission(organization_id,'sales.edit')
);
revoke insert,update,delete on public.sale_payment_attachments from authenticated;
grant select on public.sale_payment_attachments to authenticated;

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('sale-payment-attachments','sale-payment-attachments',false,10485760,array['application/pdf','image/jpeg','image/png','image/webp'])
on conflict(id) do update set public=false,file_size_limit=excluded.file_size_limit,allowed_mime_types=excluded.allowed_mime_types;

create policy sale_payment_storage_insert on storage.objects for insert to authenticated with check(
 bucket_id='sale-payment-attachments' and
 array_length(storage.foldername(name),1)=2 and
 exists(select 1 from public.sales s where s.id=(storage.foldername(name))[2]::uuid
  and s.organization_id=(storage.foldername(name))[1]::uuid and s.deleted_at is null
  and public.has_org_permission(s.organization_id,'sales.edit'))
);
create policy sale_payment_storage_select on storage.objects for select to authenticated using(
 bucket_id='sale-payment-attachments' and exists(
  select 1 from public.sale_payment_attachments a where a.storage_path=name and a.deleted_at is null
   and public.has_org_permission(a.organization_id,'sales.edit'))
);
create policy sale_payment_storage_delete on storage.objects for delete to authenticated using(
 bucket_id='sale-payment-attachments' and
 array_length(storage.foldername(name),1)=2 and
 exists(select 1 from public.sales s where s.id=(storage.foldername(name))[2]::uuid
  and s.organization_id=(storage.foldername(name))[1]::uuid and s.deleted_at is null
  and public.has_org_permission(s.organization_id,'sales.edit'))
);

create function public.sale_payment_attachment_prepare(p_sale_id uuid,p_attachment_id uuid,p_extension text)
returns jsonb language plpgsql security definer set search_path=public,storage as $$
declare s public.sales;ext text;path text;
begin
 select * into s from public.sales where id=p_sale_id and organization_id in(select public.current_user_org_ids()) and deleted_at is null;
 if s.id is null then raise exception 'sale_not_found';end if;
 if not public.has_org_permission(s.organization_id,'sales.edit') then raise exception 'forbidden';end if;
 ext:=lower(regexp_replace(coalesce(p_extension,''),'[^a-z0-9]','','g'));
 if ext='jpeg' then ext:='jpg';end if;
 if ext not in('pdf','jpg','png','webp') then raise exception 'file_type_not_allowed';end if;
 path:=s.organization_id::text||'/'||s.id::text||'/'||p_attachment_id::text||'.'||ext;
 return jsonb_build_object('organization_id',s.organization_id,'sale_id',s.id,'storage_path',path);
end;$$;
revoke all on function public.sale_payment_attachment_prepare(uuid,uuid,text) from public,anon;
grant execute on function public.sale_payment_attachment_prepare(uuid,uuid,text) to authenticated;

create function public.sale_payment_attachment_finalize(p_sale_id uuid,p_attachment_id uuid,p_storage_path text,p_file_name text,p_mime_type text,p_file_size bigint,p_notes text default null)
returns public.sale_payment_attachments language plpgsql security definer set search_path=public,storage as $$
declare s public.sales;a public.sale_payment_attachments;expected text;ext text;inserted boolean:=false;
begin
 select * into s from public.sales where id=p_sale_id and organization_id in(select public.current_user_org_ids()) and deleted_at is null for share;
 if s.id is null then raise exception 'sale_not_found';end if;
 if not public.has_org_permission(s.organization_id,'sales.edit') then raise exception 'forbidden';end if;
 if p_file_size is null or p_file_size<=0 or p_file_size>10485760 then raise exception 'invalid_file_size';end if;
 if p_mime_type not in('application/pdf','image/jpeg','image/png','image/webp') then raise exception 'file_type_not_allowed';end if;
 ext:=case p_mime_type when 'application/pdf' then 'pdf' when 'image/jpeg' then 'jpg' when 'image/png' then 'png' else 'webp' end;
 expected:=s.organization_id::text||'/'||s.id::text||'/'||p_attachment_id::text||'.'||ext;
 if p_storage_path<>expected then raise exception 'invalid_storage_path';end if;
 if not exists(select 1 from storage.objects o where o.bucket_id='sale-payment-attachments' and o.name=expected) then raise exception 'storage_object_missing';end if;
 insert into public.sale_payment_attachments(id,organization_id,sale_id,storage_path,original_file_name,mime_type,file_size,notes,uploaded_by)
 values(p_attachment_id,s.organization_id,s.id,expected,left(p_file_name,255),p_mime_type,p_file_size,nullif(btrim(p_notes),''),auth.uid())
 on conflict(id) do nothing returning * into a;
 inserted:=a.id is not null;
 if not inserted then select * into a from public.sale_payment_attachments where id=p_attachment_id and organization_id=s.organization_id and sale_id=s.id;end if;
 if a.id is null or a.storage_path<>expected then raise exception 'attachment_conflict';end if;
 if inserted then insert into public.audit_logs(organization_id,actor_id,action,entity_type,entity_id,metadata)
  values(s.organization_id,auth.uid(),'sale_payment_attachment_uploaded','sale_payment_attachment',a.id::text,
   jsonb_build_object('sale_id',s.id,'attachment_id',a.id,'file_name',a.original_file_name,'mime_type',a.mime_type,'file_size',a.file_size));end if;
 return a;
end;$$;
revoke all on function public.sale_payment_attachment_finalize(uuid,uuid,text,text,text,bigint,text) from public,anon;
grant execute on function public.sale_payment_attachment_finalize(uuid,uuid,text,text,text,bigint,text) to authenticated;

create function public.sale_payment_attachments_list(p_sale_id uuid)
returns table(id uuid,sale_id uuid,storage_path text,original_file_name text,mime_type text,file_size bigint,notes text,uploaded_by uuid,uploaded_by_name text,created_at timestamptz)
language sql stable security definer set search_path=public as $$
 select a.id,a.sale_id,a.storage_path,a.original_file_name,a.mime_type,a.file_size,a.notes,a.uploaded_by,coalesce(p.full_name,'Usuário RUAH'),a.created_at
 from public.sale_payment_attachments a left join public.profiles p on p.id=a.uploaded_by
 where a.sale_id=p_sale_id and a.deleted_at is null and public.has_org_permission(a.organization_id,'sales.edit')
 order by a.created_at desc;
$$;
revoke all on function public.sale_payment_attachments_list(uuid) from public,anon;
grant execute on function public.sale_payment_attachments_list(uuid) to authenticated;

create function public.sale_payment_attachment_delete(p_attachment_id uuid)
returns public.sale_payment_attachments language plpgsql security definer set search_path=public as $$
declare a public.sale_payment_attachments;
begin
 select * into a from public.sale_payment_attachments where id=p_attachment_id and deleted_at is null for update;
 if a.id is null then raise exception 'attachment_not_found';end if;
 if not public.has_org_permission(a.organization_id,'sales.edit') then raise exception 'forbidden';end if;
 update public.sale_payment_attachments set deleted_at=now(),deleted_by=auth.uid() where id=a.id returning * into a;
 insert into public.audit_logs(organization_id,actor_id,action,entity_type,entity_id,metadata)
 values(a.organization_id,auth.uid(),'sale_payment_attachment_deleted','sale_payment_attachment',a.id::text,
  jsonb_build_object('sale_id',a.sale_id,'attachment_id',a.id,'file_name',a.original_file_name,'mime_type',a.mime_type,'file_size',a.file_size));
 return a;
end;$$;
revoke all on function public.sale_payment_attachment_delete(uuid) from public,anon;
grant execute on function public.sale_payment_attachment_delete(uuid) to authenticated;

create or replace function public.davi_excel_list_multi(
 p_filters jsonb default '{}'::jsonb,p_page integer default 0,p_page_size integer default 100,
 p_sorts jsonb default '[{"column":"sale_date","direction":"asc"},{"column":"perfume","direction":"asc"},{"column":"type","direction":"asc"},{"column":"volume","direction":"desc"}]'::jsonb
) returns jsonb language plpgsql stable security definer set search_path=public as $$
declare level jsonb;column_name text;direction text;expression text;order_clause text:='';result jsonb;position integer:=0;
begin
 if jsonb_typeof(p_sorts)<>'array' then raise exception 'invalid_sort';end if;
 for level in select value from jsonb_array_elements(p_sorts) loop
  position:=position+1;if position>5 then exit;end if;column_name:=level->>'column';direction:=lower(level->>'direction');
  if direction not in('asc','desc') then raise exception 'invalid_sort_direction';end if;
  expression:=case column_name when 'client' then 'public.davi_excel_sort_text(client_name)' when 'sale_date' then 'sale_date' when 'deadline' then 'shipping_deadline_date' when 'shipped_at' then 'shipped_at' when 'type' then 'public.davi_excel_sort_text(sale_type)' when 'volume' then 'volume_ml' when 'perfume' then 'public.davi_excel_sort_text(perfume_name)' when 'amount' then 'amount' when 'payment' then 'public.davi_excel_sort_text(payment_status)' when 'method' then 'public.davi_excel_sort_text(payment_method)' when 'paid_at' then 'paid_at' when 'credit' then 'credit_reference_amount' when 'notes' then 'public.davi_excel_sort_text(notes)' else null end;
  if expression is null then raise exception 'invalid_sort_column';end if;order_clause:=order_clause||case when order_clause='' then '' else ',' end||expression||' '||direction||' nulls last';
 end loop;
 if order_clause='' then order_clause:='sale_date asc nulls last,public.davi_excel_sort_text(perfume_name) asc nulls last,public.davi_excel_sort_text(sale_type) asc nulls last,volume_ml desc nulls last';end if;
 execute format($query$
  with base as(select d.*,(select count(*)::integer from public.sale_payment_attachments a where a.sale_id=d.id and a.deleted_at is null and public.has_org_permission(a.organization_id,'sales.edit')) attachment_count from public.davi_excel_dataset() d),filtered as(
   select * from base d where
   (coalesce($1->>'search','')='' or d.client_name ilike '%%'||($1->>'search')||'%%' or d.perfume_name ilike '%%'||($1->>'search')||'%%' or d.notes ilike '%%'||($1->>'search')||'%%' or d.search_reference ilike '%%'||($1->>'search')||'%%') and
   (coalesce($1->>'attachment','all')='all' or ($1->>'attachment'='with' and d.attachment_count>0) or ($1->>'attachment'='without' and d.attachment_count=0)) and
   public.davi_excel_filter_matches($1#>'{columns,client}',d.client_name,null,null,'text') and public.davi_excel_filter_matches($1#>'{columns,sale_date}',d.sale_date::text,null,d.sale_date,'date') and public.davi_excel_filter_matches($1#>'{columns,deadline}',coalesce(d.shipping_deadline_display,d.operational_status),null,d.shipping_deadline_date,'date') and public.davi_excel_filter_matches($1#>'{columns,shipped_at}',d.shipped_at::date::text,null,d.shipped_at::date,'date') and public.davi_excel_filter_matches($1#>'{columns,type}',d.sale_type,null,null,'text') and public.davi_excel_filter_matches($1#>'{columns,volume}',d.volume_ml::text,d.volume_ml,null,'number') and public.davi_excel_filter_matches($1#>'{columns,perfume}',d.perfume_name,null,null,'text') and public.davi_excel_filter_matches($1#>'{columns,amount}',d.amount::text,d.amount,null,'number') and public.davi_excel_filter_matches($1#>'{columns,payment}',d.payment_status,null,null,'text') and public.davi_excel_filter_matches($1#>'{columns,method}',d.payment_method,null,null,'text') and public.davi_excel_filter_matches($1#>'{columns,paid_at}',d.paid_at::text,null,d.paid_at,'date') and public.davi_excel_filter_matches($1#>'{columns,credit}',d.credit_reference_amount::text,d.credit_reference_amount,null,'number') and public.davi_excel_filter_matches($1#>'{columns,notes}',d.notes,null,null,'text')
  ),counted as(select *,count(*)over() total_count from filtered),ordered as(select * from counted order by %s,id desc limit $2 offset $3)
  select jsonb_build_object('rows',coalesce(jsonb_agg(to_jsonb(ordered)-'total_count'-'search_reference'-'shipping_deadline_date'),'[]'::jsonb),'total',coalesce(max(total_count),0)) from ordered
 $query$,order_clause) into result using coalesce(p_filters,'{}'::jsonb),least(greatest(p_page_size,1),500),greatest(p_page,0)*least(greatest(p_page_size,1),500);
 return result;
end;$$;

commit;
