// RADAR GLOBAL - VIAGENS: abstração de provider (arquitetura apenas, fase futura).
// Nenhuma implementação real chama o SerpApi ainda. Quando essa fase for construída, a chave
// SERPAPI_API_KEY sera lida somente por uma Edge Function nova (ex.: radar-travel-search,
// nos moldes de supabase/functions/radar-search) — nunca por este arquivo nem pelo client.
import type { FlightOffer, FlightSearchParams, HotelOffer, HotelSearchParams, TravelSearchResult } from './radar-travel-types'

export interface TravelSearchProvider {
  searchFlights(params:FlightSearchParams): Promise<TravelSearchResult<FlightOffer>>
  searchHotels(params:HotelSearchParams): Promise<TravelSearchResult<HotelOffer>>
}

// Implementação padrão até a Fase Viagens ser construída: não faz nenhuma chamada de rede,
// nao consome quota, apenas sinaliza indisponibilidade — mesmo comportamento do
// radar-search hoje quando nenhum provider de perfumes está configurado.
export const notConfiguredTravelProvider: TravelSearchProvider = {
  async searchFlights() {
    return { available: false, message: 'Busca de voos ainda não configurada.', offers: [] }
  },
  async searchHotels() {
    return { available: false, message: 'Busca de hotéis ainda não configurada.', offers: [] }
  },
}
