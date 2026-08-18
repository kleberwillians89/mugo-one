import type { RadarSource, RadarSourceType, ShoppingSearchResult } from './radar'

// RADAR GLOBAL - pré-preenchimento seguro do modal "Validar fonte".
// Só preenche o que dá pra determinar com segurança a partir do resultado de busca. Nunca
// inventa domínio, país ou tipo — cada campo tem uma justificativa explícita neste arquivo.

function safeHostname(url: string | null): string | null {
  if (!url) return null
  try { return new URL(url).hostname.toLowerCase() } catch { return null }
}

function isGoogleHost(hostname: string): boolean {
  return hostname === 'google.com' || hostname.endsWith('.google.com') || /(^|\.)google\.[a-z.]+$/.test(hostname)
}

function isLocalOrIpHost(hostname: string): boolean {
  if (hostname === 'localhost') return true
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(hostname)) return true
  if (hostname.includes(':')) return true // literal IPv6
  return false
}

function stripWww(hostname: string): string {
  return hostname.startsWith('www.') ? hostname.slice(4) : hostname
}

// Aceita "harrods.com", "www.harrods.com" ou uma URL completa e normaliza sempre para
// "harrods.com". Rejeita Google (nunca é "o domínio da fonte"), localhost, IP e qualquer
// texto que não vire um domínio válido.
export function normalizeDomain(input: string | null | undefined): string | null {
  const value = (input ?? '').trim()
  if (!value) return null
  const hostname = safeHostname(/^https?:\/\//i.test(value) ? value : `https://${value}`)
  if (!hostname) return null
  const stripped = stripWww(hostname)
  if (isGoogleHost(stripped)) return null
  if (isLocalOrIpHost(stripped)) return null
  if (!stripped.includes('.')) return null
  return stripped
}

// Só extrai domínio de uma URL que já sabemos ser do vendedor (merchant_url) — nunca do
// source_url genérico, que pode ser só a página do Google Shopping (item 4 do spec).
export function domainFromMerchantUrl(merchantUrl: string | null): string | null {
  return normalizeDomain(merchantUrl)
}

const KNOWN_MARKETPLACES = ['ebay', 'amazon', 'etsy', 'walmart', 'aliexpress', 'alibaba', 'wish', 'rakuten', 'mercadolivre', 'temu', 'shopee']

// Determinístico, não uma "IA adivinhando": só marca marketplace quando o nome ou o domínio
// batem literalmente com um marketplace conhecido.
export function suggestSourceType(sellerName: string | null, domain: string | null): 'marketplace' | null {
  const seller = (sellerName ?? '').toLowerCase()
  const host = (domain ?? '').toLowerCase()
  return KNOWN_MARKETPLACES.some((marketplace) => seller.includes(marketplace) || host.includes(marketplace)) ? 'marketplace' : null
}

// Sinal puramente visual para o humano revisar — NUNCA seleciona "official_brand" sozinho.
export function looksLikeOfficialBrand(sellerName: string | null, domain: string | null, brand: string): boolean {
  const normalizedBrand = brand.trim().toLowerCase()
  if (!normalizedBrand) return false
  const seller = (sellerName ?? '').trim().toLowerCase()
  const domainRoot = (domain ?? '').split('.')[0]?.toLowerCase() ?? ''
  return seller === normalizedBrand || domainRoot === normalizedBrand.replace(/\s+/g, '')
}

export type SourcePrefill = {
  name: string
  nameInferred: boolean
  domain: string | null
  sourceType: Exclude<RadarSourceType, 'manual'>
  officialHint: boolean
}

// name: prioridade total para seller_name. Só cai para o domínio limpo quando seller_name
// está ausente — e mesmo assim marca nameInferred:true, para a UI deixar claro que foi
// inferência, nunca dado confirmado pelo provider (item 2 do spec).
//
// country: NÃO preenchido aqui. O Serper não devolve país por item de shopping, e o spec
// proíbe explicitamente inferir país pelo TLD sem regra segura — então o campo fica vazio
// até existir uma fonte de dado estruturada (provider ou fonte já cadastrada, ver
// findExistingSourceByDomain para esse segundo caso).
export function prefillFromShoppingResult(item: Pick<ShoppingSearchResult, 'seller_name' | 'merchant_url'>, brand: string): SourcePrefill {
  const domain = domainFromMerchantUrl(item.merchant_url)
  const nameInferred = !item.seller_name && Boolean(domain)
  const marketplaceType = suggestSourceType(item.seller_name, domain)
  return {
    name: item.seller_name ?? domain ?? '',
    nameInferred,
    domain,
    sourceType: marketplaceType ?? 'retailer',
    officialHint: looksLikeOfficialBrand(item.seller_name, domain, brand),
  }
}

// Checagem de duplicata ANTES de promover (item 8 do spec) — organization_id já é implícito
// porque `sources` só contém fontes da organização autenticada (RLS). Compara por domínio
// normalizado, a mesma chave natural que radar_promote_source usa no banco.
export function findExistingSourceByDomain(domain: string | null, sources: RadarSource[]): RadarSource | null {
  if (!domain) return null
  return sources.find((source) => normalizeDomain(source.domain) === domain) ?? null
}
