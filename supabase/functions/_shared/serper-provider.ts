// Provider ATIVO do Radar Global nesta fase.
import type { PerfumeSearchProvider } from './perfume-search-provider.ts'
import { serperConfigured, serperGoogleShoppingSearch } from './serper.ts'

export const SerperGoogleShoppingProvider: PerfumeSearchProvider = {
  name: 'serper_google_shopping',
  configured: serperConfigured,
  search: serperGoogleShoppingSearch,
}
