// Provider INATIVO/FUTURO — mantido como histórico, não selecionado no runtime atual.
// O Radar Global usa SerperGoogleShoppingProvider hoje (ver serper-provider.ts). Este
// wrapper só existe para preservar a arquitetura de múltiplos providers plugáveis; nada em
// radar-search/index.ts importa este arquivo, então SERPAPI_API_KEY não é necessária.
import type { PerfumeSearchProvider } from './perfume-search-provider.ts'
import { serpApiConfigured, serpApiGoogleShoppingSearch } from './serpapi.ts'

export const SerpApiGoogleShoppingProvider: PerfumeSearchProvider = {
  name: 'serpapi_google_shopping',
  configured: serpApiConfigured,
  search: serpApiGoogleShoppingSearch,
}
