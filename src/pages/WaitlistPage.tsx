import { useEffect, useState } from 'react'
import { Plus, Search, UserRound } from 'lucide-react'
import { authenticatedOrganization, inventoryPerfumes, searchClients } from '../lib/records'
import { WaitlistEntry, addWaitlistEntry, fetchWaitlistQueue, setWaitlistStatus } from '../lib/waitlist'
import { formatMl } from '../lib/bottle-scan'
import { EmptyState, Modal, PageHeader, PrimaryButton, SecondaryButton, StatusBadge, Table } from '../components/ui'
import './WaitlistPage.css'

/** Roadmap Fase 6 — "Quem está esperando perfume?" (rota /interessados, uma das citadas explicitamente no briefing). */
export function WaitlistPage() {
  const [entries, setEntries] = useState<WaitlistEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [showAdd, setShowAdd] = useState(false)
  const [canManage, setCanManage] = useState(false)

  const reload = () => { fetchWaitlistQueue().then(setEntries).catch((reason) => setError(reason instanceof Error ? reason.message : 'Não foi possível carregar a lista de espera.')).finally(() => setLoading(false)) }
  useEffect(reload, [])
  useEffect(() => { authenticatedOrganization().then((org) => setCanManage(['admin', 'manager', 'operator'].includes(org.role))).catch(() => {}) }, [])

  async function updateStatus(entry: WaitlistEntry, status: 'notified' | 'fulfilled' | 'cancelled') {
    try { await setWaitlistStatus(entry.entry_id, status); reload() }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'Não foi possível atualizar.') }
  }

  const ready = entries.filter((e) => e.ready).length

  return <div className="page">
    {showAdd && <AddWaitlistEntry close={() => setShowAdd(false)} saved={() => { setShowAdd(false); reload() }} />}
    <PageHeader eyebrow="RUAH INTELLIGENCE" title="Interessados" description="Clientes esperando um perfume voltar ao estoque." actions={
      canManage ? <PrimaryButton icon={<Plus size={16} />} onClick={() => setShowAdd(true)}>Adicionar à lista</PrimaryButton> : undefined
    } />
    {error && <div className="notice"><span>{error}</span></div>}
    {loading ? <div className="empty card"><h3>Carregando interessados…</h3></div> :
      entries.length === 0 ? <EmptyState icon={UserRound} title="Nenhum interessado na lista" description="Quando um cliente quiser um perfume fora de estoque, adicione-o aqui." action={canManage ? { label: 'Adicionar à lista', onClick: () => setShowAdd(true) } : undefined} /> :
      <div className="card clients-table">
        <div className="clients-caption"><strong>{entries.length} interessado{entries.length === 1 ? '' : 's'}</strong><span>{ready} pronto{ready === 1 ? '' : 's'} para avisar</span></div>
        <Table rowKey={(e) => e.entry_id} rows={entries} columns={[
          { key: 'client', label: 'Cliente', render: (e) => <strong>{e.client_name}</strong> },
          { key: 'perfume', label: 'Perfume', render: (e) => <>{e.brand_house ? `${e.brand_house} — ` : ''}{e.perfume_name}</> },
          { key: 'requested', label: 'Quantidade', render: (e) => formatMl(e.requested_ml) },
          { key: 'status', label: 'Status', render: (e) => e.ready ? <StatusBadge tone="success">PRONTO</StatusBadge> : e.status === 'notified' ? <StatusBadge tone="neutral">AVISADO</StatusBadge> : <StatusBadge tone="warning">AGUARDANDO</StatusBadge> },
          { key: 'actions', label: 'Ações', hideOnMobile: !canManage, render: (e) => canManage ? <div className="stock-actions">
            {e.status === 'waiting' && <button onClick={() => updateStatus(e, 'notified')}>Marcar avisado</button>}
            <button onClick={() => updateStatus(e, 'fulfilled')}>Atendido</button>
            <button onClick={() => updateStatus(e, 'cancelled')}>Cancelar</button>
          </div> : null },
        ]} />
      </div>}
  </div>
}

function AddWaitlistEntry({ close, saved }: { close: () => void; saved: () => void }) {
  const [query, setQuery] = useState('')
  const [clients, setClients] = useState<{ id: string; name: string }[]>([])
  const [client, setClient] = useState<{ id: string; name: string } | null>(null)
  const [perfumes, setPerfumes] = useState<{ id: string; full_name_raw: string }[]>([])
  const [perfumeId, setPerfumeId] = useState('')
  const [ml, setMl] = useState('')
  const [notes, setNotes] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => { inventoryPerfumes().then(setPerfumes) }, [])
  useEffect(() => {
    if (query.trim().length < 2 || client) return
    const timer = setTimeout(() => searchClients(query).then(setClients).catch(() => setClients([])), 250)
    return () => clearTimeout(timer)
  }, [query, client])

  async function submit() {
    const requestedMl = Number(ml.replace(',', '.'))
    if (!client) return setError('Selecione um cliente.')
    if (!perfumeId) return setError('Selecione um perfume.')
    if (!Number.isFinite(requestedMl) || requestedMl <= 0) return setError('Informe uma quantidade válida.')
    setSaving(true); setError('')
    try { await addWaitlistEntry(client.id, perfumeId, requestedMl, notes); saved() }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'Não foi possível adicionar à lista.') }
    finally { setSaving(false) }
  }

  return <Modal open onClose={close} eyebrow="INTERESSADOS" title="Adicionar à lista de espera" footer={<>
    <SecondaryButton onClick={close}>Cancelar</SecondaryButton>
    <PrimaryButton loading={saving} onClick={submit}>Adicionar</PrimaryButton>
  </>}>
    <div className="record-form"><div className="form-grid">
      <div className="field wide client-search">
        <span>Cliente</span>
        <div className="search-control"><Search size={16} /><input value={query} placeholder="Busque pelo nome" onChange={(event) => { setQuery(event.target.value); setClient(null) }} /></div>
        {!client && clients.length > 0 && <div className="client-results">{clients.map((c) => <button type="button" key={c.id} onClick={() => { setClient(c); setQuery(c.name); setClients([]) }}>{c.name}</button>)}</div>}
      </div>
      <label className="field wide"><span>Perfume</span>
        <select value={perfumeId} onChange={(event) => setPerfumeId(event.target.value)}>
          <option value="">Selecione…</option>
          {perfumes.map((perfume) => <option key={perfume.id} value={perfume.id}>{perfume.full_name_raw}</option>)}
        </select>
      </label>
      <label className="field"><span>Quantidade desejada (ml)</span><input inputMode="decimal" value={ml} onChange={(event) => setMl(event.target.value)} /></label>
      <label className="field wide"><span>Observações</span><textarea value={notes} onChange={(event) => setNotes(event.target.value)} /></label>
    </div>{error && <div className="form-error">{error}</div>}</div>
  </Modal>
}
