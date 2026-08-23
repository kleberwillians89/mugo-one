begin;

create unique index if not exists sales_org_davi_idempotency_uidx
on public.sales(organization_id,import_signature)
where source='davi_excel' and import_signature is not null;

create or replace function public.davi_excel_create_sale(p_payload jsonb,p_idempotency_key text)
returns uuid language plpgsql security definer set search_path=public as $$
declare org uuid;uid uuid:=auth.uid();client public.clients;perfume public.perfumes;sale_id uuid;status public.payment_status;
begin
 if uid is null then raise exception 'authentication_required';end if;
 if nullif(btrim(p_idempotency_key),'') is null then raise exception 'idempotency_key_required';end if;
 select * into client from public.clients where id=(p_payload->>'client_id')::uuid and deleted_at is null and merged_into_id is null;
 if not found then raise exception 'invalid_client';end if;
 org:=client.organization_id;
 if not public.has_org_permission(org,'sales.edit') then raise exception 'permission_denied';end if;
 select * into perfume from public.perfumes where id=(p_payload->>'perfume_id')::uuid and organization_id=org;
 if not found then raise exception 'invalid_perfume';end if;
 status:=(p_payload->>'payment_status')::public.payment_status;
 if (p_payload->>'sale_type') not in('APC','SPLIT') then raise exception 'invalid_sale_type';end if;
 if (p_payload->>'volume_ml')::numeric<=0 then raise exception 'invalid_volume';end if;
 if (p_payload->>'amount')::numeric<0 then raise exception 'invalid_amount';end if;
 select id into sale_id from public.sales where organization_id=org and source='davi_excel' and import_signature=p_idempotency_key;
 if found then return sale_id;end if;
 insert into public.sales(organization_id,client_id,perfume_id,sale_date,amount,payment_status,payment_method,paid_at,notes,source,import_signature,created_by,perfume_name_raw,perfume_base_name,sale_type,volume_ml,volume_ml_raw,shipping_deadline_raw,shipping_deadline_date,shipping_operational_status,data_quality_status,inventory_allocation_eligible,operational_created_at)
 values(org,client.id,perfume.id,(p_payload->>'sale_date')::date,(p_payload->>'amount')::numeric,status,nullif(btrim(p_payload->>'payment_method'),''),case when status='paid' then nullif(p_payload->>'paid_at','')::date else null end,nullif(btrim(p_payload->>'notes'),''),'davi_excel',p_idempotency_key,uid,perfume.full_name_raw,perfume.base_name,p_payload->>'sale_type',(p_payload->>'volume_ml')::numeric,p_payload->>'volume_ml',nullif(btrim(p_payload->>'shipping_deadline_raw'),''),nullif(p_payload->>'shipping_deadline_date','')::date,case when nullif(p_payload->>'shipping_deadline_date','') is null then nullif(btrim(p_payload->>'shipping_deadline_raw'),'') else null end,'verified',true,now()) returning id into sale_id;
 return sale_id;
exception when unique_violation then
 select id into sale_id from public.sales where organization_id=org and source='davi_excel' and import_signature=p_idempotency_key;
 return sale_id;
end;$$;

revoke all on function public.davi_excel_create_sale(jsonb,text) from public,anon;
grant execute on function public.davi_excel_create_sale(jsonb,text) to authenticated;

commit;
