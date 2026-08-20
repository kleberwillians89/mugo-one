import { ChangeEvent, useState } from 'react'
import { AlertTriangle, ArrowUpRight, Check, FileSpreadsheet, UploadCloud, X } from 'lucide-react'
import { brl, integer } from '../lib/format'
import { ImportPreview, ParsedSale, readWorkbook } from '../lib/importer'
import { statusLabel } from '../lib/presentation'
import { PageHeader } from '../components/ui'

export function ImportPage() {
  const [preview, setPreview] = useState<ImportPreview | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const handleFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file) return
    setLoading(true); setError('')
    try {
      const result = await readWorkbook(file)
      setPreview(result.preview)
    } catch { setError('Não foi possível ler o arquivo. Verifique o formato e tente novamente.') }
    finally { setLoading(false) }
  }
  return <div className="page">
    <PageHeader eyebrow="DADOS E QUALIDADE" title="Importar dados comerciais" description="Valide cada linha antes de levar as vendas ao Supabase." />
    {!preview ? <label className="dropzone">
      <input type="file" accept=".xlsx,.csv" onChange={handleFile}/>
      <div className="upload-icon"><UploadCloud/></div>
      <h3>{loading ? 'Lendo planilha…' : 'Arraste sua planilha ou clique para selecionar'}</h3>
      <p>Arquivos XLSX ou CSV · o arquivo original nunca será alterado</p>
      <span className="primary"><FileSpreadsheet size={17}/> Selecionar arquivo</span>
      {error && <em>{error}</em>}
    </label> : <ImportReview preview={preview} reset={() => setPreview(null)} />}
    <div className="security-note"><div><Check size={17}/></div><p><strong>Importação protegida</strong><span>Nenhuma venda será inserida antes da sua confirmação. Em produção, o arquivo fica em bucket privado.</span></p></div>
  </div>
}

function ImportReview({ preview, reset }: { preview: ImportPreview; reset: () => void }) {
  const [filter, setFilter] = useState<'all'|'valid'|'error'>('all')
  const rows = preview.rows.filter((r) => filter === 'all' || (filter === 'valid' ? r.isAccountable : !r.isAccountable))
  return <div className="import-review">
    <div className="file-line card"><div className="file-icon"><FileSpreadsheet/></div><div><strong>{preview.fileName}</strong><span>{preview.sheets.length} abas · aba selecionada: {preview.selectedSheet}</span></div><button onClick={reset}><X size={18}/></button></div>
    <div className="import-steps"><span className="done"><Check/> Arquivo</span><i/><span className="current">2</span><b>Validar</b><i/><span>3</span><b>Confirmar</b></div>
    <section className="import-stats">
      <div><span>Linhas lidas</span><strong>{integer(preview.totalRows)}</strong></div>
      <div className="success"><span>Importáveis</span><strong>{integer(preview.valid)}</strong></div>
      <div className="danger"><span>Impossíveis</span><strong>{integer(preview.rejected)}</strong></div>
      <div className="warning"><span>Duplicidades</span><strong>{integer(preview.duplicates)}</strong></div>
      <div><span>Clientes</span><strong>{integer(preview.uniqueClients)}</strong></div>
      <div><span>Volume bruto</span><strong>{brl(preview.importedValue)}</strong></div>
    </section>
    <div className="card preview-card">
      <div className="preview-head"><div><h3>Prévia da validação</h3><p>Confira alertas antes de confirmar.</p></div>
        <div className="tabs">{(['all','valid','error'] as const).map((x)=><button className={filter===x?'selected':''} onClick={()=>setFilter(x)} key={x}>{x==='all'?'Todas':x==='valid'?'Válidas':'Revisar'}</button>)}</div>
      </div>
      <div className="table-wrap"><table><thead><tr><th>Linha</th><th>Cliente</th><th>Data</th><th>Valor</th><th>Status</th><th>Pagamento</th><th>Validação</th></tr></thead>
        <tbody>{rows.slice(0,25).map((r)=><PreviewRow key={r.row} row={r}/>)}</tbody></table></div>
      <div className="table-foot"><span>Exibindo {Math.min(rows.length,25)} de {integer(rows.length)} linhas</span><button className="primary" disabled={preview.valid === 0}>Confirmar linhas válidas <ArrowUpRight size={16}/></button></div>
    </div>
  </div>
}

function PreviewRow({ row }: { row: ParsedSale }) {
  const issues = [...row.blockers, ...row.warnings]
  return <tr><td>{row.row}</td><td><strong>{row.client || '—'}</strong></td><td>{row.date || '—'}</td><td>{row.amount === null ? '—' : brl(row.amount)}</td><td><span className={`badge ${row.paymentStatus}`}>{statusLabel[row.paymentStatus]}</span></td><td>{row.paymentMethod || '—'}</td><td>{issues.length ? <span className="row-error"><AlertTriangle/> {issues.join(', ')}</span> : <span className="row-ok"><Check/> Contabilizável</span>}</td></tr>
}
