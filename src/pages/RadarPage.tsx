import { useEffect, useMemo, useState } from 'react'
import { AlertTriangle, Compass, ExternalLink, Globe2, Package, Plus, Radar as RadarIcon, Search, ShieldAlert, Sparkles, TrendingDown } from 'lucide-react'
import {
  ManualOfferInput, PromoteSourceInput, RadarAvailability, RadarOffer, RadarSearchResult, RadarShipping, RadarSource,
  RadarSourceType, RadarWatchItem, ShoppingSearchResult,
  addManualOffer, createWatchItem, fetchOffersForPerfume, fetchRadarRole, fetchSources, fetchWatchlist,
  normalizeSearchQuery, parsePerfumeQuery, promoteSource, removeWatchItem, searchRadar, summarizeRadar, updateWatchStatus,
} from '../lib/radar'
import { findExistingSourceByDomain, normalizeDomain, prefillFromShoppingResult } from '../lib/radar-source-prefill'
import { BUYING_SIGNAL_LABEL, BuyingContext, BuyingSignal, fetchBuyingContext } from '../lib/radar-buying'
import { STATUS_LABEL, buildRadarQuery } from '../lib/replenishment'
import { brl } from '../lib/format'
import { Metric } from '../components/shared/Metric'
import { DefinitionGroup, EmptyState, Modal, PageHeader, PrimaryButton, SecondaryButton, StatusBadge, Table } from '../components/ui'
import './RadarPage.css'

type Sort = 'score'|'price'|'country'|'recent'

const AVAILABILITY_LABEL: Record<string,{label:string;tone:'success'|'warning'|'danger'|'neutral'}> = {
  in_stock: { label: 'DISPONÍVEL', tone: 'success' },
  low_stock: { label: 'BAIXO ESTOQUE', tone: 'warning' },
  out_of_stock: { label: 'ESGOTADO', tone: 'danger' },
  preorder: { label: 'PRÉ-VENDA', tone: 'neutral' },
  unknown: { label: 'NÃO CONFIRMADO', tone: 'neutral' },
}
const SOURCE_LABEL: Record<string,string> = {
  official_brand: 'OFICIAL', authorized_retailer: 'REVENDEDOR', distributor: 'REVENDEDOR',
  retailer: 'REVENDEDOR', marketplace: 'MARKETPLACE', manual: 'MANUAL',
}

function timeAgo(iso:string) {
  const hours = Math.floor((Date.now() - new Date(iso).getTime()) / 3_600_000)
  if (hours < 1) return 'há poucos minutos'
  if (hours < 24) return `há ${hours}h`
  return `há ${Math.floor(hours / 24)}d`
}

function sortOffers(list:RadarOffer[], sort:Sort) {
  const sorted = [...list]
  if (sort === 'score') sorted.sort((a, b) => b.score - a.score)
  if (sort === 'price') sorted.sort((a, b) => a.price_native - b.price_native)
  if (sort === 'country') sorted.sort((a, b) => (a.country_name ?? '').localeCompare(b.country_name ?? ''))
  if (sort === 'recent') sorted.sort((a, b) => new Date(b.last_checked_at).getTime() - new Date(a.last_checked_at).getTime())
  return sorted
}

function goToSuppliers() {
  history.pushState({}, '', '/radar/fornecedores')
  dispatchEvent(new PopStateEvent('popstate'))
}

function buyingSignalTone(signal:BuyingSignal):'success'|'warning'|'danger'|'neutral' {
  if (signal === 'forte_oportunidade') return 'success'
  if (signal === 'investigar') return 'warning'
  return 'neutral'
}

// Fase 9 (Radar Buying Intelligence) — "O que precisa ser comprado? Onde
// comprar? Quanto custa?": combina reposição + margem + radar, tudo já
// persistido (ver lib/radar-buying.ts — nenhuma chamada externa aqui).
// "Buscar novamente no mundo" é a ÚNICA ação que pode gastar cota do
// provedor externo, e só dispara com um clique explícito do humano.
function PerfumeBuyingContext({ context, onSearchAgain }:{ context:BuyingContext; onSearchAgain:()=>void }) {
  const offer = context.bestOffer
  return <section className="card radar-buying-context">
    <div className="clients-caption">
      <strong>{context.perfumeName}</strong>
      <StatusBadge tone={buyingSignalTone(context.signal)}>{BUYING_SIGNAL_LABEL[context.signal]}</StatusBadge>
    </div>
    <div className="radar-buying-groups">
      <DefinitionGroup title="Estoque e venda" items={[
        { label: 'Estoque', value: context.availableMl !== null ? `${context.availableMl.toLocaleString('pt-BR')} ml` : null },
        { label: 'Venda 30d', value: context.ml30d !== null ? `${context.ml30d.toLocaleString('pt-BR')} ml` : null },
        { label: 'Velocidade', value: context.velocityMlPerDay !== null ? `${context.velocityMlPerDay.toFixed(2)} ml/dia` : null },
        { label: 'Cobertura', value: context.coverageDays !== null ? `~${Math.round(context.coverageDays)} dias` : null },
        { label: 'Reposição', value: context.replenishmentStatus ? STATUS_LABEL[context.replenishmentStatus] : null },
      ]} />
      <DefinitionGroup title="Custo e margem" items={[
        { label: 'Custo/ml', value: context.costPerMl !== null ? brl(context.costPerMl) : null },
        { label: 'Margem', value: context.marginPct !== null ? `${context.marginPct.toFixed(1).replace('.', ',')}%` : null },
      ]} />
      <DefinitionGroup title="Radar" items={[
        { label: 'Ofertas salvas', value: String(context.offerCount) },
        { label: 'Melhor oferta observada', value: offer ? `${offer.currency} ${Number(offer.price_native).toLocaleString('pt-BR')}` : null },
        { label: 'Fonte', value: offer?.source_name ?? offer?.seller_name ?? null },
        { label: 'Confiança', value: offer ? (offer.source_trusted ? 'Fonte confiável' : 'Fonte não validada') : null },
      ]} action={<SecondaryButton icon={<Search size={14} />} onClick={onSearchAgain}>Buscar novamente no mundo</SecondaryButton>} />
    </div>
  </section>
}

export function RadarPage({ initialQuery, initialPerfumeId }:{ initialQuery?:string; initialPerfumeId?:string }) {
  const [watchlist, setWatchlist] = useState<RadarWatchItem[]>([])
  const [offers, setOffers] = useState<RadarOffer[]>([])
  const [sources, setSources] = useState<RadarSource[]>([])
  const [role, setRole] = useState<'admin'|'manager'|'operator'|'viewer'|null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [query, setQuery] = useState(initialQuery ?? '')
  const [searching, setSearching] = useState(false)
  const [searchResult, setSearchResult] = useState<RadarSearchResult|null>(null)
  const [searchedBrand, setSearchedBrand] = useState('')
  const [activeWatch, setActiveWatch] = useState<RadarWatchItem|null>(null)
  const [showManualOffer, setShowManualOffer] = useState(false)
  const [promoting, setPromoting] = useState<{ item:ShoppingSearchResult; brand:string }|null>(null)
  const [sort, setSort] = useState<Sort>('score')
  const [buyingContext, setBuyingContext] = useState<BuyingContext|null>(null)

  // Perfume conhecido: ofertas ficam ESCOPADAS a ele (não a lista geral do
  // radar todo) — coerente com "perfume-scoped Radar navigation".
  const load = () => Promise.all([fetchWatchlist(), fetchOffersForPerfume({ perfumeId: initialPerfumeId ?? undefined }), fetchSources(), fetchRadarRole()])
    .then(([watch, allOffers, sourceRows, currentRole]) => { setWatchlist(watch); setOffers(allOffers); setSources(sourceRows); setRole(currentRole); setError('') })
    .catch((reason) => setError(reason instanceof Error ? reason.message : 'Não foi possível carregar o radar.'))
    .finally(() => setLoading(false))
  const reload = () => { setLoading(true); load() }
  const canManageSources = role === 'admin' || role === 'manager'
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { load(); if (initialQuery) queueMicrotask(() => handleSearch(initialQuery)) }, [])
  // Dados persistidos, nunca busca externa (briefing: "must NOT
  // automatically call Serper... simply because a page rendered" —
  // fetchBuyingContext só lê replenishment_signals/perfume_margin_summary/
  // radar_offers_for_perfume, os três já existentes e read-only).
  useEffect(() => { if (initialPerfumeId) fetchBuyingContext(initialPerfumeId).then(setBuyingContext).catch(() => {}) }, [initialPerfumeId])

  function searchAgainForBuyingContext() {
    if (!buyingContext) return
    const builtQuery = buildRadarQuery({
      perfume: buyingContext.perfumeName, brand_house: buyingContext.brandHouse,
      base_name: buyingContext.baseName ?? '', bottle_identifier: buyingContext.bottleIdentifier,
    })
    setQuery(builtQuery)
    handleSearch(builtQuery)
  }

  const metrics = useMemo(() => {
    const today = new Date(); today.setHours(0, 0, 0, 0)
    return {
      monitored: watchlist.filter((item) => item.status === 'active').length,
      opportunities: offers.length,
      inStock: offers.filter((offer) => offer.availability_status === 'in_stock').length,
      newToday: offers.filter((offer) => new Date(offer.first_seen_at) >= today).length,
    }
  }, [watchlist, offers])

  async function handleSearch(raw?:string) {
    // Uma ação humana = uma busca: ignora cliques repetidos enquanto uma busca já está em voo.
    if (searching) return
    const value = normalizeSearchQuery(raw ?? query)
    if (!value) return
    setSearching(true); setSearchResult(null); setError('')
    try {
      const parsed = parsePerfumeQuery(value)
      const brandUsed = parsed.brand || value
      const result = await searchRadar({ query: value, brand: brandUsed, perfume_name: parsed.perfumeName || value, size_ml: parsed.sizeMl })
      setSearchResult(result)
      setSearchedBrand(brandUsed)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Não foi possível buscar agora.')
    } finally {
      setSearching(false)
    }
  }

  async function handleWatch() {
    const value = query.trim()
    if (!value) return
    const parsed = parsePerfumeQuery(value)
    try {
      await createWatchItem({ brand: parsed.brand || value, perfume_name: parsed.perfumeName || value, size_ml: parsed.sizeMl })
      reload()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Não foi possível acompanhar este perfume.')
    }
  }

  const filteredOpportunities = useMemo(() => {
    const term = query.trim().toLowerCase()
    const list = term ? offers.filter((offer) => `${offer.raw_title ?? ''} ${offer.seller_name ?? ''}`.toLowerCase().includes(term)) : offers
    return sortOffers(list, sort)
  }, [offers, query, sort])

  return <div className="page radar-page">
    {showManualOffer && <RadarManualOfferModal watchItem={activeWatch} close={() => setShowManualOffer(false)} saved={() => { setShowManualOffer(false); reload() }} />}
    {activeWatch && <RadarComparator watch={activeWatch} close={() => setActiveWatch(null)} onAddOffer={() => setShowManualOffer(true)} />}
    <PageHeader eyebrow="RUAH INTELLIGENCE" title="Radar Global" description="Radar mundial de abastecimento: pesquise um perfume e compare oportunidades por país e fornecedor." actions={
      <SecondaryButton onClick={goToSuppliers}>Ver fornecedores</SecondaryButton>
    } />

    {initialPerfumeId && buyingContext && <PerfumeBuyingContext context={buyingContext} onSearchAgain={searchAgainForBuyingContext} />}

    <section className="metrics">
      <Metric label="Perfumes monitorados" value={String(metrics.monitored)} detail="Na watchlist ativa" icon={RadarIcon} />
      <Metric label="Oportunidades encontradas" value={String(metrics.opportunities)} detail="Ofertas ativas" icon={Compass} />
      <Metric label="Com estoque" value={String(metrics.inStock)} detail="Disponível agora" icon={Package} />
      <Metric label="Novas hoje" value={String(metrics.newToday)} detail="Vistas pela primeira vez hoje" icon={Sparkles} />
    </section>

    <div className="card radar-search-card">
      <h3>O que você procura?</h3>
      <div className="radar-search-row">
        <input placeholder="Guidance 46 — Amouage" value={query} onChange={(event) => setQuery(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') handleSearch() }} />
        <PrimaryButton icon={<Search size={16} />} loading={searching} onClick={() => handleSearch()}>Buscar no mundo</PrimaryButton>
      </div>
      <div className="radar-search-actions">
        <SecondaryButton icon={<RadarIcon size={16} />} onClick={handleWatch}>Acompanhar perfume</SecondaryButton>
        <SecondaryButton icon={<Plus size={16} />} onClick={() => { setActiveWatch(null); setShowManualOffer(true) }}>Adicionar oferta manualmente</SecondaryButton>
      </div>
      {searchResult && !searchResult.available && <div className="notice"><Globe2 size={16} /><span>{searchResult.message}</span></div>}
    </div>

    {/* Salvar aqui só chama radar_promote_source + reload() (refetch de radar_sources) — nunca
       searchRadar de novo. O resultado atual (query/results/relevance/market/score/availability)
       fica intocado; só os badges de fonte recalculam no próximo render com o `sources` novo. */}
    {promoting && <RadarPromoteSourceModal item={promoting.item} brand={promoting.brand} sources={sources} close={() => setPromoting(null)} saved={() => { setPromoting(null); reload() }} />}

    {searchResult?.available && <RadarSearchResults result={searchResult} sources={sources} canManageSources={canManageSources} onValidate={(item) => setPromoting({ item, brand: searchedBrand })} />}

    <section className="card radar-watchlist">
      <div className="clients-caption"><strong>Perfumes acompanhados</strong></div>
      {watchlist.length === 0 ? <EmptyState icon={RadarIcon} title="Nenhum perfume acompanhado" description="Pesquise um perfume e clique em Acompanhar perfume." /> :
        <Table rowKey={(item) => item.id} rows={watchlist} onRowClick={(item) => setActiveWatch(item)} columns={[
          { key: 'perfume', label: 'Perfume', render: (item) => <strong>{item.brand} — {item.perfume_name}</strong> },
          { key: 'size', label: 'Tamanho', render: (item) => item.size_ml ? `${item.size_ml} ml` : '—' },
          { key: 'priority', label: 'Prioridade', render: (item) => <StatusBadge tone={item.priority === 'high' ? 'danger' : item.priority === 'low' ? 'neutral' : 'warning'}>{item.priority.toUpperCase()}</StatusBadge> },
          { key: 'status', label: 'Status', render: (item) => <StatusBadge tone={item.status === 'active' ? 'success' : 'neutral'}>{item.status === 'active' ? 'ATIVO' : 'PAUSADO'}</StatusBadge> },
          {
            key: 'actions', label: 'Ações', render: (item) => <div className="radar-watch-actions">
              <button onClick={(event) => { event.stopPropagation(); updateWatchStatus(item.id, item.status === 'active' ? 'paused' : 'active').then(reload) }}>{item.status === 'active' ? 'Pausar' : 'Reativar'}</button>
              <button onClick={(event) => { event.stopPropagation(); if (confirm('Remover este item da watchlist?')) removeWatchItem(item.id).then(reload) }}>Remover</button>
            </div>,
          },
        ]} />}
    </section>

    <section className="card radar-offers">
      <div className="clients-caption">
        <strong>{filteredOpportunities.length} oportunidades</strong>
        <select value={sort} onChange={(event) => setSort(event.target.value as Sort)}>
          <option value="score">Confiabilidade</option>
          <option value="price">Menor preço</option>
          <option value="country">País</option>
          <option value="recent">Mais recente</option>
        </select>
      </div>
      {error && <div className="notice"><AlertTriangle /><span>{error}</span></div>}
      {loading ? <div className="empty card"><h3>Carregando radar…</h3></div> :
        filteredOpportunities.length === 0 ? <EmptyState icon={Compass} title="Nenhuma oportunidade ainda" description="Adicione uma oferta manualmente ou pesquise um perfume." action={{ label: 'Adicionar oferta manualmente', onClick: () => setShowManualOffer(true) }} /> :
          <Table rowKey={(offer) => offer.id} rows={filteredOpportunities} columns={[
            { key: 'offer', label: 'Oferta', render: (offer) => <div><strong>{offer.raw_title || offer.seller_name || offer.domain || 'Oferta'}</strong><div className="radar-offer-source"><StatusBadge tone={offer.source_trusted ? 'success' : 'neutral'}>{SOURCE_LABEL[offer.source_type ?? 'manual'] ?? 'MANUAL'}</StatusBadge></div></div> },
            { key: 'country', label: 'País', render: (offer) => offer.country_name || offer.country_code || '—' },
            { key: 'price', label: 'Preço', render: (offer) => `${offer.currency} ${Number(offer.price_native).toLocaleString('pt-BR')}` },
            { key: 'size', label: 'Tamanho', render: (offer) => offer.size_ml ? `${offer.size_ml} ml` : '—' },
            { key: 'availability', label: 'Disponibilidade', render: (offer) => { const state = AVAILABILITY_LABEL[offer.availability_status]; return <StatusBadge tone={state.tone}>{state.label}</StatusBadge> } },
            { key: 'updated', label: 'Atualizado', render: (offer) => timeAgo(offer.last_checked_at) },
            { key: 'score', label: 'Score', align: 'right', render: (offer) => String(offer.score) },
            { key: 'actions', label: 'Ações', render: (offer) => <SecondaryButton onClick={() => window.open(offer.url, '_blank', 'noopener,noreferrer')}>Abrir fonte</SecondaryButton> },
          ]} />}
    </section>
  </div>
}

function RadarComparator({ watch, close, onAddOffer }:{ watch:RadarWatchItem; close:()=>void; onAddOffer:()=>void }) {
  const [offers, setOffers] = useState<RadarOffer[]>([])
  const [loading, setLoading] = useState(true)
  const [sort, setSort] = useState<Sort>('score')
  const [summary, setSummary] = useState<{ resumo:string; menor_preco_por_moeda:{moeda:string;valor:string}[]; alertas:string[] }|null>(null)
  const [summarizing, setSummarizing] = useState(false)
  const [summaryError, setSummaryError] = useState('')

  useEffect(() => {
    fetchOffersForPerfume({ watchItemId: watch.id }).then(setOffers).finally(() => setLoading(false))
  }, [watch.id])

  const sorted = useMemo(() => sortOffers(offers, sort), [offers, sort])

  async function runSummary() {
    setSummarizing(true); setSummaryError('')
    try { setSummary(await summarizeRadar({ watch_item_id: watch.id })) }
    catch (reason) { setSummaryError(reason instanceof Error ? reason.message : 'Não foi possível gerar a análise.') }
    finally { setSummarizing(false) }
  }

  return <Modal open onClose={close} size="lg" eyebrow={watch.brand.toUpperCase()} title={watch.perfume_name} footer={<>
    <SecondaryButton onClick={close}>Fechar</SecondaryButton>
    <PrimaryButton icon={<Plus size={16} />} onClick={onAddOffer}>Adicionar oferta manualmente</PrimaryButton>
  </>}>
    <div className="radar-comparator-toolbar">
      <select value={sort} onChange={(event) => setSort(event.target.value as Sort)}>
        <option value="score">Confiabilidade</option><option value="price">Menor preço</option>
        <option value="country">País</option><option value="recent">Mais recente</option>
      </select>
      <SecondaryButton icon={<Sparkles size={16} />} loading={summarizing} onClick={runSummary}>Gerar análise RUAH Intelligence</SecondaryButton>
    </div>
    {summaryError && <div className="notice"><AlertTriangle /><span>{summaryError}</span></div>}
    {summary && <div className="radar-summary">
      <p>{summary.resumo}</p>
      {summary.menor_preco_por_moeda.length > 0 && <ul>{summary.menor_preco_por_moeda.map((item) => <li key={item.moeda}>{item.moeda}: {item.valor}</li>)}</ul>}
      {summary.alertas.length > 0 && <ul className="radar-summary-alerts">{summary.alertas.map((alert, index) => <li key={index}><TrendingDown size={13} /> {alert}</li>)}</ul>}
    </div>}
    {loading ? <p>Carregando ofertas…</p> : sorted.length === 0 ? <EmptyState icon={Compass} title="Nenhuma oferta para este perfume" description="Adicione a primeira oferta manualmente." action={{ label: 'Adicionar oferta', onClick: onAddOffer }} /> :
      <div className="radar-offer-list">{sorted.map((offer) => <article key={offer.id} className="radar-offer-card">
        <header><strong>{offer.seller_name || offer.domain || 'Fonte'}</strong><StatusBadge tone={offer.source_trusted ? 'success' : 'neutral'}>{SOURCE_LABEL[offer.source_type ?? 'manual'] ?? 'MANUAL'}</StatusBadge></header>
        <p className="radar-offer-title">{offer.raw_title || '—'}</p>
        <div className="radar-offer-meta">
          <span>{offer.country_name || offer.country_code || 'País não informado'}</span>
          <strong>{offer.currency} {Number(offer.price_native).toLocaleString('pt-BR')}</strong>
          <span>{offer.size_ml ? `${offer.size_ml} ml` : '—'}</span>
          {(() => { const state = AVAILABILITY_LABEL[offer.availability_status]; return <StatusBadge tone={state.tone}>{state.label}</StatusBadge> })()}
        </div>
        <footer><span>Atualizado {timeAgo(offer.last_checked_at)}</span><a href={offer.url} target="_blank" rel="noopener noreferrer">Abrir fonte →</a></footer>
      </article>)}</div>}
  </Modal>
}

function RadarManualOfferModal({ watchItem, close, saved }:{ watchItem:RadarWatchItem|null; close:()=>void; saved:()=>void }) {
  const [url, setUrl] = useState('')
  const [sellerName, setSellerName] = useState('')
  const [domain, setDomain] = useState('')
  const [countryCode, setCountryCode] = useState('')
  const [countryName, setCountryName] = useState('')
  const [rawTitle, setRawTitle] = useState('')
  const [price, setPrice] = useState('')
  const [currency, setCurrency] = useState('EUR')
  const [sizeMl, setSizeMl] = useState('')
  const [availability, setAvailability] = useState<RadarAvailability>('unknown')
  const [shipping, setShipping] = useState<RadarShipping>('unknown')
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)

  const submit = async () => {
    const priceValue = Number(price.replace(',', '.'))
    if (!url.trim() || !Number.isFinite(priceValue) || priceValue < 0 || currency.trim().length !== 3) {
      setError('Preencha URL, preço e moeda (3 letras) corretamente.'); return
    }
    setSaving(true); setError('')
    try {
      const payload:ManualOfferInput = {
        url: url.trim(), price_native: priceValue, currency: currency.trim().toUpperCase(),
        seller_name: sellerName.trim() || undefined, domain: domain.trim() || undefined,
        country_code: countryCode.trim() || undefined, country_name: countryName.trim() || undefined,
        raw_title: rawTitle.trim() || undefined, size_ml: sizeMl ? Number(sizeMl.replace(',', '.')) : null,
        availability_status: availability, shipping_to_brazil: shipping,
        watch_item_id: watchItem?.id ?? null,
      }
      await addManualOffer(payload)
      saved()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Não foi possível salvar esta oferta.')
    } finally {
      setSaving(false)
    }
  }

  return <Modal open onClose={close} eyebrow="ADICIONAR OFERTA" title={watchItem ? `${watchItem.brand} — ${watchItem.perfume_name}` : 'Nova oferta manual'} footer={<>
    <SecondaryButton onClick={close}>Cancelar</SecondaryButton>
    <PrimaryButton loading={saving} onClick={submit}>Salvar oferta</PrimaryButton>
  </>}>
    <div className="record-form"><div className="form-grid">
      <label className="field wide"><span>URL da fonte</span><input value={url} onChange={(event) => setUrl(event.target.value)} placeholder="https://…" /></label>
      <label className="field"><span>Loja / vendedor</span><input value={sellerName} onChange={(event) => setSellerName(event.target.value)} /></label>
      <label className="field"><span>Domínio</span><input value={domain} onChange={(event) => setDomain(event.target.value)} /></label>
      <label className="field"><span>País (código, ex.: FR)</span><input value={countryCode} onChange={(event) => setCountryCode(event.target.value)} maxLength={2} /></label>
      <label className="field"><span>País (nome)</span><input value={countryName} onChange={(event) => setCountryName(event.target.value)} /></label>
      <label className="field wide"><span>Título da oferta</span><input value={rawTitle} onChange={(event) => setRawTitle(event.target.value)} /></label>
      <label className="field"><span>Preço</span><input inputMode="decimal" value={price} onChange={(event) => setPrice(event.target.value)} /></label>
      <label className="field"><span>Moeda (ex.: EUR)</span><input value={currency} onChange={(event) => setCurrency(event.target.value)} maxLength={3} /></label>
      <label className="field"><span>Tamanho (ml)</span><input inputMode="decimal" value={sizeMl} onChange={(event) => setSizeMl(event.target.value)} /></label>
      <label className="field"><span>Disponibilidade</span>
        <select value={availability} onChange={(event) => setAvailability(event.target.value as RadarAvailability)}>
          <option value="unknown">Não confirmado</option><option value="in_stock">Disponível</option>
          <option value="low_stock">Baixo estoque</option><option value="out_of_stock">Esgotado</option><option value="preorder">Pré-venda</option>
        </select>
      </label>
      <label className="field"><span>Envia para o Brasil?</span>
        <select value={shipping} onChange={(event) => setShipping(event.target.value as RadarShipping)}>
          <option value="unknown">Não sei</option><option value="yes">Sim</option><option value="no">Não</option>
        </select>
      </label>
    </div>{error && <div className="form-error">{error}</div>}</div>
  </Modal>
}

// Uma oferta é considerada de "fonte conhecida" quando o nome do vendedor bate com uma fonte
// já classificada em radar_sources (a busca funciona igual sem a migration de seed — a lista
// só fica vazia e tudo aparece como "nova fonte" ou "marketplace" conforme classificação do
// backend). Quando não bate com nada, tratamos como fonte nova e nunca marcamos trusted
// automaticamente.
function matchSource(sellerName:string|null, sources:RadarSource[]):RadarSource|null {
  if (!sellerName) return null
  const normalized = sellerName.trim().toLowerCase()
  return sources.find((source) => source.name.trim().toLowerCase() === normalized) ?? null
}

function sourceBadge(item:ShoppingSearchResult, sources:RadarSource[]):{ label:string; tone:'success'|'warning'|'neutral' } {
  if (item.source_type === 'marketplace') return { label: 'MARKETPLACE', tone: 'neutral' }
  const matched = matchSource(item.seller_name, sources)
  if (matched) return { label: SOURCE_LABEL[matched.source_type] ?? 'REVENDEDOR', tone: matched.trusted ? 'success' : 'neutral' }
  return { label: 'NOVA FONTE', tone: 'warning' }
}

const RELEVANCE_SECTION_LABEL:Record<'primary'|'secondary'|'excluded',string> = {
  primary: 'Oportunidades mais relevantes', secondary: 'Outros resultados', excluded: 'Resultados descartados',
}

function RadarSearchResults({ result, sources, canManageSources, onValidate }:{ result:RadarSearchResult; sources:RadarSource[]; canManageSources:boolean; onValidate:(item:ShoppingSearchResult)=>void }) {
  const [showSecondary, setShowSecondary] = useState(false)
  const [showExcluded, setShowExcluded] = useState(false)

  const results = useMemo(() => result.results ?? [], [result.results])
  const primary = useMemo(() => results
    .filter((item) => item.relevance === 'exact' || item.relevance === 'likely')
    .sort((a, b) => (a.relevance === 'exact' ? 0 : 1) - (b.relevance === 'exact' ? 0 : 1)), [results])
  const secondary = useMemo(() => results.filter((item) => item.relevance === 'weak'), [results])
  const excluded = useMemo(() => results.filter((item) => item.relevance === 'excluded'), [results])

  return <section className="card radar-search-results">
    <div className="clients-caption">
      <strong>{result.result_count ?? results.length} resultados — Google Shopping ({(result.market ?? 'uk').toUpperCase()})</strong>
      <span className="radar-search-query">“{result.query}”</span>
    </div>
    {/* item 13: o contador nunca mistura resultados brutos com oportunidades — sempre as 3 partes. */}
    <p className="radar-relevance-summary">
      {results.length} resultados encontrados · {primary.length} oportunidades relevantes · {secondary.length + excluded.length} resultados secundários/descartados
    </p>
    {results.length === 0 ? <EmptyState icon={Compass} title="Nenhum resultado agora" description="Nenhuma oferta encontrada para esta busca no Google Shopping." /> : <>
      <h4 className="radar-results-heading">{RELEVANCE_SECTION_LABEL.primary}</h4>
      {primary.length === 0 ? <p className="radar-results-empty">Nenhum resultado exato ou provável para esta busca.</p> :
        <div className="radar-offer-list">{primary.map((item, index) => <RadarSearchResultCard key={item.product_id ?? item.source_url ?? index} item={item} sources={sources} canManageSources={canManageSources} onValidate={() => onValidate(item)} />)}</div>}

      {secondary.length > 0 && <>
        <button className="radar-toggle-section" onClick={() => setShowSecondary((value) => !value)}>{showSecondary ? 'Ocultar' : 'Ver'} {RELEVANCE_SECTION_LABEL.secondary.toLowerCase()} ({secondary.length})</button>
        {showSecondary && <div className="radar-offer-list">{secondary.map((item, index) => <RadarSearchResultCard key={item.product_id ?? item.source_url ?? index} item={item} sources={sources} canManageSources={canManageSources} onValidate={() => onValidate(item)} />)}</div>}
      </>}

      {excluded.length > 0 && <>
        <button className="radar-toggle-section" onClick={() => setShowExcluded((value) => !value)}>{showExcluded ? 'Ocultar' : 'Ver'} {RELEVANCE_SECTION_LABEL.excluded.toLowerCase()} ({excluded.length})</button>
        {showExcluded && <div className="radar-offer-list">{excluded.map((item, index) => <RadarSearchResultCard key={item.product_id ?? item.source_url ?? index} item={item} sources={sources} canManageSources={canManageSources} onValidate={() => onValidate(item)} />)}</div>}
      </>}
    </>}
  </section>
}

function RadarSearchResultCard({ item, sources, canManageSources, onValidate }:{ item:ShoppingSearchResult; sources:RadarSource[]; canManageSources:boolean; onValidate:()=>void }) {
  const state = AVAILABILITY_LABEL[item.availability_status]
  const badge = sourceBadge(item, sources)
  const unvalidated = badge.label === 'NOVA FONTE'
  // Prioridade: loja/URL comercial verificável > só a página do Google Shopping como fallback.
  // Nunca chamamos um link do Google de "oferta" — o clique pode não levar a lugar nenhum.
  const hasMerchantLink = Boolean(item.merchant_url)
  const openUrl = item.merchant_url ?? item.source_url
  return <article className="radar-offer-card">
    <header><strong>{item.seller_name ?? 'Loja não identificada'}</strong><StatusBadge tone={badge.tone}>{badge.label}</StatusBadge></header>
    <p className="radar-offer-title">{item.title ?? '—'}</p>
    {unvalidated && <p className="radar-new-source-hint"><ShieldAlert size={13} /> Ainda não validada pela RUAH.</p>}
    <div className="radar-offer-meta">
      <strong>{item.currency ? `${item.currency} ${item.price_native ?? '—'}` : item.raw_price ?? 'Preço não informado'}</strong>
      {item.delivery && <span>{item.delivery}</span>}
      {item.rating != null && <span>★ {item.rating}{item.reviews != null ? ` (${item.reviews})` : ''}</span>}
      <StatusBadge tone={state.tone}>{state.label}</StatusBadge>
      {item.price_flag === 'outlier' && <StatusBadge tone="warning">PREÇO FORA DA FAIXA</StatusBadge>}
    </div>
    <footer>
      <span>Fonte: Google Shopping</span>
      {openUrl ? <a href={openUrl} target="_blank" rel="noopener noreferrer"><ExternalLink size={12} /> {hasMerchantLink ? 'Abrir loja' : 'Ver no Google Shopping'}</a> : <span>Sem link direto</span>}
    </footer>
    {unvalidated && canManageSources && <SecondaryButton onClick={onValidate}>Validar fonte</SecondaryButton>}
  </article>
}

function RadarPromoteSourceModal({ item, brand, sources, close, saved }:{ item:ShoppingSearchResult; brand:string; sources:RadarSource[]; close:()=>void; saved:()=>void }) {
  // Pré-preenche só o que dá pra determinar com segurança (item 1-6 do spec). Nunca inventa
  // domínio/país/tipo — ver radar-source-prefill.ts para a justificativa de cada campo.
  const prefill = useMemo(() => prefillFromShoppingResult(item, brand), [item, brand])
  const [name, setName] = useState(prefill.name)
  const [domain, setDomain] = useState(prefill.domain ?? '')
  const [countryCode, setCountryCode] = useState('')
  const [sourceType, setSourceType] = useState<Exclude<RadarSourceType,'manual'>>(prefill.sourceType)
  const [trusted, setTrusted] = useState(false)
  const [notes, setNotes] = useState('')
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const [acknowledgedExisting, setAcknowledgedExisting] = useState(false)

  // Checagem de duplicata ANTES de salvar (item 8): compara o domínio normalizado contra
  // organization_id+domain — `sources` já vem só da organização autenticada (RLS).
  const normalizedTypedDomain = useMemo(() => normalizeDomain(domain), [domain])
  const existingMatch = useMemo(() => findExistingSourceByDomain(normalizedTypedDomain, sources), [normalizedTypedDomain, sources])
  const showExistingBanner = Boolean(existingMatch) && !acknowledgedExisting

  function loadExisting() {
    if (!existingMatch) return
    setName(existingMatch.name)
    setDomain(existingMatch.domain ?? '')
    setCountryCode(existingMatch.country_code ?? '')
    setSourceType(existingMatch.source_type === 'manual' ? 'retailer' : existingMatch.source_type)
    setTrusted(existingMatch.trusted)
    setNotes(existingMatch.notes ?? '')
    setAcknowledgedExisting(true)
  }

  const submit = async () => {
    const normalized = normalizeDomain(domain)
    if (!normalized) { setError('Informe um domínio válido (ex.: harrods.com).'); return }
    setSaving(true); setError('')
    try {
      // Sempre via radar_promote_source — o frontend nunca grava direto em radar_sources.
      // Como a função é upsert por organization_id+domain, salvar aqui também cobre o fluxo
      // "Editar fonte" sem criar duplicata.
      const payload:PromoteSourceInput = {
        domain: normalized, name: name.trim() || undefined, country_code: countryCode.trim() || undefined,
        source_type: sourceType, trusted, notes: notes.trim() || undefined,
      }
      await promoteSource(payload)
      saved()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Não foi possível validar esta fonte.')
    } finally {
      setSaving(false)
    }
  }

  if (showExistingBanner) {
    return <Modal open onClose={close} eyebrow="FONTE JÁ CADASTRADA" title="Esta fonte já existe no Radar" footer={<>
      <SecondaryButton onClick={close}>Cancelar</SecondaryButton>
      <PrimaryButton onClick={loadExisting}>Editar fonte</PrimaryButton>
    </>}>
      <p>Já existe uma fonte cadastrada para <strong>{existingMatch?.domain}</strong> ({existingMatch?.name}). Nenhuma duplicata será criada.</p>
    </Modal>
  }

  return <Modal open onClose={close} eyebrow="NOVA FONTE" title="Validar fonte descoberta" footer={<>
    <SecondaryButton onClick={close}>Cancelar</SecondaryButton>
    <PrimaryButton loading={saving} onClick={submit}>Salvar fonte</PrimaryButton>
  </>}>
    <div className="record-form"><div className="form-grid">
      <p className="radar-promote-hint">Esta fonte apareceu numa busca do Radar mas ainda não está classificada. Escolha o tipo, o país e se ela é confiável antes de aparecer com selo de confiança nas próximas buscas.</p>
      <label className="field wide"><span>Nome{prefill.nameInferred ? ' (inferido do domínio — confirme)' : ''}</span><input value={name} onChange={(event) => setName(event.target.value)} /></label>
      <label className="field wide">
        <span>Domínio</span>
        <input value={domain} onChange={(event) => { setDomain(event.target.value); setAcknowledgedExisting(false) }} placeholder="loja.com" />
        {!prefill.domain && <small className="radar-domain-helper">Não conseguimos identificar o site direto desta fonte. Confirme o domínio antes de validar.</small>}
      </label>
      <label className="field"><span>País (código, ex.: GB)</span><input value={countryCode} onChange={(event) => setCountryCode(event.target.value)} maxLength={2} /></label>
      <label className="field"><span>Tipo{prefill.officialHint && sourceType !== 'official_brand' ? ' — possível fonte oficial' : ''}</span>
        <select value={sourceType} onChange={(event) => setSourceType(event.target.value as Exclude<RadarSourceType,'manual'>)}>
          <option value="official_brand">Marca oficial</option>
          <option value="authorized_retailer">Revendedor autorizado</option>
          <option value="retailer">Revendedor</option>
          <option value="distributor">Distribuidor</option>
          <option value="marketplace">Marketplace</option>
        </select>
      </label>
      <label className="field checkbox-field"><input type="checkbox" checked={trusted} onChange={(event) => setTrusted(event.target.checked)} /><span>Marcar como fonte confiável</span></label>
      <label className="field wide"><span>Observações</span><textarea value={notes} onChange={(event) => setNotes(event.target.value)} /></label>
    </div>{error && <div className="form-error">{error}</div>}</div>
  </Modal>
}
