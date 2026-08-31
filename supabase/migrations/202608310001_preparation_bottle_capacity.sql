begin;

-- Auditoria (final gate antes de publicar a resolução de lote/frasco em
-- /estoque/leitor): nem preparation_batch_create nem preparation_batch_confirm
-- (202608220003) jamais checavam a capacidade física do frasco escolhido
-- (inventory_bottles.physical_ml) contra o volume da(s) allocation(ões)
-- apontada(s) para ele — só validavam que o frasco existia, era do mesmo
-- perfume/organização e estava 'active'. Um frasco de 3ml podia ser aceito
-- para uma venda de 6ml, e dois itens de 6ml cada podiam apontar para o
-- mesmo frasco de 10ml sem nenhum bloqueio. post_shipment() (mesma
-- migration, linha ~241) já tem exatamente este padrão — physical_ml lido
-- com FOR UPDATE, comparado à quantidade, exceção se insuficiente — só que
-- na hora do envio (post_shipment decrementa physical_ml ali, porque é o
-- momento do consumo físico real). Esta correção aplica o MESMO padrão já
-- comprovado, só que mais cedo, na hora do planejamento — sem decrementar
-- physical_ml aqui (preparação continua sem tocar estoque físico, arquitetura
-- preservada), somando quanto desse frasco já está comprometido por
-- preparation_batch_items de batches NÃO cancelados e comparando contra
-- physical_ml antes de aceitar mais um compromisso.
create or replace function public.preparation_batch_create(p_perfume_id uuid,p_items jsonb)
returns uuid language plpgsql security definer set search_path=public as $$
declare org uuid; batch_id uuid; item jsonb; a public.inventory_allocations; requested numeric; already numeric; tracking text; bottle public.inventory_bottles; bottle_committed numeric;
begin
  select organization_id into org from public.perfumes where id=p_perfume_id and organization_id in(select public.current_user_org_ids());
  if org is null or not public.has_org_permission(org,'inventory.adjust') then raise exception 'forbidden'; end if;
  if jsonb_typeof(p_items)<>'array' or jsonb_array_length(p_items)=0 then raise exception 'preparation_items_required'; end if;
  insert into public.preparation_batches(organization_id,perfume_id,status,created_by) values(org,p_perfume_id,'awaiting_scan',auth.uid()) returning id into batch_id;
  for item in select * from jsonb_array_elements(p_items) loop
    select * into a from public.inventory_allocations where id=(item->>'allocation_id')::uuid for update;
    requested:=(item->>'quantity_ml')::numeric;
    if a.id is null or a.organization_id<>org or a.perfume_id<>p_perfume_id or a.status<>'reserved' then raise exception 'allocation_not_eligible'; end if;
    select coalesce(sum(bi.quantity_ml),0) into already from public.preparation_batch_items bi join public.preparation_batches b on b.id=bi.batch_id where bi.allocation_id=a.id and b.status='confirmed';
    if requested<=0 or already+requested>a.original_quantity_ml then raise exception 'preparation_quantity_exceeded'; end if;
    select bottle_tracking_status into tracking from public.inventory_items where id=a.inventory_item_id;
    if nullif(item->>'source_bottle_id','') is not null then
      select * into bottle from public.inventory_bottles where id=(item->>'source_bottle_id')::uuid and organization_id=org and perfume_id=p_perfume_id and status='active';
      if bottle.id is null then raise exception 'invalid_source_bottle';end if;
      select coalesce(sum(bi.quantity_ml),0) into bottle_committed from public.preparation_batch_items bi join public.preparation_batches b on b.id=bi.batch_id where bi.source_bottle_id=bottle.id and b.status='confirmed';
      if bottle_committed+requested>bottle.physical_ml then raise exception 'source_bottle_capacity_exceeded'; end if;
    elsif tracking='active' then raise exception 'source_bottle_required'; end if;
    insert into public.preparation_batch_items(batch_id,allocation_id,quantity_ml,source_bottle_id) values(batch_id,a.id,requested,nullif(item->>'source_bottle_id','')::uuid);
  end loop;
  insert into public.audit_logs(organization_id,actor_id,action,entity_type,entity_id,metadata) values(org,auth.uid(),'preparation_batch_created','preparation_batch',batch_id::text,jsonb_build_object('batch_id',batch_id,'perfume_id',p_perfume_id,'item_count',jsonb_array_length(p_items)));
  return batch_id;
end;$$;
revoke all on function public.preparation_batch_create(uuid,jsonb) from public,anon;
grant execute on function public.preparation_batch_create(uuid,jsonb) to authenticated;

-- Guarda de verdade (transacional, tenant-safe): o check acima em
-- preparation_batch_create só conta batches JÁ confirmados (mesmo critério
-- que o check pré-existente de capacidade da allocation, logo acima) — é
-- best-effort, não serializa duas criações concorrentes. A garantia real
-- fica aqui em preparation_batch_confirm, exatamente como já acontece hoje
-- para a allocation via "for update of a": o frasco é lido com FOR UPDATE,
-- travando contra qualquer outra confirmação concorrente do mesmo frasco até
-- este commit/rollback — a segunda sessão só prossegue depois, com o
-- somatório já recalculado incluindo o que a primeira acabou de confirmar.
create or replace function public.preparation_batch_confirm(p_batch_id uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare b public.preparation_batches;r record;already numeric;total numeric:=0;items integer:=0;bottle public.inventory_bottles;bottle_committed numeric;
begin
 select * into b from public.preparation_batches where id=p_batch_id for update;if b.id is null or b.organization_id not in(select public.current_user_org_ids()) then raise exception 'batch_not_found';end if;
 if b.status='confirmed' then return jsonb_build_object('ok',true,'already_confirmed',true,'message','Este fracionamento já foi concluído.');end if;if b.status<>'identified' then raise exception 'scan_confirmation_required';end if;
 for r in select bi.*,a.original_quantity_ml allocation_ml,a.status allocation_status,a.perfume_id allocation_perfume from public.preparation_batch_items bi join public.inventory_allocations a on a.id=bi.allocation_id where bi.batch_id=b.id order by bi.id for update of a loop
   if r.allocation_status<>'reserved' or r.allocation_perfume<>b.perfume_id then raise exception 'allocation_not_eligible';end if;
   select coalesce(sum(bi.quantity_ml),0) into already from public.preparation_batch_items bi join public.preparation_batches pb on pb.id=bi.batch_id where bi.allocation_id=r.allocation_id and pb.status='confirmed';
   if already+r.quantity_ml>r.allocation_ml then raise exception 'preparation_quantity_exceeded';end if;
   if r.source_bottle_id is not null then
     select * into bottle from public.inventory_bottles where id=r.source_bottle_id for update;
     if bottle.id is null then raise exception 'invalid_source_bottle';end if;
     select coalesce(sum(bi.quantity_ml),0) into bottle_committed from public.preparation_batch_items bi join public.preparation_batches pb on pb.id=bi.batch_id where bi.source_bottle_id=r.source_bottle_id and pb.status='confirmed';
     if bottle_committed+r.quantity_ml>bottle.physical_ml then raise exception 'source_bottle_capacity_exceeded';end if;
   end if;
   total:=total+r.quantity_ml;items:=items+1;
 end loop;
 update public.preparation_batches set status='confirmed',confirmed_at=now(),confirmed_by=auth.uid() where id=b.id;
 insert into public.audit_logs(organization_id,actor_id,action,entity_type,entity_id,metadata) values(b.organization_id,auth.uid(),'preparation_batch_confirmed','preparation_batch',b.id::text,jsonb_build_object('batch_id',b.id,'perfume_id',b.perfume_id,'total_ml',total,'item_count',items));
 return jsonb_build_object('ok',true,'already_confirmed',false,'total_ml',total,'item_count',items);
end;$$;
revoke all on function public.preparation_batch_confirm(uuid) from public,anon;
grant execute on function public.preparation_batch_confirm(uuid) to authenticated;

commit;
