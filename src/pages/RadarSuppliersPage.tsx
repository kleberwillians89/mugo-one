import { useEffect, useMemo, useState } from 'react'
import { AlertTriangle, ArrowLeft, Building2, Download, Plus } from 'lucide-react'
import {
  RadarOffer, RadarSource, RadarSourceType, createSource, fetchOffersForPerfume, fetchRadarRole,
  fetchSources, formatSeedResult, seedInitialSources,
} from '../lib/radar'
import { EmptyState, Modal, PageHeader, PrimaryButton, SecondaryButton, StatusBadge, Table } from '../components/ui'
import './RadarSuppliersPage.css'

const SOURCE_TYPE_TAG: Record<RadarSourceType, string> = {
  official_brand: 'OFICIAL', authorized_retailer: 'REVENDEDOR AUTORIZADO',
  retailer: 'REVENDEDOR', distributor: 'DISTRIBUIDOR', marketplace: 'MARKETPLACE', manual: 'MANUAL',
}

const COUNTRY_NAME: Record<string, string> = {
  OM: 'Omã', IT: 'Itália', FR: 'França', GB: 'Reino Unido', US: 'Estados Unidos',
  DE: 'Alemanha', ES: 'Espanha', AE: 'Emirados Árabes', BR: 'Brasil',
}
const countryName = (code:string|null) => (code ? COUNTRY_NAME[code] ?? code : '—')

function goToRadar() {
  history.pushState({}, '', '/radar')
  dispatchEvent(new PopStateEvent('popstate'))
}

export function RadarSuppliersPage() {
  const [sources, setSources] = useState<RadarSource[]>([])
  const [offers, setOffers] = useState<RadarOffer[]>([])
  const [role, setRole] = useState<'admin'|'manager'|'operator'|'viewer'|null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [showCreate, setShowCreate] = useState(false)
  const [showSeedConfirm, setShowSeedConfirm] = useState(false)
  const [seeding, setSeeding] = useState(false)
  const [seedMessage, setSeedMessage] = useState('')

  const load = () => Promise.all([fetchSources(), fetchOffersForPerfume({}), fetchRadarRole()])
    .then(([sourceRows, offerRows, currentRole]) => { setSources(sourceRows); setOffers(offerRows); setRole(currentRole); setError('') })
    .catch((reason) => setError(reason instanceof Error ? reason.message : 'Não foi possível carregar os fornecedores.'))
    .finally(() => setLoading(false))
  const reload = () => { setLoading(true); load() }
  useEffect(() => { load() }, [])

  const canManageSources = role === 'admin' || role === 'manager'

  const stats = useMemo(() => {
    const map = new Map<string, { count:number; lastChecked:string|null }>()
    for (const offer of offers) {
      if (!offer.source_id) continue
      const current = map.get(offer.source_id) ?? { count: 0, lastChecked: null }
      current.count += 1
      if (!current.lastChecked || offer.last_checked_at > current.lastChecked) current.lastChecked = offer.last_checked_at
      map.set(offer.source_id, current)
    }
    return map
  }, [offers])

  async function handleSeed() {
    setSeeding(true); setError('')
    try {
      const result = await seedInitialSources()
      setSeedMessage(formatSeedResult(result))
      setShowSeedConfirm(false)
      reload()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Não foi possível carregar as fontes iniciais.')
    } finally {
      setSeeding(false)
    }
  }

  return <div className="page radar-suppliers-page">
    {showCreate && <RadarSourceCreate close={() => setShowCreate(false)} saved={() => { setShowCreate(false); reload() }} />}
    {showSeedConfirm && <Modal open onClose={() => setShowSeedConfirm(false)} eyebrow="RADAR GLOBAL" title="Adicionar as fontes internacionais recomendadas ao Radar?" footer={<>
      <SecondaryButton onClick={() => setShowSeedConfirm(false)}>Cancelar</SecondaryButton>
      <PrimaryButton loading={seeding} onClick={handleSeed}>Adicionar fontes</PrimaryButton>
    </>}>
      <p>Isso cadastra 8 fontes confiáveis (marcas oficiais e revendedores conhecidos) já classificadas. Fontes que você já tenha cadastrado com o mesmo domínio não são duplicadas — suas observações são preservadas.</p>
    </Modal>}
    <button className="back-link" onClick={goToRadar}><ArrowLeft size={14} /> Voltar para o radar</button>
    <PageHeader eyebrow="RADAR GLOBAL" title="Fornecedores" description="Fontes cadastradas para as ofertas do radar, com nível de confiança e histórico de consultas." actions={<>
      {canManageSources && <SecondaryButton icon={<Download size={16} />} onClick={() => setShowSeedConfirm(true)}>Carregar fontes iniciais</SecondaryButton>}
      <PrimaryButton icon={<Plus size={16} />} onClick={() => setShowCreate(true)}>Cadastrar fonte</PrimaryButton>
    </>} />
    {seedMessage && <div className="notice"><Building2 size={16} /><span>{seedMessage}</span></div>}
    {error && <div className="notice"><AlertTriangle /><span>{error}</span></div>}
    {loading ? <div className="empty card"><h3>Carregando fornecedores…</h3></div> :
      sources.length === 0 ? <EmptyState icon={Building2} title="Nenhuma fonte cadastrada" description="Cadastre lojas, distribuidores ou marketplaces para organizar as ofertas do radar." action={{ label: canManageSources ? 'Carregar fontes iniciais' : 'Cadastrar primeira fonte', onClick: () => (canManageSources ? setShowSeedConfirm(true) : setShowCreate(true)) }} /> :
        <div className="card clients-table"><div className="clients-caption"><strong>{sources.length} fontes</strong></div>
          <Table rowKey={(source) => source.id} rows={sources} columns={[
            { key: 'name', label: 'Nome', render: (source) => <strong>{source.name.toUpperCase()}</strong> },
            { key: 'country', label: 'País', render: (source) => countryName(source.country_code) },
            { key: 'domain', label: 'Site', render: (source) => source.domain ?? '—' },
            { key: 'type', label: 'Tipo', render: (source) => <StatusBadge tone={source.source_type === 'official_brand' ? 'success' : source.source_type === 'marketplace' ? 'neutral' : 'warning'}>{SOURCE_TYPE_TAG[source.source_type]}</StatusBadge> },
            { key: 'trusted', label: 'Confiança', render: (source) => <StatusBadge tone={source.trusted ? 'success' : 'neutral'}>{source.trusted ? 'CONFIÁVEL' : 'A AVALIAR'}</StatusBadge> },
            { key: 'opportunities', label: 'Oportunidades', align: 'right', render: (source) => String(stats.get(source.id)?.count ?? 0) },
            { key: 'last_checked', label: 'Última consulta', render: (source) => { const last = stats.get(source.id)?.lastChecked; return last ? new Date(last).toLocaleString('pt-BR') : 'Nunca' } },
          ]} />
        </div>}
  </div>
}

function RadarSourceCreate({ close, saved }:{ close:()=>void; saved:()=>void }) {
  const [name, setName] = useState('')
  const [domain, setDomain] = useState('')
  const [countryCode, setCountryCode] = useState('')
  const [sourceType, setSourceType] = useState<RadarSourceType>('retailer')
  const [trusted, setTrusted] = useState(false)
  const [notes, setNotes] = useState('')
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)

  const submit = async () => {
    if (!name.trim()) { setError('Informe o nome da fonte.'); return }
    setSaving(true); setError('')
    try {
      await createSource({ name: name.trim(), domain: domain.trim() || undefined, country_code: countryCode.trim() || undefined, source_type: sourceType, trusted, notes: notes.trim() || undefined })
      saved()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Não foi possível cadastrar esta fonte.')
    } finally {
      setSaving(false)
    }
  }

  return <Modal open onClose={close} eyebrow="FORNECEDORES" title="Cadastrar fonte" footer={<>
    <SecondaryButton onClick={close}>Cancelar</SecondaryButton>
    <PrimaryButton loading={saving} onClick={submit}>Cadastrar</PrimaryButton>
  </>}>
    <div className="record-form"><div className="form-grid">
      <label className="field wide"><span>Nome</span><input value={name} onChange={(event) => setName(event.target.value)} /></label>
      <label className="field"><span>Domínio</span><input value={domain} onChange={(event) => setDomain(event.target.value)} placeholder="loja.com" /></label>
      <label className="field"><span>País (código, ex.: FR)</span><input value={countryCode} onChange={(event) => setCountryCode(event.target.value)} maxLength={2} /></label>
      <label className="field"><span>Tipo</span>
        <select value={sourceType} onChange={(event) => setSourceType(event.target.value as RadarSourceType)}>
          <option value="official_brand">Marca oficial</option>
          <option value="authorized_retailer">Revendedor autorizado</option>
          <option value="retailer">Revendedor</option>
          <option value="distributor">Distribuidor</option>
          <option value="marketplace">Marketplace</option>
          <option value="manual">Manual</option>
        </select>
      </label>
      <label className="field checkbox-field"><input type="checkbox" checked={trusted} onChange={(event) => setTrusted(event.target.checked)} /><span>Fonte confiável</span></label>
      <label className="field wide"><span>Observações</span><textarea value={notes} onChange={(event) => setNotes(event.target.value)} /></label>
    </div>{error && <div className="form-error">{error}</div>}</div>
  </Modal>
}
