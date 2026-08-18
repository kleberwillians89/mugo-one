import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const radarPage = readFileSync(new URL('./RadarPage.tsx', import.meta.url), 'utf8')

describe('RadarPage: fonte desconhecida em resultados de busca', () => {
  it('compara pelo nome do vendedor contra as fontes já cadastradas', () => {
    const fn = radarPage.slice(radarPage.indexOf('function matchSource'), radarPage.indexOf('function sourceBadge'))
    expect(fn).toContain('sources.find(')
    expect(fn).toContain('.name.trim().toLowerCase()')
  })

  it('sem nome de vendedor, não afirma nada — nunca chuta um match sem dado', () => {
    const fn = radarPage.slice(radarPage.indexOf('function matchSource'), radarPage.indexOf('function sourceBadge'))
    expect(fn).toContain('if (!sellerName) return null')
  })

  it('marketplace classificado pelo backend nunca vira "nova fonte" nem herda confiança', () => {
    const fn = radarPage.slice(radarPage.indexOf('function sourceBadge'), radarPage.indexOf('const RELEVANCE_SECTION_LABEL'))
    expect(fn).toContain("item.source_type === 'marketplace'")
    expect(fn).toContain("label: 'MARKETPLACE', tone: 'neutral'")
  })

  it('badge "NOVA FONTE" aparece quando a fonte não é conhecida nem marketplace', () => {
    expect(radarPage).toContain("return { label: 'NOVA FONTE', tone: 'warning' }")
    expect(radarPage).toContain('Ainda não validada pela RUAH.')
  })

  it('botão "Validar fonte" só aparece para fontes não validadas e para quem pode gerenciar fontes', () => {
    expect(radarPage).toContain('{unvalidated && canManageSources && <SecondaryButton onClick={onValidate}>Validar fonte</SecondaryButton>}')
  })
})

describe('RadarPage: link da oferta (merchant vs Google fallback)', () => {
  it('prioriza merchant_url; só usa source_url do Google como fallback', () => {
    const fn = radarPage.slice(radarPage.indexOf('function RadarSearchResultCard'), radarPage.indexOf('function RadarPromoteSourceModal'))
    expect(fn).toContain('const openUrl = item.merchant_url ?? item.source_url')
  })

  it('rotula "Abrir loja" só quando há merchant_url; senão "Ver no Google Shopping"', () => {
    const fn = radarPage.slice(radarPage.indexOf('function RadarSearchResultCard'), radarPage.indexOf('function RadarPromoteSourceModal'))
    expect(fn).toContain("hasMerchantLink ? 'Abrir loja' : 'Ver no Google Shopping'")
    expect(fn).not.toContain("'Abrir'")
  })

  it('nunca chama um link do Google de "oferta"', () => {
    const fn = radarPage.slice(radarPage.indexOf('function RadarSearchResultCard'), radarPage.indexOf('function RadarPromoteSourceModal'))
    expect(fn).not.toContain('VER OFERTA')
  })
})

describe('RadarPage: agrupamento por relevância e contador', () => {
  it('separa oportunidades relevantes (exact/likely) de resultados secundários (weak) e descartados (excluded)', () => {
    const fn = radarPage.slice(radarPage.indexOf('function RadarSearchResults'), radarPage.indexOf('function RadarSearchResultCard'))
    expect(fn).toContain("item.relevance === 'exact' || item.relevance === 'likely'")
    expect(fn).toContain("results.filter((item) => item.relevance === 'weak')")
    expect(fn).toContain("results.filter((item) => item.relevance === 'excluded')")
  })

  it('o contador nunca mostra só o total bruto — sempre total, relevantes e secundários/descartados', () => {
    const fn = radarPage.slice(radarPage.indexOf('function RadarSearchResults'), radarPage.indexOf('function RadarSearchResultCard'))
    expect(fn).toContain('resultados encontrados')
    expect(fn).toContain('oportunidades relevantes')
    expect(fn).toContain('resultados secundários/descartados')
  })

  it('KPIs do topo do Radar usam ofertas da watchlist (banco), não o result_count bruto da busca', () => {
    const metricsBlock = radarPage.slice(radarPage.indexOf('const metrics = useMemo'), radarPage.indexOf('async function handleSearch'))
    expect(metricsBlock).not.toContain('searchResult')
    expect(metricsBlock).not.toContain('result_count')
  })
})

describe('RadarPage: preço fora da faixa nunca é tratado como fraude', () => {
  it('mostra o rótulo neutro "PREÇO FORA DA FAIXA", nunca acusa falsificação', () => {
    const fn = radarPage.slice(radarPage.indexOf('function RadarSearchResultCard'), radarPage.indexOf('function RadarPromoteSourceModal'))
    expect(fn).toContain("item.price_flag === 'outlier'")
    expect(fn).toContain('PREÇO FORA DA FAIXA')
    expect(fn.toLowerCase()).not.toContain('falsific')
    expect(fn.toLowerCase()).not.toContain('fraude')
  })
})

describe('RadarPage: validar fonte nunca marca trusted automaticamente', () => {
  it('o modal de promoção inicia com trusted=false por padrão', () => {
    const modal = radarPage.slice(radarPage.indexOf('function RadarPromoteSourceModal'))
    expect(modal).toContain('const [trusted, setTrusted] = useState(false)')
  })

  it('trusted só muda por ação explícita do admin/manager (checkbox controlado)', () => {
    const modal = radarPage.slice(radarPage.indexOf('function RadarPromoteSourceModal'))
    expect(modal).toContain('checked={trusted}')
    expect(modal).toContain('onChange={(event) => setTrusted(event.target.checked)}')
  })

  it('domínio é obrigatório antes de enviar (mesma regra do backend)', () => {
    const modal = radarPage.slice(radarPage.indexOf('function RadarPromoteSourceModal'))
    expect(modal).toContain('if (!domain.trim())')
  })

  it('chama promoteSource, nunca grava direto na tabela nem reaproveita addManualOffer', () => {
    const modal = radarPage.slice(radarPage.indexOf('function RadarPromoteSourceModal'))
    expect(modal).toContain('await promoteSource(payload)')
    expect(modal).not.toContain('addManualOffer')
  })

  it('tipo "manual" não é uma opção na promoção de fonte descoberta', () => {
    const modal = radarPage.slice(radarPage.indexOf('function RadarPromoteSourceModal'), radarPage.indexOf('</Modal>', radarPage.indexOf('function RadarPromoteSourceModal')))
    expect(modal).not.toContain('value="manual"')
  })
})
