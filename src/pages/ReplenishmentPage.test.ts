import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const page = readFileSync(new URL('./ReplenishmentPage.tsx', import.meta.url), 'utf8')
const inventoryPage = readFileSync(new URL('./InventoryPage.tsx', import.meta.url), 'utf8')
const dashboard = readFileSync(new URL('./Dashboard.tsx', import.meta.url), 'utf8')

describe('ReplenishmentPage: zero escrita em estoque/vendas (item 22-23 do spec)', () => {
  it('nunca importa nem chama funções de ajuste de estoque', () => {
    expect(page).not.toContain('adjustInventory')
    expect(page).not.toContain('createInventoryItem')
  })

  it('nunca importa funções de escrita em vendas', () => {
    expect(page).not.toMatch(/import.*sale/i)
  })
})

describe('ReplenishmentPage: busca no Radar é sempre navegação, nunca busca automática (itens 11-12)', () => {
  it('"Buscar reposição" e "Acompanhar no Radar" só chamam goToRadarWithQuery, nunca searchRadar', () => {
    expect(page).not.toContain('searchRadar')
    expect(page).toContain('goToRadarWithQuery(buildRadarQuery(signal))')
  })

  it('a navegação usa a mesma query construída da identidade canônica, pronta para o usuário só clicar buscar', () => {
    expect(page).toContain("import {\n  ReplenishmentSignal, ReplenishmentStatus, STATUS_LABEL, buildRadarQuery, fetchReplenishmentSignals,\n  formatReplenishmentSummary, goToRadarWithQuery, summarizeReplenishment,\n} from '../lib/replenishment'")
  })
})

describe('ReplenishmentPage: uma chamada agregada, nunca N+1 por perfume (item 24)', () => {
  it('busca sinais, watchlist e ofertas em paralelo — 3 chamadas totais, não uma por card', () => {
    expect(page).toContain('Promise.all([fetchReplenishmentSignals(), fetchWatchlist(), fetchOffersForPerfume({})])')
  })

  it('cruza watchlist/ofertas por perfume_id em memória (Map), sem requisição adicional por card', () => {
    expect(page).toContain('new Map<string, RadarWatchItem>()')
    expect(page).toContain('new Map<string, RadarOffer[]>()')
  })
})

describe('ReplenishmentPage: conecta ao Radar sem duplicar ação humana (itens 16-18)', () => {
  it('mostra "JÁ MONITORADO" quando existe item de watchlist para o perfume', () => {
    expect(page).toContain('JÁ MONITORADO')
  })
  it('mostra contagem de oportunidades salvas e fontes confiáveis quando existem radar_offers', () => {
    expect(page).toContain('oportunidade')
    expect(page).toContain('de fonte${trustedOffers.length === 1')
    expect(page).toContain('confiável)')
  })
  it('mostra a atualização relativa (freshness) da oferta mais recente, nunca como se fosse dado atual sem indicação', () => {
    expect(page).toContain('atualizado ${timeAgo(mostRecentCheck)}')
    expect(page).toContain('function timeAgo')
  })
})

describe('InventoryPage: badge de reposição não altera o botão/ação de estoque existente', () => {
  it('continua com o botão "Buscar reposição" original (pushState, sem adjustInventory)', () => {
    const buttonLine = inventoryPage.split('\n').find((line) => line.includes('Buscar reposição'))
    expect(buttonLine).toContain('pushState')
    expect(buttonLine).not.toContain('adjustInventory')
  })

  it('a nova coluna "Reposição" só lê os sinais já calculados (Map), nunca escreve', () => {
    expect(inventoryPage).toContain('replenishmentByItem.get(balance.item_id)')
    expect(inventoryPage).not.toContain('replenishmentByItem.set')
  })

  it('falha ao buscar sinais de reposição nunca derruba a página de estoque (fallback silencioso)', () => {
    expect(inventoryPage).toContain('fetchReplenishmentSignals().catch(()=>[])')
  })
})

describe('Dashboard: seção "O que precisa da sua atenção" usa só sinais determinísticos', () => {
  it('conta reposição/atenção a partir de replenishment_signals, sem hardcode', () => {
    expect(dashboard).toContain('fetchReplenishmentSignals()')
    expect(dashboard).toContain("signals.filter((signal)=>signal.status==='critico'||signal.status==='repor')")
  })
  it('o botão "Ver reposições" navega para /estoque/reposicao, nunca dispara busca', () => {
    expect(dashboard).toContain('goToReplenishment')
    expect(dashboard).not.toContain('searchRadar')
  })
  it('não polui o dashboard: a seção só aparece quando há algo para mostrar', () => {
    expect(dashboard).toContain('{(stockAlerts.repor > 0 || stockAlerts.atencao > 0) &&')
  })
})
