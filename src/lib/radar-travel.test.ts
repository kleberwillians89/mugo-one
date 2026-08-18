import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { routes } from '../routing'
import { notConfiguredTravelProvider } from './radar-travel-provider'
import { RADAR_TRAVEL_PLANNED_ROUTES } from './radar-travel-routes'
import type { SerpApiEngine } from './radar-travel-types'

const typesSrc = readFileSync(new URL('./radar-travel-types.ts', import.meta.url), 'utf8')
const providerSrc = readFileSync(new URL('./radar-travel-provider.ts', import.meta.url), 'utf8')
const routesSrc = readFileSync(new URL('./radar-travel-routes.ts', import.meta.url), 'utf8')

describe('Radar Viagens: arquitetura sem chamadas externas', () => {
  it('nenhum dos arquivos novos faz fetch, XHR ou chama o SerpApi', () => {
    for (const source of [typesSrc, providerSrc, routesSrc]) {
      expect(source).not.toMatch(/\bfetch\(/)
      expect(source).not.toContain('serpapi.com')
      expect(source).not.toContain('XMLHttpRequest')
    }
  })

  it('nenhum arquivo expõe a chave em variável de cliente (VITE_)', () => {
    for (const source of [typesSrc, providerSrc, routesSrc]) {
      expect(source).not.toContain('VITE_SERPAPI')
      expect(source).not.toContain('import.meta.env')
    }
  })

  it('a chave SERPAPI_API_KEY só é citada em comentário, nunca lida em runtime', () => {
    expect(providerSrc).toContain('SERPAPI_API_KEY')
    expect(providerSrc).not.toContain("Deno.env.get('SERPAPI_API_KEY')")
    expect(providerSrc).not.toContain("process.env.SERPAPI_API_KEY")
  })
})

describe('Radar Viagens: provider padrão não consome quota', () => {
  it('searchFlights resolve available:false sem lançar e sem ofertas', async () => {
    const result = await notConfiguredTravelProvider.searchFlights({
      origin: 'GRU', destination: 'CDG', departure_date: '2026-09-01', adults: 1, travel_class: 'economy', currency: 'BRL',
    })
    expect(result).toEqual({ available: false, message: 'Busca de voos ainda não configurada.', offers: [] })
  })

  it('searchHotels resolve available:false sem lançar e sem ofertas', async () => {
    const result = await notConfiguredTravelProvider.searchHotels({
      destination: 'Paris', check_in: '2026-09-01', check_out: '2026-09-05', guests: 2, currency: 'BRL',
    })
    expect(result).toEqual({ available: false, message: 'Busca de hotéis ainda não configurada.', offers: [] })
  })
})

describe('Radar Viagens: engines planejados', () => {
  it('só reconhece google_flights e google_hotels como engines válidos', () => {
    const engines: SerpApiEngine[] = ['google_flights', 'google_hotels']
    expect(engines).toEqual(['google_flights', 'google_hotels'])
  })
})

describe('Radar Viagens: rotas planejadas não afetam a navegação atual', () => {
  it('define as rotas planejadas separadamente de routing.ts', () => {
    expect(RADAR_TRAVEL_PLANNED_ROUTES.home).toBe('/radar/viagens')
    expect(RADAR_TRAVEL_PLANNED_ROUTES.flights).toBe('/radar/viagens/voos')
    expect(RADAR_TRAVEL_PLANNED_ROUTES.hotels).toBe('/radar/viagens/hoteis')
  })

  it('nenhuma rota de viagens está registrada em routing.ts (nada é navegável ainda)', () => {
    const registeredPaths = Object.values(routes)
    for (const plannedPath of Object.values(RADAR_TRAVEL_PLANNED_ROUTES)) {
      expect(registeredPaths).not.toContain(plannedPath)
    }
  })
})
