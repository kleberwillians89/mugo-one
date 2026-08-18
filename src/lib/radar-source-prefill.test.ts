import { describe, expect, it } from 'vitest'
import {
  domainFromMerchantUrl, findExistingSourceByDomain, looksLikeOfficialBrand, normalizeDomain,
  prefillFromShoppingResult, suggestSourceType,
} from './radar-source-prefill'
import type { RadarSource } from './radar'

describe('normalizeDomain: aceita variações, rejeita o que não é um domínio de fonte válido', () => {
  it('aceita domínio puro', () => expect(normalizeDomain('harrods.com')).toBe('harrods.com'))
  it('remove www.', () => expect(normalizeDomain('www.harrods.com')).toBe('harrods.com'))
  it('extrai de uma URL completa', () => expect(normalizeDomain('https://www.harrods.com/en-gb/product/x')).toBe('harrods.com'))
  it('extrai de URL sem www', () => expect(normalizeDomain('https://harrods.com/en-gb/product/x')).toBe('harrods.com'))
  it('rejeita google.com', () => expect(normalizeDomain('google.com')).toBeNull())
  it('rejeita google.co.uk', () => expect(normalizeDomain('google.co.uk')).toBeNull())
  it('rejeita uma URL de busca do Google', () => expect(normalizeDomain('https://www.google.com/search?ibp=oshop')).toBeNull())
  it('rejeita localhost', () => expect(normalizeDomain('localhost')).toBeNull())
  it('rejeita IP local', () => expect(normalizeDomain('http://127.0.0.1:3000')).toBeNull())
  it('rejeita string sem domínio válido', () => expect(normalizeDomain('não é um domínio')).toBeNull())
  it('rejeita vazio/nulo', () => {
    expect(normalizeDomain('')).toBeNull()
    expect(normalizeDomain(null)).toBeNull()
    expect(normalizeDomain(undefined)).toBeNull()
  })
})

describe('domainFromMerchantUrl: item 3 do spec', () => {
  it('https://www.harrods.com/en-gb/... → harrods.com', () => {
    expect(domainFromMerchantUrl('https://www.harrods.com/en-gb/product/guidance-46')).toBe('harrods.com')
  })
  it('merchant_url ausente → domínio vazio (item 4 do spec)', () => {
    expect(domainFromMerchantUrl(null)).toBeNull()
  })
  it('URL do Google Shopping nunca vira domain, mesmo passada como merchant_url por engano', () => {
    expect(domainFromMerchantUrl('https://www.google.com/search?ibp=oshop&q=x')).toBeNull()
  })
})

describe('suggestSourceType: marketplace é determinístico (item 6 do spec)', () => {
  it('eBay pelo nome → marketplace', () => expect(suggestSourceType('eBay', null)).toBe('marketplace'))
  it('Amazon pelo domínio → marketplace', () => expect(suggestSourceType(null, 'amazon.co.uk')).toBe('marketplace'))
  it('revendedor não-marketplace não é sugerido como marketplace', () => expect(suggestSourceType('Harrods', 'harrods.com')).toBeNull())
})

describe('looksLikeOfficialBrand: só sinaliza, nunca decide sozinho', () => {
  it('seller_name igual à marca → hint true', () => expect(looksLikeOfficialBrand('Amouage', 'amouage.com', 'Amouage')).toBe(true))
  it('domínio raiz igual à marca → hint true', () => expect(looksLikeOfficialBrand(null, 'amouage.com', 'Amouage')).toBe(true))
  it('vendedor claramente diferente da marca → hint false', () => expect(looksLikeOfficialBrand('Harrods', 'harrods.com', 'Amouage')).toBe(false))
})

describe('prefillFromShoppingResult: item 1-2 do spec (pré-preenchimento seguro)', () => {
  it('seller_name preenche o nome, nunca é substituído pelo domínio quando presente', () => {
    const prefill = prefillFromShoppingResult({ seller_name: 'Santa Eulalia', merchant_url: 'https://www.santaeulalia.com.br/x' }, 'Amouage')
    expect(prefill.name).toBe('Santa Eulalia')
    expect(prefill.nameInferred).toBe(false)
  })

  it('sem seller_name, usa o domínio limpo como fallback e marca nameInferred:true', () => {
    const prefill = prefillFromShoppingResult({ seller_name: null, merchant_url: 'https://www.harrods.com/x' }, 'Amouage')
    expect(prefill.name).toBe('harrods.com')
    expect(prefill.nameInferred).toBe(true)
  })

  it('merchant_url ausente → domínio null no prefill (nunca inventado)', () => {
    const prefill = prefillFromShoppingResult({ seller_name: 'Loja X', merchant_url: null }, 'Amouage')
    expect(prefill.domain).toBeNull()
  })

  it('marketplace conhecido (eBay) → sourceType pré-selecionado marketplace', () => {
    const prefill = prefillFromShoppingResult({ seller_name: 'eBay', merchant_url: 'https://www.ebay.co.uk/itm/1' }, 'Amouage')
    expect(prefill.sourceType).toBe('marketplace')
  })

  it('sem indicação de marketplace, o padrão é retailer — nunca official_brand automático', () => {
    const prefill = prefillFromShoppingResult({ seller_name: 'Amouage', merchant_url: 'https://www.amouage.com/x' }, 'Amouage')
    expect(prefill.sourceType).toBe('retailer')
    expect(prefill.officialHint).toBe(true)
  })
})

describe('findExistingSourceByDomain: item 8 do spec (zero duplicata)', () => {
  const sources: RadarSource[] = [{
    id: '1', organization_id: 'org', name: 'Harrods', domain: 'harrods.com', country_code: 'GB',
    source_type: 'retailer', priority: 0, trusted: true, active: true, notes: null,
    created_at: '', updated_at: '',
  }]

  it('encontra a fonte existente pelo domínio normalizado', () => {
    expect(findExistingSourceByDomain('harrods.com', sources)?.name).toBe('Harrods')
  })

  it('domínio com www continua batendo (normalização nos dois lados)', () => {
    expect(findExistingSourceByDomain(normalizeDomain('www.harrods.com'), sources)?.name).toBe('Harrods')
  })

  it('domínio diferente não bate com nada — sem falso positivo', () => {
    expect(findExistingSourceByDomain('luckyscent.com', sources)).toBeNull()
  })

  it('sem domínio (null), nunca "encontra" nada por acidente', () => {
    expect(findExistingSourceByDomain(null, sources)).toBeNull()
  })
})
