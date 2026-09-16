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
    expect(page).toContain("import {\n  ReplenishmentSignal, ReplenishmentStatus, STATUS_LABEL, buildRadarQuery, fetchReplenishmentSignals,\n  formatReplenishmentSummary, goToRadarForPerfume, goToRadarWithQuery, summarizeReplenishment,\n} from '../lib/replenishment'")
  })
})

describe('ReplenishmentPage: Fase 9 — "Ver oportunidades" usa dados persistidos, nunca busca externa', () => {
  it('goToRadarForPerfume é só navegação (perfume-scoped), nunca searchRadar/fetchBuyingContext direto na página', () => {
    expect(page).toContain('goToRadarForPerfume(signal.perfume_id)')
    expect(page).not.toContain('fetchBuyingContext')
  })
  it('a melhor oferta exibida nunca soma/gera preço — usa direto price_native/price_brl já persistidos na oferta', () => {
    expect(page).toContain('bestOffer.price_native')
    expect(page).toContain('bestOffer.price_brl')
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

describe('Dashboard: Home inteligente consome atenção já calculada no backend', () => {
  it('faz uma única chamada agregada, sem buscar reposição separadamente', () => {
    expect(dashboard).toContain('fetchIntelligentDashboard(period,start,end)')
    expect(dashboard).not.toContain('fetchReplenishmentSignals()')
  })
  it('não dispara busca externa e oferece navegação operacional explícita', () => {
    expect(dashboard).toContain('href="/entregas"')
    expect(dashboard).not.toContain('searchRadar')
  })
  it('renderiza alertas somente a partir do payload centralizado', () => {
    expect(dashboard).toContain('data.alerts.length?')
    expect(dashboard).toContain('ALERTAS CENTRALIZADOS')
  })
})
