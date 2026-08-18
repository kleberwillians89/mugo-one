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

  it('domínio inválido/vazio é rejeitado antes de enviar, com a mesma normalização do backend', () => {
    const modal = radarPage.slice(radarPage.indexOf('function RadarPromoteSourceModal'))
    expect(modal).toContain('const normalized = normalizeDomain(domain)')
    expect(modal).toContain('if (!normalized)')
  })

  it('chama promoteSource, nunca grava direto na tabela nem reaproveita addManualOffer', () => {
    const modal = radarPage.slice(radarPage.indexOf('function RadarPromoteSourceModal'))
    expect(modal).toContain('await promoteSource(payload)')
    expect(modal).not.toContain('addManualOffer')
  })

  it('tipo "manual" não é uma opção na promoção de fonte descoberta', () => {
    const modal = radarPage.slice(radarPage.indexOf('function RadarPromoteSourceModal'))
    expect(modal).not.toContain('value="manual"')
  })
})

describe('RadarPage: pré-preenchimento do modal "Validar fonte"', () => {
  it('usa prefillFromShoppingResult a partir do item e da marca pesquisada, nunca deixa o operador digitar tudo de novo', () => {
    expect(radarPage).toContain("import { findExistingSourceByDomain, normalizeDomain, prefillFromShoppingResult } from '../lib/radar-source-prefill'")
    const modal = radarPage.slice(radarPage.indexOf('function RadarPromoteSourceModal'))
    expect(modal).toContain('const prefill = useMemo(() => prefillFromShoppingResult(item, brand)')
    expect(modal).toContain('const [name, setName] = useState(prefill.name)')
    expect(modal).toContain('const [domain, setDomain] = useState(prefill.domain ?? \'\')')
    expect(modal).toContain('const [sourceType, setSourceType] = useState<Exclude<RadarSourceType,\'manual\'>>(prefill.sourceType)')
  })

  it('mostra aviso quando não há domínio confiável para pré-preencher (item 4 do spec)', () => {
    const modal = radarPage.slice(radarPage.indexOf('function RadarPromoteSourceModal'))
    expect(modal).toContain('{!prefill.domain &&')
    expect(modal).toContain('Não conseguimos identificar o site direto desta fonte. Confirme o domínio antes de validar.')
  })

  it('sinaliza "possível fonte oficial" só como texto, nunca seleciona official_brand sozinho', () => {
    const modal = radarPage.slice(radarPage.indexOf('function RadarPromoteSourceModal'))
    expect(modal).toContain("prefill.officialHint && sourceType !== 'official_brand'")
    expect(modal).toContain('possível fonte oficial')
    expect(modal).not.toContain("setSourceType('official_brand')")
  })

  it('marca visualmente quando o nome foi inferido do domínio (nunca dado confirmado do provider)', () => {
    const modal = radarPage.slice(radarPage.indexOf('function RadarPromoteSourceModal'))
    expect(modal).toContain('prefill.nameInferred')
    expect(modal).toContain('inferido do domínio')
  })
})

describe('RadarPage: fonte já existente (item 8 do spec — zero duplicata)', () => {
  it('checa duplicata pelo domínio normalizado antes de mostrar o formulário', () => {
    const modal = radarPage.slice(radarPage.indexOf('function RadarPromoteSourceModal'))
    expect(modal).toContain('const existingMatch = useMemo(() => findExistingSourceByDomain(normalizedTypedDomain, sources)')
  })

  it('mostra "Esta fonte já existe no Radar" com ações Editar/Cancelar, sem criar duplicata', () => {
    const modal = radarPage.slice(radarPage.indexOf('function RadarPromoteSourceModal'))
    expect(modal).toContain('Esta fonte já existe no Radar')
    expect(modal).toContain('<PrimaryButton onClick={loadExisting}>Editar fonte</PrimaryButton>')
    expect(modal).toContain('<SecondaryButton onClick={close}>Cancelar</SecondaryButton>')
  })

  it('editar fonte carrega os dados já cadastrados no formulário em vez de deixar tudo em branco', () => {
    const loadExistingStart = radarPage.indexOf('function loadExisting')
    const modal = radarPage.slice(loadExistingStart, radarPage.indexOf('const submit', loadExistingStart))
    expect(modal).toContain('setName(existingMatch.name)')
    expect(modal).toContain('setDomain(existingMatch.domain ?? \'\')')
    expect(modal).toContain('setCountryCode(existingMatch.country_code ?? \'\')')
    expect(modal).toContain('setTrusted(existingMatch.trusted)')
  })

  it('salvar depois de editar ainda passa por promoteSource (upsert), nunca grava direto', () => {
    const modal = radarPage.slice(radarPage.indexOf('function RadarPromoteSourceModal'))
    const submitCalls = (modal.match(/await promoteSource\(/g) ?? []).length
    expect(submitCalls).toBe(1)
  })
})

describe('RadarPage: salvar fonte nunca dispara nova busca Serper (item 11-12 do spec)', () => {
  it('o callback saved() só fecha o modal e chama reload() — nunca handleSearch/searchRadar', () => {
    const savedWiring = radarPage.slice(radarPage.indexOf('{promoting && <RadarPromoteSourceModal'), radarPage.indexOf('{searchResult?.available'))
    expect(savedWiring).toContain('saved={() => { setPromoting(null); reload() }}')
    expect(savedWiring).not.toContain('handleSearch')
    expect(savedWiring).not.toContain('searchRadar')
  })

  it('reload() nunca chama searchRadar — só refetch de watchlist/offers/sources/role', () => {
    const reloadFn = radarPage.slice(radarPage.indexOf('const load = () =>'), radarPage.indexOf('const canManageSources'))
    expect(reloadFn).toContain('fetchWatchlist()')
    expect(reloadFn).toContain('fetchSources()')
    expect(reloadFn).not.toContain('searchRadar')
  })

  it('query/results/relevance/market/score/availability do resultado atual nunca são reescritos ao salvar uma fonte', () => {
    const savedWiring = radarPage.slice(radarPage.indexOf('{promoting && <RadarPromoteSourceModal'), radarPage.indexOf('{searchResult?.available'))
    expect(savedWiring).not.toContain('setSearchResult')
  })
})

describe('RadarPage: só admin/manager veem e usam "Validar fonte" (item 14 do spec)', () => {
  it('canManageSources é derivado do papel do usuário (admin ou manager)', () => {
    expect(radarPage).toContain("const canManageSources = role === 'admin' || role === 'manager'")
  })

  it('operator/viewer continuam vendo o badge "NOVA FONTE", só não recebem o botão', () => {
    const cardFn = radarPage.slice(radarPage.indexOf('function RadarSearchResultCard'), radarPage.indexOf('function RadarPromoteSourceModal'))
    expect(cardFn).toContain("badge.label === 'NOVA FONTE'")
    expect(cardFn).toContain('{unvalidated && canManageSources &&')
  })
})
