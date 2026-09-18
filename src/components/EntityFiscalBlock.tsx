import { useEffect, useState } from 'react'
import { FileText, Send } from 'lucide-react'
import {
  FISCAL_DOCUMENT_TYPE_LABEL, FISCAL_STATUS_LABEL, FiscalDocument, cancelFiscalDocument, fetchFiscalDocumentsForSale, requestFiscalDocument,
} from '../lib/fiscal'
import { Modal, PrimaryButton, SecondaryButton, StatusBadge } from './ui'
import { useHasPermission } from '../lib/PermissionsContext'
import './EntityTasksBlock.css'

const STATUS_TONE: Record<FiscalDocument['status'], 'success' | 'warning' | 'danger' | 'neutral'> = {
  draft: 'neutral', requested: 'neutral', processing: 'warning', authorized: 'success', rejected: 'danger', cancelled: 'neutral', failed: 'danger',
}

/**
 * Bloco Fiscal da Venda 360 (briefing §47). Nunca decide sozinho o
 * tipo de documento pelo item da venda (briefing §17) — sempre NFS-e
 * nesta sprint, com preview antes de emitir (briefing §18).
 */
export function EntityFiscalBlock({ saleId, saleTotal }: { saleId: string; saleTotal: number }) {
  const [documents, setDocuments] = useState<FiscalDocument[] | null>(null)
  const [previewOpen, setPreviewOpen] = useState(false)
  const [issuing, setIssuing] = useState(false)
  const [error, setError] = useState('')
  const canIssue = useHasPermission('fiscal.issue')
  const canCancel = useHasPermission('fiscal.cancel')

  const load = () => { fetchFiscalDocumentsForSale(saleId).then(setDocuments).catch(() => setDocuments([])) }
  useEffect(load, [saleId])

  const issue = async () => {
    setIssuing(true)
    setError('')
    try { await requestFiscalDocument(saleId, 'nfse'); setPreviewOpen(false); load() }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'Não foi possível emitir a NFS-e.') }
    finally { setIssuing(false) }
  }

  const cancel = async (documentId: string) => {
    if (!confirm('Cancelar esta NFS-e?')) return
    try { await cancelFiscalDocument(documentId); load() }
    catch (reason) { alert(reason instanceof Error ? reason.message : 'Não foi possível cancelar.') }
  }

  const activeDocument = documents?.find((d) => d.status !== 'cancelled' && d.status !== 'failed')

  return <section className="entity-tasks-block">
    {previewOpen && (
      <Modal open onClose={() => setPreviewOpen(false)} eyebrow="FISCAL" title="Emitir NFS-e" footer={<>
        <SecondaryButton onClick={() => setPreviewOpen(false)}>Cancelar</SecondaryButton>
        <PrimaryButton loading={issuing} onClick={issue}><Send size={15} />Emitir NFS-e</PrimaryButton>
      </>}>
        <div className="team-modal">
          {error && <div className="notice"><span>{error}</span></div>}
          <p>Uma NFS-e será solicitada para esta venda, no ambiente configurado (Sandbox/Produção) em Configurações → Fiscal.</p>
          <p><strong>Valor:</strong> {saleTotal.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}</p>
          <p style={{ color: 'var(--muted)', fontSize: 'var(--fs-sm)' }}>Emitir de novo enquanto esta solicitação estiver em aberto não cria uma segunda nota.</p>
        </div>
      </Modal>
    )}

    <header><strong>Fiscal</strong>
      {canIssue && !activeDocument && <SecondaryButton icon={<FileText size={14} />} onClick={() => setPreviewOpen(true)}>Emitir NFS-e</SecondaryButton>}
    </header>

    {documents === null ? <p className="entity-tasks-empty">Carregando…</p> : documents.length === 0 ? (
      <p className="entity-tasks-empty">Nenhum documento fiscal emitido.</p>
    ) : (
      <div className="entity-tasks-list">
        {documents.map((doc) => (
          <div key={doc.id} className="entity-task-row" style={{ cursor: 'default' }}>
            <span>{FISCAL_DOCUMENT_TYPE_LABEL[doc.documentType]}{doc.number ? ` #${doc.number}` : ''}</span>
            <span className="entity-task-row-meta">
              <StatusBadge tone={STATUS_TONE[doc.status]}>{FISCAL_STATUS_LABEL[doc.status].toUpperCase()}</StatusBadge>
              <small>{doc.environment === 'production' ? 'PRODUÇÃO' : 'SANDBOX'}</small>
              {doc.status === 'authorized' && canCancel && <button style={{ background: 'none', border: 'none', color: 'var(--muted)', cursor: 'pointer', textDecoration: 'underline' }} onClick={() => cancel(doc.id)}>Cancelar</button>}
            </span>
          </div>
        ))}
      </div>
    )}
  </section>
}
