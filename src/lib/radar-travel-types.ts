// RADAR GLOBAL - VIAGENS (fase futura, somente arquitetura).
// Reaproveita a mesma chave server-side SERPAPI_API_KEY que sera usada futuramente por uma
// Edge Function (nunca pelo client) para os engines do SerpApi abaixo. Nenhuma chamada externa
// e feita a partir deste arquivo — apenas tipos.

export type SerpApiEngine = 'google_flights'|'google_hotels'

export type FlightClass = 'economy'|'premium_economy'|'business'|'first'

export type FlightSearchParams = {
  origin:string
  destination:string
  departure_date:string
  return_date?:string|null
  adults:number
  travel_class:FlightClass
  currency:string
}

export type HotelSearchParams = {
  destination:string
  check_in:string
  check_out:string
  guests:number
  currency:string
}

export type FlightOffer = {
  id:string
  airline:string|null
  origin:string
  destination:string
  departure_date:string
  return_date:string|null
  price_native:number
  currency:string
  stops:number|null
  duration_minutes:number|null
  url:string|null
  source:'google_flights'
  retrieved_at:string
}

export type HotelOffer = {
  id:string
  name:string
  destination:string
  check_in:string
  check_out:string
  price_native:number
  currency:string
  rating:number|null
  url:string|null
  source:'google_hotels'
  retrieved_at:string
}

// Resultados são somente leitura: nenhuma compra/reserva automática nesta camada.
export type TravelSearchResult<T> = { available:boolean; message?:string; offers:T[] }
