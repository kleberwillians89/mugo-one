-- RADAR GLOBAL: seed de fontes confiaveis + promocao segura de fontes descobertas.
-- Aditiva apenas. NAO edita 202608170001_radar_global_foundation.sql (ja aplicada remotamente).
--
-- radar_sources representa FONTES DE MERCADO (onde a RUAH pode ir comprar: marca oficial,
-- revendedor, distribuidor, marketplace). Isso e conceitualmente diferente de um futuro
-- FORNECEDOR COMERCIAL DIRETO da RUAH (alguem que vende diretamente para a Gabi) — essa
-- distincao fica para uma tabela/dominio futuro e nao e criada aqui.

-- Carrega o conjunto inicial de fontes confiaveis para uma organizacao. Idempotente:
-- pode ser executada varias vezes sem duplicar (chave natural organization_id+domain,
-- ja protegida pelo indice unico parcial radar_sources_org_domain_idx). Atualiza somente
-- campos de classificacao (name/country_code/source_type/priority/trusted/active) —
-- nunca sobrescreve "notes" que o usuario tenha preenchido.
create or replace function public.radar_seed_initial_sources(p_org_id uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare
  v_sources jsonb := '[
    {"name":"Amouage","domain":"amouage.com","country_code":"OM","source_type":"official_brand","priority":100,"trusted":true},
    {"name":"Xerjoff","domain":"xerjoff.com","country_code":"IT","source_type":"official_brand","priority":100,"trusted":true},
    {"name":"Jovoy Paris","domain":"jovoyparis.com","country_code":"FR","source_type":"authorized_retailer","priority":90,"trusted":true},
    {"name":"Harrods","domain":"harrods.com","country_code":"GB","source_type":"retailer","priority":85,"trusted":true},
    {"name":"Luckyscent","domain":"luckyscent.com","country_code":"US","source_type":"retailer","priority":85,"trusted":true},
    {"name":"NOSE Paris","domain":"noseparis.com","country_code":"FR","source_type":"retailer","priority":80,"trusted":true},
    {"name":"50 ml Milano","domain":"50-ml.com","country_code":"IT","source_type":"retailer","priority":80,"trusted":true},
    {"name":"Bloom Perfumery","domain":"bloomperfume.com","country_code":"GB","source_type":"retailer","priority":75,"trusted":true}
  ]'::jsonb;
  item jsonb;
  v_existing_id uuid;
  v_inserted integer := 0;
  v_updated integer := 0;
begin
  if p_org_id is null or not public.has_org_role(p_org_id,array['admin','manager']::public.member_role[]) then
    raise exception 'forbidden';
  end if;

  for item in select * from jsonb_array_elements(v_sources) loop
    select id into v_existing_id from public.radar_sources
      where organization_id=p_org_id and domain=item->>'domain';
    if v_existing_id is null then
      insert into public.radar_sources(organization_id,name,domain,country_code,source_type,priority,trusted,active)
      values(p_org_id,item->>'name',item->>'domain',item->>'country_code',item->>'source_type',
        (item->>'priority')::integer,(item->>'trusted')::boolean,true);
      v_inserted:=v_inserted+1;
    else
      -- Nunca toca em "notes": preserva qualquer observacao que o usuario ja tenha escrito.
      update public.radar_sources set
        name=item->>'name',
        country_code=item->>'country_code',
        source_type=item->>'source_type',
        priority=(item->>'priority')::integer,
        trusted=(item->>'trusted')::boolean,
        active=true,
        updated_at=now()
      where id=v_existing_id;
      v_updated:=v_updated+1;
    end if;
  end loop;

  return jsonb_build_object('inserted',v_inserted,'updated',v_updated,'total',v_inserted+v_updated);
end $$;

revoke all on function public.radar_seed_initial_sources(uuid) from public,anon;
grant execute on function public.radar_seed_initial_sources(uuid) to authenticated,service_role;

-- Promove com seguranca uma fonte descoberta (ex.: vendedor visto numa busca SerpAPI cujo
-- dominio ainda nao existe em radar_sources) para um cadastro classificado. So admin/manager
-- podem chamar, e "trusted" So vira true quando o payload manda explicitamente true —
-- a descoberta automatica NUNCA promove uma fonte sozinha nem marca trusted=true por conta propria.
create or replace function public.radar_promote_source(p_payload jsonb)
returns public.radar_sources language plpgsql security definer set search_path=public as $$
declare
  v_org uuid; v_domain text; v_source_type text; v_trusted boolean; v_row public.radar_sources;
begin
  v_org:=nullif(p_payload->>'organization_id','')::uuid;
  if v_org is null or not public.has_org_role(v_org,array['admin','manager']::public.member_role[]) then
    raise exception 'forbidden';
  end if;
  v_domain:=lower(btrim(coalesce(p_payload->>'domain','')));
  if v_domain='' then raise exception 'domain_required'; end if;
  v_source_type:=coalesce(nullif(p_payload->>'source_type',''),'retailer');
  if v_source_type not in('official_brand','authorized_retailer','retailer','distributor','marketplace') then
    raise exception 'invalid_source_type';
  end if;
  v_trusted:=coalesce((p_payload->>'trusted')::boolean,false);

  insert into public.radar_sources(organization_id,name,domain,country_code,source_type,priority,trusted,notes,active)
  values(
    v_org,
    coalesce(nullif(btrim(p_payload->>'name'),''),v_domain),
    v_domain,
    nullif(upper(btrim(p_payload->>'country_code')),''),
    v_source_type,
    coalesce((p_payload->>'priority')::integer,0),
    v_trusted,
    nullif(btrim(p_payload->>'notes'),''),
    true
  )
  on conflict(organization_id,domain) where domain is not null do update set
    name=coalesce(excluded.name,public.radar_sources.name),
    country_code=coalesce(excluded.country_code,public.radar_sources.country_code),
    source_type=excluded.source_type,
    trusted=excluded.trusted,
    priority=coalesce(excluded.priority,public.radar_sources.priority),
    notes=coalesce(excluded.notes,public.radar_sources.notes),
    active=true,
    updated_at=now()
  returning * into v_row;

  return v_row;
end $$;

revoke all on function public.radar_promote_source(jsonb) from public,anon;
grant execute on function public.radar_promote_source(jsonb) to authenticated,service_role;
