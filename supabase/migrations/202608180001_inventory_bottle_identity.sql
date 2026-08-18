begin;

-- RUAH — Identidade física dos frascos (QR + Code128 "Modo Ilde").
--
-- inventory_items continua POOLED por (organization_id,perfume_id) — não é
-- reescrito. Este arquivo adiciona uma camada fina e opcional por cima dele:
-- inventory_bottles representa cada frasco físico individual (1 linha = 1
-- frasco), sempre filho de um inventory_items existente. Nenhuma linha nova
-- em perfumes é criada por frasco — Radar/Reposição/matching de vendas
-- continuam intocados, pois todos chaveiam em perfume_id/inventory_item_id
-- exatamente como hoje.
--
-- Toda escrita em estoque físico continua passando por inventory_apply(...)
-- (estendido aqui com um parâmetro opcional p_origin, retrocompatível — todo
-- chamador existente continua funcionando sem alterações). Nada aqui grava
-- diretamente em inventory_items.physical_ml fora dessa função.

-- ---------------------------------------------------------------------
-- 1. Adoção por item: untracked (modelo antigo) → onboarding (identificando
--    frascos) → active (todos os frascos identificados e conciliados).
-- ---------------------------------------------------------------------
alter table public.inventory_items
  add column if not exists bottle_tracking_status text not null default 'untracked'
    check(bottle_tracking_status in('untracked','onboarding','active'));

-- Origem do movimento (nullable = comportamento anterior/manual, retrocompatível).
alter table public.inventory_movements
  add column if not exists origin text;

-- ---------------------------------------------------------------------
-- 2. Contador sequencial de bottle_code por organização. Um upsert-increment
--    atômico evita tanto lacunas de MAX()+1 quanto colisões sob concorrência.
-- ---------------------------------------------------------------------
create table public.inventory_bottle_sequences (
  organization_id uuid primary key references public.organizations(id) on delete cascade,
  last_value integer not null default 0
);
alter table public.inventory_bottle_sequences enable row level security;
create policy inventory_bottle_sequences_select on public.inventory_bottle_sequences for select
  using(organization_id in(select public.current_user_org_ids()));
revoke insert,update,delete on public.inventory_bottle_sequences from authenticated;

-- ---------------------------------------------------------------------
-- 3. inventory_bottles — 1 frasco físico. QR (qr_token) e código de barras
--    (barcode_value) resolvem para a MESMA linha — nunca entidades distintas.
-- ---------------------------------------------------------------------
create table public.inventory_bottles (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  inventory_item_id uuid not null references public.inventory_items(id) on delete cascade,
  perfume_id uuid not null references public.perfumes(id),

  bottle_code text not null,
  bottle_label text not null,
  barcode_value text not null,
  qr_token text not null,

  physical_ml numeric(14,3) not null default 0 check(physical_ml >= 0),
  apc_unit_available boolean not null default true,
  status text not null default 'active' check(status in('active','empty','retired')),

  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  unique(organization_id,bottle_code),
  unique(organization_id,barcode_value),
  unique(qr_token)
);
create index inventory_bottles_item_idx on public.inventory_bottles(inventory_item_id);
create index inventory_bottles_org_status_idx on public.inventory_bottles(organization_id,status);

alter table public.inventory_bottles enable row level security;
create policy inventory_bottles_select on public.inventory_bottles for select
  using(organization_id in(select public.current_user_org_ids()));
-- Toda escrita passa pelas funções SECURITY DEFINER abaixo (cada uma valida
-- papel manualmente, no mesmo padrão de inventory_apply); nenhuma política
-- de insert/update/delete é concedida direto à role authenticated.
revoke insert,update,delete on public.inventory_bottles from authenticated;

-- ---------------------------------------------------------------------
-- 4. Histórico legível de conferências — não técnico, sem UUID na tela
--    (seção 23 do briefing). Sempre gravado dentro da mesma transação que a
--    conferência, nunca reconstituído via joins.
-- ---------------------------------------------------------------------
create table public.inventory_bottle_conferences (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  bottle_id uuid not null references public.inventory_bottles(id) on delete cascade,
  inventory_item_id uuid not null references public.inventory_items(id),
  movement_id uuid references public.inventory_movements(id),
  ml_before numeric(14,3) not null,
  ml_after numeric(14,3) not null,
  apc_before boolean not null,
  apc_after boolean not null,
  conferred_by uuid references public.profiles(id),
  conferred_at timestamptz not null default now()
);
create index inventory_bottle_conferences_bottle_idx on public.inventory_bottle_conferences(bottle_id,conferred_at desc);

alter table public.inventory_bottle_conferences enable row level security;
create policy inventory_bottle_conferences_select on public.inventory_bottle_conferences for select
  using(organization_id in(select public.current_user_org_ids()));
revoke insert,update,delete on public.inventory_bottle_conferences from authenticated;

-- ---------------------------------------------------------------------
-- 5. inventory_apply — mesma assinatura de sempre + p_origin opcional
--    (default null, retrocompatível: nenhum chamador existente muda). Um
--    "true replace", não uma nova sobrecarga — mesmo padrão já usado em
--    202608130001/202608140001 para evoluir esta função.
-- ---------------------------------------------------------------------
create or replace function public.inventory_apply(
  p_item_id uuid,p_quantity_ml numeric,p_type public.inventory_movement_type,
  p_reason text,p_notes text default null,p_sale_id uuid default null,p_origin text default null
) returns public.inventory_movements
language plpgsql security definer set search_path=public
as $$
declare v_item public.inventory_items; v_movement public.inventory_movements; v_after numeric; v_physical_after numeric;
begin
  select * into v_item from public.inventory_items where id=p_item_id for update;
  if not found then raise exception 'inventory_item_not_found'; end if;
  if auth.uid() is not null and not public.has_org_role(v_item.organization_id,array['admin','manager','operator']::public.member_role[])
    then raise exception 'inventory_write_forbidden'; end if;
  if p_quantity_ml=0 or btrim(coalesce(p_reason,''))='' then raise exception 'inventory_reason_and_quantity_required'; end if;
  v_after:=v_item.available_ml+p_quantity_ml;
  if v_after<0 then raise exception 'insufficient_inventory'; end if;
  v_physical_after:=v_item.physical_ml+p_quantity_ml;
  if v_physical_after<0 then raise exception 'insufficient_inventory'; end if;
  update public.inventory_items set available_ml=v_after,physical_ml=v_physical_after,updated_at=now() where id=v_item.id;
  insert into public.inventory_movements(
    organization_id,inventory_item_id,perfume_id,sale_id,movement_type,quantity_ml,
    balance_before,balance_after,reason,notes,created_by,origin
  ) values(
    v_item.organization_id,v_item.id,v_item.perfume_id,p_sale_id,p_type,p_quantity_ml,
    v_item.available_ml,v_after,p_reason,p_notes,auth.uid(),p_origin
  ) returning * into v_movement;
  insert into public.audit_logs(organization_id,actor_id,action,entity_type,entity_id,metadata)
  values(v_item.organization_id,auth.uid(),'inventory_movement','inventory_item',v_item.id::text,
    jsonb_build_object('movement_id',v_movement.id,'type',p_type,'quantity_ml',p_quantity_ml,'sale_id',p_sale_id,'origin',p_origin,
      'physical_before',v_item.physical_ml,'physical_after',v_physical_after));
  return v_movement;
end;
$$;
grant execute on function public.inventory_apply(uuid,numeric,public.inventory_movement_type,text,text,uuid,text) to authenticated,service_role;

-- ---------------------------------------------------------------------
-- 6. Geração de identidade. Nunca é entrada de estoque (seção 6): o frasco
--    nasce com physical_ml=0 — a Dona Ilde confere o valor real depois, ou
--    (para frasco novo pós-active) o ml já entra via inventory_bottle_add_new,
--    que soma no pooled de forma atômica.
-- ---------------------------------------------------------------------
create or replace function public.inventory_bottle_generate(
  p_inventory_item_id uuid,p_bottle_label text
) returns public.inventory_bottles
language plpgsql security definer set search_path=public
as $$
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
  v_barcode:='RUAH-'||v_code;
  -- gen_random_uuid() é nativo do Postgres (não depende de pgcrypto, cujo
  -- schema de instalação já causou um incidente de produção neste projeto —
  -- ver 202608140005). 32 hex chars ~ 122 bits de entropia: imprevisível o
  -- suficiente sem depender de extensão nenhuma.
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
$$;
grant execute on function public.inventory_bottle_generate(uuid,text) to authenticated,service_role;

-- ---------------------------------------------------------------------
-- 7. Novo frasco depois que o item já está "active" (seção 16): soma no
--    pooled via inventory_apply (uma vez) e já nasce com o ml conhecido —
--    nunca dupla soma porque tudo roda numa única função/transação.
-- ---------------------------------------------------------------------
create or replace function public.inventory_bottle_add_new(
  p_inventory_item_id uuid,p_ml numeric,p_bottle_label text
) returns public.inventory_bottles
language plpgsql security definer set search_path=public
as $$
declare v_item public.inventory_items; v_bottle public.inventory_bottles;
begin
  select * into v_item from public.inventory_items where id=p_inventory_item_id for update;
  if not found then raise exception 'inventory_item_not_found'; end if;
  if not public.has_org_role(v_item.organization_id,array['admin','manager','operator']::public.member_role[])
    then raise exception 'inventory_write_forbidden'; end if;
  if p_ml is null or p_ml<=0 then raise exception 'invalid_bottle_amount'; end if;

  perform public.inventory_apply(v_item.id,p_ml,'entry','Novo frasco físico identificado',null,null,'qr_conference');
  v_bottle:=public.inventory_bottle_generate(v_item.id,p_bottle_label);
  update public.inventory_bottles set physical_ml=p_ml,updated_at=now() where id=v_bottle.id returning * into v_bottle;
  return v_bottle;
end;
$$;
grant execute on function public.inventory_bottle_add_new(uuid,numeric,text) to authenticated,service_role;

-- ---------------------------------------------------------------------
-- 8. Resolução por QR token — chamada logo após o login, quando auth.uid()
--    já existe. Token inexistente, revogado (sobrescrito) OU de outra
--    organização retornam exatamente o mesmo "nenhuma linha" — nunca
--    vazamos qual dos três motivos foi (seção 26).
-- ---------------------------------------------------------------------
create or replace function public.inventory_bottle_resolve_token(p_token text)
returns table(
  bottle_id uuid,bottle_code text,bottle_label text,physical_ml numeric,apc_unit_available boolean,
  status text,updated_at timestamptz,perfume_name text,brand_house text,inventory_item_id uuid,
  item_available_ml numeric
) language sql stable security definer set search_path=public
as $$
  select b.id,b.bottle_code,b.bottle_label,b.physical_ml,b.apc_unit_available,b.status,b.updated_at,
    p.base_name,p.brand_house,b.inventory_item_id,i.available_ml
  from public.inventory_bottles b
  join public.perfumes p on p.id=b.perfume_id
  join public.inventory_items i on i.id=b.inventory_item_id
  where b.qr_token=btrim(coalesce(p_token,''))
    and b.organization_id in(select public.current_user_org_ids());
$$;
grant execute on function public.inventory_bottle_resolve_token(text) to authenticated,service_role;

-- Aceita tanto o valor completo do barcode ("RUAH-F000185") quanto o código
-- curto digitado manualmente ("F000185") — mesma função, seção 24.
create or replace function public.inventory_bottle_resolve_code(p_value text)
returns table(
  bottle_id uuid,bottle_code text,bottle_label text,physical_ml numeric,apc_unit_available boolean,
  status text,updated_at timestamptz,perfume_name text,brand_house text,inventory_item_id uuid,
  item_available_ml numeric
) language sql stable security definer set search_path=public
as $$
  select b.id,b.bottle_code,b.bottle_label,b.physical_ml,b.apc_unit_available,b.status,b.updated_at,
    p.base_name,p.brand_house,b.inventory_item_id,i.available_ml
  from public.inventory_bottles b
  join public.perfumes p on p.id=b.perfume_id
  join public.inventory_items i on i.id=b.inventory_item_id
  where (upper(btrim(coalesce(p_value,'')))=upper(b.barcode_value) or upper(btrim(coalesce(p_value,'')))=upper(b.bottle_code))
    and b.organization_id in(select public.current_user_org_ids());
$$;
grant execute on function public.inventory_bottle_resolve_code(text) to authenticated,service_role;

-- ---------------------------------------------------------------------
-- 9. Conferência atômica (seção 15, os 12 passos). Delta=0 ainda registra a
--    conferência (uma checagem física aconteceu) mas NÃO chama
--    inventory_apply — que rejeita quantidade zero — só grava audit_logs
--    direto para manter o mesmo padrão de rastreabilidade.
-- ---------------------------------------------------------------------
create or replace function public.inventory_bottle_confirm_conference(
  p_bottle_id uuid,p_observed_ml numeric,p_apc_available boolean,p_expected_updated_at timestamptz
) returns jsonb
language plpgsql security definer set search_path=public
as $$
declare v_bottle public.inventory_bottles; v_ml_before numeric; v_apc_before boolean; v_delta numeric; v_movement public.inventory_movements; v_conference public.inventory_bottle_conferences;
begin
  select * into v_bottle from public.inventory_bottles where id=p_bottle_id for update;
  if not found then raise exception 'bottle_not_found'; end if;
  if v_bottle.organization_id not in(select public.current_user_org_ids()) then raise exception 'bottle_not_found'; end if;
  if not public.has_org_role(v_bottle.organization_id,array['admin','manager','operator']::public.member_role[])
    then raise exception 'inventory_write_forbidden'; end if;
  if p_observed_ml is null or p_observed_ml<0 then raise exception 'invalid_observed_amount'; end if;
  if p_expected_updated_at is distinct from v_bottle.updated_at then raise exception 'stale_conference'; end if;

  -- Capturados ANTES de qualquer update — v_bottle é reaproveitada abaixo
  -- (returning * into v_bottle) e passaria a refletir os valores NOVOS.
  v_ml_before:=v_bottle.physical_ml;
  v_apc_before:=v_bottle.apc_unit_available;
  v_delta:=p_observed_ml-v_ml_before;
  if v_delta<>0 then
    v_movement:=public.inventory_apply(
      v_bottle.inventory_item_id,v_delta,case when v_delta>0 then 'positive_adjustment' else 'negative_adjustment' end,
      'Conferência física de frasco ('||v_bottle.bottle_code||')',v_bottle.bottle_label,null,'qr_conference'
    );
  end if;

  update public.inventory_bottles set
    physical_ml=p_observed_ml,apc_unit_available=p_apc_available,
    status=case when p_observed_ml=0 then 'empty' when status='empty' and p_observed_ml>0 then 'active' else status end,
    updated_at=now()
  where id=v_bottle.id returning * into v_bottle;

  insert into public.inventory_bottle_conferences(organization_id,bottle_id,inventory_item_id,movement_id,ml_before,ml_after,apc_before,apc_after,conferred_by)
  values(v_bottle.organization_id,v_bottle.id,v_bottle.inventory_item_id,v_movement.id,
    v_ml_before,p_observed_ml,v_apc_before,p_apc_available,auth.uid())
  returning * into v_conference;

  if v_delta=0 then
    insert into public.audit_logs(organization_id,actor_id,action,entity_type,entity_id,metadata)
    values(v_bottle.organization_id,auth.uid(),'inventory_bottle_conference_no_change','inventory_bottle',v_bottle.id::text,
      jsonb_build_object('bottle_code',v_bottle.bottle_code,'ml',p_observed_ml,'apc_unit_available',p_apc_available));
  end if;

  return jsonb_build_object('bottle_id',v_bottle.id,'physical_ml',v_bottle.physical_ml,'apc_unit_available',v_bottle.apc_unit_available,
    'status',v_bottle.status,'updated_at',v_bottle.updated_at,'delta',v_delta,'conference_id',v_conference.id);
end;
$$;
grant execute on function public.inventory_bottle_confirm_conference(uuid,numeric,boolean,timestamptz) to authenticated,service_role;

-- ---------------------------------------------------------------------
-- 10. Preview de reconciliação para a tela de onboarding (seção 8) —
--     nunca corrige sozinho: só relata a diferença, a decisão de finalizar
--     é sempre um ato humano explícito.
-- ---------------------------------------------------------------------
create or replace function public.inventory_bottle_tracking_preview(p_inventory_item_id uuid)
returns jsonb language sql stable security definer set search_path=public
as $$
  select jsonb_build_object(
    'inventory_item_id',i.id,'perfume_name',p.base_name,'brand_house',p.brand_house,
    'bottle_tracking_status',i.bottle_tracking_status,'system_ml',i.physical_ml,
    'identified_ml',coalesce((select sum(b.physical_ml) from public.inventory_bottles b where b.inventory_item_id=i.id and b.status<>'retired'),0),
    'bottles',coalesce((select jsonb_agg(jsonb_build_object(
        'id',b.id,'bottle_code',b.bottle_code,'bottle_label',b.bottle_label,'physical_ml',b.physical_ml,
        'apc_unit_available',b.apc_unit_available,'status',b.status,'updated_at',b.updated_at
      ) order by b.bottle_label) from public.inventory_bottles b where b.inventory_item_id=i.id and b.status<>'retired'),'[]'::jsonb)
  )
  from public.inventory_items i join public.perfumes p on p.id=i.perfume_id
  where i.id=p_inventory_item_id and i.organization_id in(select public.current_user_org_ids());
$$;
grant execute on function public.inventory_bottle_tracking_preview(uuid) to authenticated,service_role;

create or replace function public.inventory_bottle_finalize_tracking(p_inventory_item_id uuid)
returns public.inventory_items
language plpgsql security definer set search_path=public
as $$
declare v_item public.inventory_items; v_identified numeric;
begin
  select * into v_item from public.inventory_items where id=p_inventory_item_id for update;
  if not found then raise exception 'inventory_item_not_found'; end if;
  if not public.has_org_role(v_item.organization_id,array['admin','manager']::public.member_role[])
    then raise exception 'inventory_write_forbidden'; end if;
  select coalesce(sum(physical_ml),0) into v_identified from public.inventory_bottles where inventory_item_id=v_item.id and status<>'retired';
  if v_identified<>v_item.physical_ml then
    raise exception 'tracking_reconciliation_mismatch: sistema=% identificado=% diferenca=%',v_item.physical_ml,v_identified,(v_identified-v_item.physical_ml);
  end if;
  update public.inventory_items set bottle_tracking_status='active',updated_at=now() where id=v_item.id returning * into v_item;
  insert into public.audit_logs(organization_id,actor_id,action,entity_type,entity_id,metadata)
  values(v_item.organization_id,auth.uid(),'inventory_bottle_tracking_activated','inventory_item',v_item.id::text,
    jsonb_build_object('identified_ml',v_identified));
  return v_item;
end;
$$;
grant execute on function public.inventory_bottle_finalize_tracking(uuid) to authenticated,service_role;

-- ---------------------------------------------------------------------
-- 11. Revogação — só o QR token muda (regenerável); bottle_code/barcode_value
--     ficam permanentes por design (seção 27).
-- ---------------------------------------------------------------------
create or replace function public.inventory_bottle_revoke_qr(p_bottle_id uuid)
returns public.inventory_bottles
language plpgsql security definer set search_path=public
as $$
declare v_bottle public.inventory_bottles; v_token text;
begin
  select * into v_bottle from public.inventory_bottles where id=p_bottle_id for update;
  if not found then raise exception 'bottle_not_found'; end if;
  if not public.has_org_role(v_bottle.organization_id,array['admin','manager']::public.member_role[])
    then raise exception 'inventory_write_forbidden'; end if;
  v_token:=replace(gen_random_uuid()::text,'-','')||replace(gen_random_uuid()::text,'-','');
  update public.inventory_bottles set qr_token=v_token,updated_at=now() where id=v_bottle.id returning * into v_bottle;
  insert into public.audit_logs(organization_id,actor_id,action,entity_type,entity_id,metadata)
  values(v_bottle.organization_id,auth.uid(),'inventory_bottle_qr_revoked','inventory_bottle',v_bottle.id::text,
    jsonb_build_object('bottle_code',v_bottle.bottle_code));
  return v_bottle;
end;
$$;
grant execute on function public.inventory_bottle_revoke_qr(uuid) to authenticated,service_role;

-- ---------------------------------------------------------------------
-- 12. Histórico legível (seção 23) e conferência humana em lote (seção 17
--     — inventário por bip é só leitura/auditoria, nunca mexe em estoque).
-- ---------------------------------------------------------------------
create or replace function public.inventory_bottle_conference_history(p_bottle_id uuid)
returns table(conferred_at timestamptz,ml_after numeric,apc_after boolean,conferred_by_name text)
language sql stable security definer set search_path=public
as $$
  select c.conferred_at,c.ml_after,c.apc_after,coalesce(prof.full_name,'—')
  from public.inventory_bottle_conferences c
  left join public.profiles prof on prof.id=c.conferred_by
  where c.bottle_id=p_bottle_id and c.organization_id in(select public.current_user_org_ids())
  order by c.conferred_at desc;
$$;
grant execute on function public.inventory_bottle_conference_history(uuid) to authenticated,service_role;

create or replace function public.inventory_bottles_for_item(p_inventory_item_id uuid)
returns setof public.inventory_bottles
language sql stable security definer set search_path=public
as $$
  select * from public.inventory_bottles
  where inventory_item_id=p_inventory_item_id and organization_id in(select public.current_user_org_ids())
  order by bottle_label;
$$;
grant execute on function public.inventory_bottles_for_item(uuid) to authenticated,service_role;

commit;
