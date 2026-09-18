import { useEffect, useState } from 'react'
import { FISCAL_DOCUMENT_TYPE_LABEL, FISCAL_STATUS_LABEL, FiscalDocument, FiscalDocumentStatus, fetchFiscalDocuments } from '../lib/fiscal'
import { PageHeader, StatusBadge } from '../components/ui'
import './FiscalPage.css'

const STATUS_TONE: Record<FiscalDocumentStatus, 'success' | 'warning' | 'danger' | 'neutral'> = {
  draft: 'neutral', requested: 'neutral', processing: 'warning', authorized: 'success', rejected: 'danger', cancelled: 'neutral', failed: 'danger',
}
const STATUS_FILTERS: { key: 'all' | FiscalDocumentStatus; label: string }[] = [
  { key: 'all', label: 'Todos' }, { key: 'requested', label: 'Solicitados' }, { key: 'authorized', label: 'Autorizados' },
  { key: 'rejected', label: 'Rejeitados' }, { key: 'failed', label: 'Falharam' }, { key: 'cancelled', label: 'Cancelados' },
]

/** /fiscal — lista operacional, não contabilidade completa (briefing §49/§50). */
export function FiscalPage() {
  const [documents, setDocuments] = useState<FiscalDocument[] | null>(null)
  const [statusFilter, setStatusFilter] = useState<'all' | FiscalDocumentStatus>('all')

  useEffect(() => {
    fetchFiscalDocuments(statusFilter === 'all' ? {} : { status: [statusFilter] }).then(setDocuments).catch(() => setDocuments([]))
  }, [statusFilter])

  return <div className="page">
    <PageHeader eyebrow="FISCAL" title="Documentos fiscais" description="Documentos fiscais emitidos por esta organização." />
    <div className="fiscal-tabs">
      {STATUS_FILTERS.map((f) => <button key={f.key} className={statusFilter === f.key ? 'active' : ''} onClick={() => setStatusFilter(f.key)}>{f.label}</button>)}
    </div>
    {documents === null ? <p>Carregando…</p> : documents.length === 0 ? (
      <div className="empty card"><h3>Nenhum documento fiscal ainda.</h3><p>Emita uma NFS-e a partir da Venda 360.</p></div>
    ) : (
      <div className="fiscal-list">
        {documents.map((doc) => (
          <div key={doc.id} className="card fiscal-row">
            <span>{FISCAL_DOCUMENT_TYPE_LABEL[doc.documentType]}{doc.number ? ` #${doc.number}` : ''}</span>
            <span>{doc.totalAmount.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}</span>
            <StatusBadge tone={STATUS_TONE[doc.status]}>{FISCAL_STATUS_LABEL[doc.status].toUpperCase()}</StatusBadge>
            <small>{doc.environment === 'production' ? 'PRODUÇÃO' : 'SANDBOX'}</small>
            <em>{new Date(doc.createdAt).toLocaleDateString('pt-BR')}</em>
          </div>
        ))}
      </div>
    )}
  </div>
}
