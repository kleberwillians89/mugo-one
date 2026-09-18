begin;

-- ============================================================
-- MUGÔ ONE — Sprint Final de Produto (Cobranças Simples + Zero Ruah + UX Apple)
--
-- Prefixo "RUAH-" na geração de código de barras físico (frasco/split)
-- e no operational_code de perfume vira "MUGO-" — briefing §31-32.
--
-- REGRA OBRIGATÓRIA: nenhum código JÁ IMPRESSO pode parar de funcionar.
-- Só a GERAÇÃO de código NOVO muda aqui — a LEITURA (parseScannedValue,
-- src/lib/bottle-scan.ts) já foi generalizada para aceitar os dois
-- prefixos, sempre resolvendo um código legado "RUAH-..." exatamente
-- contra a linha histórica (nunca reescreve para o prefixo novo).
--
-- bottle_code/split_code (a chave real de busca no banco) NUNCA tiveram
-- o prefixo — só barcode_value (valor impresso/exibido) o carrega, então
-- trocar o prefixo aqui não invalida nenhuma busca existente, só muda o
-- texto do PRÓXIMO código impresso.
-- ============================================================

create or replace function public.inventory_bottle_generate(p_inventory_item_id uuid, p_bottle_label text)
returns inventory_bottles
language plpgsql
security definer
set search_path to 'public'
as $function$
declare v_item public.inventory_items; v_seq integer; v_code text; v_barcode text; v_token text; v_bottle public.inventory_bottles;
begin
  select * into v_item from public.inventory_items where id=p_inventory_item_id for update;
  if not found then raise exception 'inventory_item_not_found'; end if;
  if not public.has_org_role(v_item.organization_id,array['admin','manager']::public.member_role[])
    then raise exception 'inventory_write_forbidden'; end if;
  if btrim(coalesce(p_bottle_label,''))='' then raise exception 'bottle_label_required'; end if;

  insert into public.inventory_bottle_sequences(organization_id,last_value) values(v_item.organization_id,1)
    on conflict(organization_id) do update set last_value=public.inventory_bottle_sequences.last_value+1
    returning last_value into v_seq;
  v_code:='F'||lpad(v_seq::text,6,'0');
  v_barcode:='MUGO-'||v_code;
  v_token:=replace(gen_random_uuid()::text,'-','')||replace(gen_random_uuid()::text,'-','');

  insert into public.inventory_bottles(organization_id,inventory_item_id,perfume_id,bottle_code,bottle_label,barcode_value,qr_token,physical_ml,created_by)
  values(v_item.organization_id,v_item.id,v_item.perfume_id,v_code,btrim(p_bottle_label),v_barcode,v_token,0,auth.uid())
  returning * into v_bottle;

  if v_item.bottle_tracking_status='untracked' then
    update public.inventory_items set bottle_tracking_status='onboarding',updated_at=now() where id=v_item.id;
  end if;

  insert into public.audit_logs(organization_id,actor_id,action,entity_type,entity_id,metadata)
  values(v_item.organization_id,auth.uid(),'inventory_bottle_generated','inventory_bottle',v_bottle.id::text,
    jsonb_build_object('bottle_code',v_code,'inventory_item_id',v_item.id));
  return v_bottle;
end;
$function$;

create or replace function public.inventory_split_bottle(p_source_bottle_id uuid, p_quantity_ml numeric, p_count integer)
returns setof inventory_split_units
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_bottle public.inventory_bottles; v_total numeric; v_seq integer; v_split_code text; v_row public.inventory_split_units; i integer;
begin
  select * into v_bottle from public.inventory_bottles where id=p_source_bottle_id for update;
  if v_bottle.id is null then raise exception 'bottle_not_found'; end if;
  if not public.has_org_permission(v_bottle.organization_id,'inventory.split')
    then raise exception 'inventory_write_forbidden'; end if;
  if p_quantity_ml is null or p_quantity_ml<=0 then raise exception 'invalid_quantity'; end if;
  if p_count is null or p_count<=0 or p_count>500 then raise exception 'invalid_count'; end if;
  if v_bottle.status<>'active' then raise exception 'bottle_unavailable'; end if;

  v_total:=p_quantity_ml*p_count;
  if v_bottle.physical_ml<v_total then raise exception 'insufficient_bottle_inventory'; end if;

  select count(*) into v_seq from public.inventory_split_units where source_bottle_id=p_source_bottle_id;

  update public.inventory_bottles set
    physical_ml=physical_ml-v_total,
    status=case when physical_ml-v_total=0 then 'empty' else status end,
    updated_at=now()
  where id=p_source_bottle_id;

  for i in 1..p_count loop
    v_seq:=v_seq+1;
    v_split_code:='S'||substring(v_bottle.bottle_code from 2)||'-'||lpad(v_seq::text,3,'0');
    insert into public.inventory_split_units(
      organization_id,perfume_id,inventory_item_id,source_bottle_id,split_code,barcode_value,quantity_ml,created_by
    ) values(
      v_bottle.organization_id,v_bottle.perfume_id,v_bottle.inventory_item_id,p_source_bottle_id,
      v_split_code,'MUGO-'||v_split_code,p_quantity_ml,auth.uid()
    ) returning * into v_row;
    return next v_row;
  end loop;

  insert into public.audit_logs(organization_id,actor_id,action,entity_type,entity_id,metadata)
  values(v_bottle.organization_id,auth.uid(),'inventory_bottle_split','inventory_bottle',p_source_bottle_id::text,
    jsonb_build_object('quantity_ml',p_quantity_ml,'count',p_count,'total_ml',v_total,'physical_ml_before',v_bottle.physical_ml,'physical_ml_after',v_bottle.physical_ml-v_total));
  return;
end;
$function$;

create or replace function public.perfume_operational_code_assign()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if tg_op='INSERT' and new.operational_code is not null then raise exception 'operational_code_generated_by_database'; end if;
  if tg_op='UPDATE' and new.operational_code is distinct from old.operational_code then
    if old.operational_code is not null or coalesce(current_setting('mugo.operational_code_assignment',true),'')<>'on' then
      raise exception 'operational_code_immutable';
    end if;
  end if;
  return new;
end;$function$;

create or replace function public.ensure_perfume_operational_code(p_perfume_id uuid)
returns text
language plpgsql
security definer
set search_path to 'public'
as $function$
declare p public.perfumes;seq integer;
begin
  select * into p from public.perfumes where id=p_perfume_id for update;
  if p.id is null then raise exception 'perfume_not_found';end if;
  if p.operational_code is not null then return p.operational_code;end if;
  insert into public.perfume_operational_sequences(organization_id,last_value) values(p.organization_id,1)
  on conflict(organization_id) do update set last_value=public.perfume_operational_sequences.last_value+1 returning last_value into seq;
  perform set_config('mugo.operational_code_assignment','on',true);
  update public.perfumes set operational_code='MUGO-P'||lpad(seq::text,6,'0') where id=p.id returning operational_code into p.operational_code;
  perform set_config('mugo.operational_code_assignment','off',true);
  return p.operational_code;
end;$function$;

commit;
