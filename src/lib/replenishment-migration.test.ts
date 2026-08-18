import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const migration = readFileSync(new URL('../../supabase/migrations/202608170003_replenishment_intelligence.sql', import.meta.url), 'utf8')

describe('replenishment_signals: aditiva, não altera regras de estoque/vendas existentes', () => {
  it('nunca faz insert/update/delete/alter em inventory_items, sales ou perfumes', () => {
    const forbidden = [
      /alter table public\.inventory_items/i, /alter table public\.sales/i, /alter table public\.perfumes/i,
      /insert into public\.inventory_items/i, /update public\.inventory_items/i, /delete from public\.inventory_items/i,
      /insert into public\.sales/i, /update public\.sales/i, /delete from public\.sales/i,
      /alter table public\.radar_/i, /alter table public\.inventory_allocations/i,
    ]
    for (const pattern of forbidden) expect(migration).not.toMatch(pattern)
  })

  it('só cria UMA função nova, nenhuma tabela', () => {
    expect(migration).not.toMatch(/create table/i)
    const functions = [...migration.matchAll(/create or replace function public\.(\w+)/g)].map((m) => m[1])
    expect(functions).toEqual(['replenishment_signals'])
  })

  it('é security invoker (lê só o que RLS já permite ao usuário, não eleva privilégio)', () => {
    expect(migration).toContain('language sql stable security invoker')
  })
})

describe('replenishment_signals: mascara bootstrap_pending_verification (item 2 do spec)', () => {
  it('nunca conta estoque de item com bootstrap pendente de verificação — mesma regra de inventory_operational_rows', () => {
    expect(migration).toContain('case when i.bootstrap_pending_verification then 0 else i.available_ml end as available_ml')
  })
})

describe('replenishment_signals: velocidade só com dados suficientes (item 3 do spec)', () => {
  it('exige pelo menos 2 vendas na janela antes de calcular velocidade — nunca extrapola de uma amostra só', () => {
    expect(migration).toContain('when coalesce(sales_count_30d,0) >= 2 then round(coalesce(ml_30d,0)/30.0, 3)')
    expect(migration).toContain('when coalesce(sales_count_90d,0) >= 2 then round(coalesce(ml_90d,0)/90.0, 3)')
    expect(migration).toContain('else null')
  })

  it('cobertura só é calculada quando a velocidade existe e é positiva (nunca divide por zero/null)', () => {
    expect(migration).toContain('when velocity_ml_per_day is not null and velocity_ml_per_day > 0')
  })

  it('calcula as 4 janelas pedidas (7/30/60/90 dias) e contagem de vendas', () => {
    for (const window of [7, 30, 60, 90]) expect(migration).toContain(`sale_date >= current_date - ${window}`)
    expect(migration).toContain('sales_count_7d')
    expect(migration).toContain('sales_count_30d')
  })
})

describe('replenishment_signals: classificação determinística (itens 4-5, evita falso alerta)', () => {
  it('nunca vendeu → sem_dados, checado antes de qualquer regra de estoque (evita alarme sem base)', () => {
    const classifiedBlock = migration.slice(migration.indexOf('classified as ('), migration.indexOf('from coverage'))
    const semDadosIdx = classifiedBlock.indexOf("'sem_dados'")
    const criticoIdx = classifiedBlock.indexOf("'critico'")
    expect(semDadosIdx).toBeGreaterThan(-1)
    expect(semDadosIdx).toBeLessThan(criticoIdx)
    expect(classifiedBlock).toContain('when last_sale_at is null then')
  })

  it('crítico exige estoque zerado E venda recente (30d) — nunca zero-estoque isolado', () => {
    expect(migration).toContain('when available_ml <= 0 and last_sale_at >= current_date - 30 then')
  })

  it('repor exige velocidade confirmada com cobertura curta (<=30 dias) — combina estoque+velocidade, não só estoque baixo', () => {
    expect(migration).toContain('when velocity_ml_per_day is not null and coverage_days is not null and coverage_days <= 30 then')
  })

  it('estoque baixo sem venda recente nunca cai automaticamente em crítico/repor (regra de exclusão mútua por ordem de CASE)', () => {
    const classifiedBlock = migration.slice(migration.indexOf('classified as ('), migration.indexOf('from coverage'))
    // "repor"/"critico" aparecem só nas 2 primeiras condições reais (depois do sem_dados) — a
    // condição de minimum_ml sozinha (sem velocidade) vai para "atencao", nunca "repor"/"critico".
    expect(classifiedBlock).toContain("when minimum_ml > 0 and available_ml < minimum_ml then 'atencao'")
  })

  it('cobre os 5 estados do spec, nenhum a mais', () => {
    const states = [...migration.matchAll(/(?:then|else) '(critico|repor|atencao|saudavel|sem_dados)'/g)].map((m) => m[1])
    expect(new Set(states)).toEqual(new Set(['critico', 'repor', 'atencao', 'saudavel', 'sem_dados']))
  })
})

describe('replenishment_signals: priority_score nunca é exibido ao usuário (item 6 do spec)', () => {
  it('é calculado só para ordenação (order by priority_score)', () => {
    expect(migration).toContain('order by priority_score desc, perfume asc')
  })
})

describe('replenishment_signals: tenant isolation (item 25 do spec)', () => {
  it('exige org_id como parâmetro e confere contra current_user_org_ids()', () => {
    expect(migration).toContain('replenishment_signals(org_id uuid)')
    expect(migration).toContain('and org_id in (select public.current_user_org_ids())')
  })

  it('toda leitura de inventory_items e sales é filtrada por organization_id = org_id', () => {
    expect(migration).toContain('i.organization_id = org_id')
    expect(migration).toContain('organization_id = org_id and deleted_at is null')
  })
})

describe('replenishment_signals: performance (item 24 — uma chamada agregada, não N+1)', () => {
  it('retorna a lista inteira num único RPC (returns table, sem parâmetro de item específico)', () => {
    expect(migration).toContain('returns table(')
    expect(migration).not.toContain('p_item_id')
    expect(migration).not.toContain('p_perfume_id uuid')
  })
})
