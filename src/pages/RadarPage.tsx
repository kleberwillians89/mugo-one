import { useEffect, useMemo, useState } from 'react'
import { AlertTriangle, Compass, Globe2, Package, Plus, Radar as RadarIcon, Search, Sparkles, TrendingDown } from 'lucide-react'
import {
  ManualOfferInput, RadarAvailability, RadarOffer, RadarSearchResult, RadarShipping, RadarWatchItem,
  addManualOffer, createWatchItem, fetchOffersForPerfume, fetchWatchlist, parsePerfumeQuery,
  removeWatchItem, searchRadar, summarizeRadar, updateWatchStatus,
} from '../lib/radar'
import { Metric } from '../components/shared/Metric'
import { EmptyState, Modal, PageHeader, PrimaryButton, SecondaryButton, StatusBadge, Table } from '../components/ui'
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

export function RadarPage({ initialQuery }:{ initialQuery?:string }) {
  const [watchlist, setWatchlist] = useState<RadarWatchItem[]>([])
  const [offers, setOffers] = useState<RadarOffer[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [query, setQuery] = useState(initialQuery ?? '')
  const [searching, setSearching] = useState(false)
  const [searchResult, setSearchResult] = useState<RadarSearchResult|null>(null)
  const [activeWatch, setActiveWatch] = useState<RadarWatchItem|null>(null)
  const [showManualOffer, setShowManualOffer] = useState(false)
  const [sort, setSort] = useState<Sort>('score')

  const reload = () => {
    setLoading(true)
    Promise.all([fetchWatchlist(), fetchOffersForPerfume({})])
      .then(([watch, allOffers]) => { setWatchlist(watch); setOffers(allOffers); setError('') })
      .catch((reason) => setError(reason instanceof Error ? reason.message : 'Não foi possível carregar o radar.'))
      .finally(() => setLoading(false))
  }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { reload(); if (initialQuery) handleSearch(initialQuery) }, [])

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
    const value = (raw ?? query).trim()
    if (!value) return
    setSearching(true); setSearchResult(null); setError('')
    try {
      const parsed = parsePerfumeQuery(value)
      const result = await searchRadar({ brand: parsed.brand || value, perfume_name: parsed.perfumeName || value, size_ml: parsed.sizeMl })
      setSearchResult(result)
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
    setLoading(true)
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
