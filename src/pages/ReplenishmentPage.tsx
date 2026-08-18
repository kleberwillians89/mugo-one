import { useEffect, useMemo, useState } from 'react'
import { AlertTriangle, ArrowLeft, Compass, Radar as RadarIcon, Sparkles } from 'lucide-react'
import {
  ReplenishmentSignal, ReplenishmentStatus, STATUS_LABEL, buildRadarQuery, fetchReplenishmentSignals,
  formatReplenishmentSummary, goToRadarWithQuery, summarizeReplenishment,
} from '../lib/replenishment'
import { RadarOffer, RadarWatchItem, fetchOffersForPerfume, fetchWatchlist } from '../lib/radar'
import { EmptyState, PageHeader, PrimaryButton, SecondaryButton, StatusBadge } from '../components/ui'
import './ReplenishmentPage.css'

type Tab = 'repor'|'atencao'|'todos'

const STATUS_TONE:Record<ReplenishmentStatus,'success'|'warning'|'danger'|'neutral'> = {
  critico: 'danger', repor: 'warning', atencao: 'warning', saudavel: 'success', sem_dados: 'neutral',
}

function goToInventory() {
  history.pushState({}, '', '/estoque')
  dispatchEvent(new PopStateEvent('popstate'))
}

function timeAgo(iso:string|null) {
  if (!iso) return null
  const hours = Math.floor((Date.now() - new Date(iso).getTime()) / 3_600_000)
  if (hours < 1) return 'há poucos minutos'
  if (hours < 24) return `há ${hours}h`
  return `há ${Math.floor(hours / 24)}d`
}

export function ReplenishmentPage() {
  const [signals, setSignals] = useState<ReplenishmentSignal[]>([])
  const [watchlist, setWatchlist] = useState<RadarWatchItem[]>([])
  const [offers, setOffers] = useState<RadarOffer[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [tab, setTab] = useState<Tab>('repor')

  useEffect(() => {
    // Três chamadas no total, nunca uma por perfume (item 24): sinais, watchlist e ofertas
    // já vêm completos e são cruzados aqui só por perfume_id, em memória.
    Promise.all([fetchReplenishmentSignals(), fetchWatchlist(), fetchOffersForPerfume({})])
      .then(([signalRows, watchRows, offerRows]) => { setSignals(signalRows); setWatchlist(watchRows); setOffers(offerRows); setError('') })
      .catch((reason) => setError(reason instanceof Error ? reason.message : 'Não foi possível carregar a reposição inteligente.'))
      .finally(() => setLoading(false))
  }, [])

  const watchByPerfume = useMemo(() => {
    const map = new Map<string, RadarWatchItem>()
    for (const item of watchlist) if (item.perfume_id) map.set(item.perfume_id, item)
    return map
  }, [watchlist])

  const offersByPerfume = useMemo(() => {
    const map = new Map<string, RadarOffer[]>()
    for (const offer of offers) {
      if (!offer.perfume_id) continue
      const list = map.get(offer.perfume_id) ?? []
      list.push(offer)
      map.set(offer.perfume_id, list)
    }
    return map
  }, [offers])

  const counts = useMemo(() => ({
    repor: signals.filter((s) => s.status === 'critico' || s.status === 'repor').length,
    atencao: signals.filter((s) => s.status === 'atencao').length,
  }), [signals])

  const visible = useMemo(() => {
    if (tab === 'repor') return signals.filter((s) => s.status === 'critico' || s.status === 'repor')
    if (tab === 'atencao') return signals.filter((s) => s.status === 'atencao')
    return signals
  }, [signals, tab])

  return <div className="page replenishment-page">
    <button className="back-link" onClick={goToInventory}><ArrowLeft size={14} /> Voltar para o estoque</button>
    <PageHeader eyebrow="RUAH INTELLIGENCE" title="Reposição Inteligente" description="Perfumes que merecem atenção com base no estoque e nas vendas recentes." />

    <div className="replenishment-tabs">
      <button className={tab === 'repor' ? 'active' : ''} onClick={() => setTab('repor')}>Precisa repor ({counts.repor})</button>
      <button className={tab === 'atencao' ? 'active' : ''} onClick={() => setTab('atencao')}>Atenção ({counts.atencao})</button>
      <button className={tab === 'todos' ? 'active' : ''} onClick={() => setTab('todos')}>Todos ({signals.length})</button>
    </div>

    {error && <div className="notice"><AlertTriangle /><span>{error}</span></div>}
    {loading ? <div className="empty card"><h3>Calculando sinais de reposição…</h3></div> :
      visible.length === 0 ? <EmptyState icon={Compass} title="Nada por aqui" description="Nenhum perfume nesta categoria no momento." /> :
        <div className="replenishment-grid">
          {visible.map((signal) => <ReplenishmentCard key={signal.item_id} signal={signal}
            watch={signal.perfume_id ? watchByPerfume.get(signal.perfume_id) ?? null : null}
            relatedOffers={signal.perfume_id ? offersByPerfume.get(signal.perfume_id) ?? [] : []} />)}
        </div>}
  </div>
}

function ReplenishmentCard({ signal, watch, relatedOffers }:{ signal:ReplenishmentSignal; watch:RadarWatchItem|null; relatedOffers:RadarOffer[] }) {
  const [summary, setSummary] = useState<string>(() => formatReplenishmentSummary(signal))
  const [summarizing, setSummarizing] = useState(false)

  const trustedOffers = relatedOffers.filter((offer) => offer.source_trusted)
  const mostRecentCheck = relatedOffers.reduce<string|null>((latest, offer) => (!latest || offer.last_checked_at > latest ? offer.last_checked_at : latest), null)

  async function handleSearchIntelligence() {
    setSummarizing(true)
    try { setSummary((await summarizeReplenishment(signal.item_id)).resumo) }
    catch { /* mantém o resumo determinístico já exibido */ }
    finally { setSummarizing(false) }
  }

  return <article className="replenishment-card">
    <header>
      <div>
        <strong>{signal.base_name || signal.perfume}</strong>
        {signal.brand_house && <span className="replenishment-brand">{signal.brand_house}</span>}
      </div>
      <StatusBadge tone={STATUS_TONE[signal.status]}>{STATUS_LABEL[signal.status]}</StatusBadge>
    </header>

    <div className="replenishment-stats">
      <span>{Number(signal.available_ml).toLocaleString('pt-BR')} ml disponíveis</span>
      {signal.ml_30d > 0 && <span>{Number(signal.ml_30d).toLocaleString('pt-BR')} ml vendidos nos últimos 30 dias</span>}
      {signal.coverage_days != null && <span>Cobertura estimada: {Math.round(signal.coverage_days)} dia{Math.round(signal.coverage_days) === 1 ? '' : 's'}</span>}
    </div>

    <p className="replenishment-summary">{summary}</p>

    {relatedOffers.length > 0 && <p className="replenishment-offers-note">
      {relatedOffers.length} oportunidade{relatedOffers.length === 1 ? '' : 's'} salva{relatedOffers.length === 1 ? '' : 's'} no Radar
      {trustedOffers.length > 0 && ` (${trustedOffers.length} de fonte${trustedOffers.length === 1 ? '' : 's'} confiável)`}
      {mostRecentCheck && ` — atualizado ${timeAgo(mostRecentCheck)}`}.
    </p>}

    <footer className="replenishment-actions">
      <PrimaryButton onClick={() => goToRadarWithQuery(buildRadarQuery(signal))}>Buscar reposição</PrimaryButton>
      {watch ? <StatusBadge tone="neutral">JÁ MONITORADO</StatusBadge> :
        <SecondaryButton icon={<RadarIcon size={14} />} onClick={() => goToRadarWithQuery(buildRadarQuery(signal))}>Acompanhar no Radar</SecondaryButton>}
      <SecondaryButton icon={<Sparkles size={14} />} loading={summarizing} onClick={handleSearchIntelligence}>Gerar análise RUAH Intelligence</SecondaryButton>
    </footer>
  </article>
}
