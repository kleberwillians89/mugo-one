// RADAR GLOBAL - abstração de provider de busca externa.
//
// PerfumeSearchProvider
//   ├── SerperGoogleShoppingProvider (ativo — supabase/functions/_shared/serper-provider.ts)
//   └── SerpApiGoogleShoppingProvider (inativo/futuro — supabase/functions/_shared/serpapi-provider.ts)
//
// Somente UM provider é selecionado no runtime (hoje: Serper). O código do provider anterior
// (SerpAPI) permanece no repositório como histórico/futuro, mas nada mais o importa em runtime.
export interface PerfumeSearchProvider {
  readonly name: string
  configured(): boolean
  // Retorna o JSON bruto do provider — a normalização para o modelo interno do Radar
  // acontece fora do provider (nos módulos *-domain.ts de cada provider), mantendo a
  // interface simples e o parsing testável isoladamente por provider.
  search(query: string, market: { gl: string; hl: string }): Promise<unknown>
}
