begin;

-- Correção solicitada em 15/09/2026: o APC de 50 ml de VANILLA BABY,
-- lançado para DANIELA BETETO, pertence a VI COIMBRA.
do $$
declare
  v_sale public.sales;
  v_client public.clients;
begin
  select * into v_sale
  from public.sales
  where id='ea1808b3-062b-4d74-8e43-3c45929b369b'::uuid
    and deleted_at is null
    and client_id='25b156b3-792e-464c-8df3-76c5f97e144d'::uuid
    and perfume_name_raw ilike 'VANILLA BABY%'
    and volume_ml=50
  for update;

  if v_sale.id is null then
    raise exception 'vanilla_baby_sale_not_found_or_already_changed';
  end if;

  select * into v_client
  from public.clients
  where id='605e0451-f3dc-4325-8a2b-73d92dc90f84'::uuid
    and normalize_person_name(name)=normalize_person_name('VI COIMBRA')
    and organization_id=v_sale.organization_id
    and deleted_at is null;

  if v_client.id is null then
    raise exception 'vi_coimbra_client_not_found';
  end if;

  update public.sales
  set client_id=v_client.id,
      client_name_raw=v_client.name,
      updated_at=now()
  where id=v_sale.id;

  insert into public.audit_logs(organization_id,actor_id,action,entity_type,entity_id,metadata)
  values(v_sale.organization_id,null,'sale_client_corrected','sale',v_sale.id::text,
    jsonb_build_object(
      'source','requested_correction_2026_09_15',
      'perfume',v_sale.perfume_name_raw,
      'volume_ml',v_sale.volume_ml,
      'before_client_id',v_sale.client_id,
      'before_client_name','DANIELA BETETO',
      'after_client_id',v_client.id,
      'after_client_name',v_client.name
    ));
end;
$$;

commit;
