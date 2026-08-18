import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { formatSeedResult } from './radar'

const migration = readFileSync(new URL('../../supabase/migrations/202608170002_radar_initial_sources.sql', import.meta.url), 'utf8')
const foundationMigration = readFileSync(new URL('../../supabase/migrations/202608170001_radar_global_foundation.sql', import.meta.url), 'utf8')

describe('202608170002: não edita a migration 001 já aplicada remotamente', () => {
  it('a migration 001 permanece com seu conteúdo original de fundação (não foi tocada)', () => {
    expect(foundationMigration).toContain('create table public.radar_sources')
    expect(foundationMigration).not.toContain('radar_seed_initial_sources')
    expect(foundationMigration).not.toContain('radar_promote_source')
  })
})

describe('radar_seed_initial_sources: papéis', () => {
  it('admin e manager podem executar; operator e viewer não', () => {
    expect(migration).toContain("array['admin','manager']::public.member_role[]")
    expect(migration).not.toContain("array['admin','manager','operator']")
  })

  it('não hardcoda organization_id — recebe como parâmetro', () => {
    expect(migration).toContain('radar_seed_initial_sources(p_org_id uuid)')
    expect(migration).not.toMatch(/p_org_id\s*:?=\s*'[0-9a-f-]{36}'/i)
  })

  it('security definer com search_path fixo, como o restante do módulo', () => {
    const fn = migration.slice(migration.indexOf('function public.radar_seed_initial_sources'), migration.indexOf('function public.radar_promote_source'))
    expect(fn).toContain('security definer set search_path=public')
  })
})

describe('radar_seed_initial_sources: as 8 fontes iniciais', () => {
  const expectedDomains = [
    'amouage.com', 'xerjoff.com', 'jovoyparis.com', 'harrods.com',
    'luckyscent.com', 'noseparis.com', '50-ml.com', 'bloomperfume.com',
  ]
  it.each(expectedDomains)('inclui o domínio %s', (domain) => {
    expect(migration).toContain(`"domain":"${domain}"`)
  })

  it('marca oficial só para Amouage e Xerjoff, com prioridade máxima', () => {
    expect(migration).toContain('"name":"Amouage","domain":"amouage.com","country_code":"OM","source_type":"official_brand","priority":100,"trusted":true')
    expect(migration).toContain('"name":"Xerjoff","domain":"xerjoff.com","country_code":"IT","source_type":"official_brand","priority":100,"trusted":true')
  })

  it('todas as 8 fontes iniciais vêm marcadas trusted:true (curadoria manual, não descoberta automática)', () => {
    const matches = migration.match(/"trusted":true/g) ?? []
    expect(matches.length).toBeGreaterThanOrEqual(8)
  })
})

describe('radar_seed_initial_sources: idempotência', () => {
  it('confere se a fonte já existe antes de decidir inserir ou atualizar (nunca insert cego)', () => {
    expect(migration).toContain('select id into v_existing_id from public.radar_sources')
    expect(migration).toContain('if v_existing_id is null then')
  })

  it('conta inseridos e atualizados separadamente, retornando total determinístico', () => {
    expect(migration).toContain("jsonb_build_object('inserted',v_inserted,'updated',v_updated,'total',v_inserted+v_updated)")
  })

  it('nunca sobrescreve "notes" ao atualizar uma fonte existente', () => {
    const updateBlock = migration.slice(migration.indexOf('update public.radar_sources set', migration.indexOf('radar_seed_initial_sources')), migration.indexOf('where id=v_existing_id'))
    expect(updateBlock).not.toMatch(/\bnotes\s*=/)
  })

  it('usa a chave natural organization_id+domain já protegida pelo índice único existente', () => {
    expect(migration).toContain('where organization_id=p_org_id and domain=')
  })
})

describe('formatSeedResult: mensagem determinística', () => {
  it('primeira execução (8 inseridas) → "8 fontes disponíveis no Radar."', () => {
    expect(formatSeedResult({ inserted: 8, updated: 0, total: 8 })).toBe('8 fontes disponíveis no Radar.')
  })

  it('segunda execução (zero inseridas, 8 atualizadas) → "Fontes iniciais já configuradas."', () => {
    expect(formatSeedResult({ inserted: 0, updated: 8, total: 8 })).toBe('Fontes iniciais já configuradas.')
  })

  it('execução parcial (algumas novas, outras já existentes) ainda reporta o total', () => {
    expect(formatSeedResult({ inserted: 3, updated: 5, total: 8 })).toBe('8 fontes disponíveis no Radar.')
  })
})

describe('radar_promote_source: fonte descoberta nunca é promovida automaticamente', () => {
  it('exige admin/manager, igual ao seed', () => {
    const fn = migration.slice(migration.indexOf('function public.radar_promote_source'))
    expect(fn).toContain("array['admin','manager']::public.member_role[]")
  })

  it('trusted default é false — só vira true se o payload mandar explicitamente', () => {
    expect(migration).toContain("v_trusted:=coalesce((p_payload->>'trusted')::boolean,false)")
  })

  it('domínio é obrigatório para promover uma fonte', () => {
    expect(migration).toContain("if v_domain='' then raise exception 'domain_required'; end if;")
  })

  it('rejeita tipos de fonte inválidos (não aceita "manual" na promoção)', () => {
    expect(migration).toContain("if v_source_type not in('official_brand','authorized_retailer','retailer','distributor','marketplace') then")
  })

  it('upsert por organization_id+domain preserva notes existentes também aqui', () => {
    expect(migration).toContain('on conflict(organization_id,domain) where domain is not null do update set')
    expect(migration).toContain("notes=coalesce(excluded.notes,public.radar_sources.notes)")
  })
})

describe('202608170002: isolamento de tenant e do core operacional', () => {
  it('toda leitura/escrita de fontes é filtrada por organization_id do parâmetro, nunca global', () => {
    expect(migration).not.toMatch(/from public\.radar_sources(?!\s*\n?\s*where organization_id)/m)
  })

  it('não toca em vendas, estoque, entregas, SuperFrete, importação IA, radar_offers ou Radar Travel', () => {
    const forbidden = [
      /alter table public\.sales/i, /alter table public\.inventory_allocations/i, /alter table public\.shipments/i,
      /alter table public\.import_batches/i, /alter table public\.radar_offers/i, /radar_travel/i,
    ]
    for (const pattern of forbidden) expect(migration).not.toMatch(pattern)
  })
})
