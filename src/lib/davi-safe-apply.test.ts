import{readFileSync}from'node:fs'
import{describe,expect,it}from'vitest'
import{canonicalDaviSafeCandidates,daviSafeApplyCandidates,fingerprintDaviSafeCandidates,incompleteDaviRows,safeDaviRows,type DaviDiagnosticReport,type DaviDiagnosticRow,type DaviSafeApplyCandidate,validateDaviSafeDiagnosticRow}from'./davi-import-diagnostics'

const migration=readFileSync('supabase/migrations/202609040003_davi_safe_diagnostic_apply.sql','utf8')
const component=readFileSync('src/components/DaviImportDiagnostics.tsx','utf8')
const page=readFileSync('src/pages/DaviExcelPage.tsx','utf8')
const baseRow: DaviDiagnosticRow={source_row:2,client:'Cliente',perfume:'Perfume',type:'split',ml:5,amount:50,date:'2026-09-01',identity_classification:'NEW_SALE',sale_id:null,candidate_sale_ids:[],reason:'Sem correspondência.',confidence:.95,action:'criar_apos_aprovacao',stock_classification:'STOCK_NOT_REQUIRED',stock_reason:'Sem estoque necessário.',inventory:null,proposed_changes:{},organization_id:'00000000-0000-4000-8000-000000000001',source_signature:'sig-2',normalized_client:'cliente',normalized_perfume:'perfume',payment_status:'pending'}
const report=(rows:DaviDiagnosticRow[],patch:Partial<DaviDiagnosticReport>={})=>({organization_id:'00000000-0000-4000-8000-000000000001',source_sha256:'a'.repeat(64),file_name:'davi.csv',snapshot_complete:true,snapshot_signature:'sig',snapshot_created_at:'2026-09-04T12:00:00Z',rows,...patch}as unknown as DaviDiagnosticReport)
const candidate=(patch:Partial<DaviSafeApplyCandidate>={}):DaviSafeApplyCandidate=>({...daviSafeApplyCandidates(report([baseRow]))[0],...patch})

describe('Davi safe diagnostic apply',()=>{
 it('exclui da contagem a linha segura sem fingerprint ou snapshot esperado',()=>{
  const incomplete={...baseRow,source_signature:null}
  expect(validateDaviSafeDiagnosticRow(incomplete,report([incomplete]))).toEqual({ok:false,reason:'Dados comerciais obrigatórios ausentes ou inválidos.'})
  expect(safeDaviRows(report([incomplete]))).toEqual([])
  expect(incompleteDaviRows(report([incomplete])).map(row=>row.source_row)).toEqual([2])
  expect(incompleteDaviRows(report([{...incomplete,identity_classification:'PROBABLE_DUPLICATE',stock_classification:null}]))).toEqual([])
  expect(()=>daviSafeApplyCandidates(report([incomplete]))).not.toThrow()
  const staleUpdate={...baseRow,identity_classification:'EXACT_EXISTING' as const,sale_id:'00000000-0000-4000-8000-000000000002',resolved_client_id:'00000000-0000-4000-8000-000000000003',resolved_perfume_id:'00000000-0000-4000-8000-000000000004',expected_payment_status:'pending',proposed_changes:{payment_status:{before:'pending',after:'paid'}}}
  expect(safeDaviRows(report([staleUpdate]))).toEqual([])
 })
 it('bloqueia todos os candidatos quando o snapshot está incompleto ou mudou durante a leitura',()=>{
  expect(safeDaviRows(report([baseRow],{snapshot_complete:false}))).toEqual([])
  expect(safeDaviRows(report([baseRow],{snapshot_complete:false,source_sha256:'f'.repeat(63)}))).toEqual([])
 })
 it('todo candidato contado como seguro monta payload sem falhar',()=>{
  const rows=safeDaviRows(report([baseRow]))
  expect(rows).toHaveLength(1)
  expect(()=>daviSafeApplyCandidates(report(rows))).not.toThrow()
 })
 it('preserva literalmente o gate atual e exclui duplicidade, conflito, inválida e falhas de estoque',()=>{
  const rows:DaviDiagnosticRow[]=[
   baseRow,
  {...baseRow,source_row:3,identity_classification:'EXACT_EXISTING',sale_id:'00000000-0000-4000-8000-000000000002',resolved_client_id:'00000000-0000-4000-8000-000000000003',resolved_perfume_id:'00000000-0000-4000-8000-000000000004',expected_updated_at:'2026-09-04T12:00:00Z',expected_payment_status:'pending',proposed_changes:{payment_status:{before:'pending',after:'paid'}}},
   {...baseRow,source_row:4,identity_classification:'PROBABLE_DUPLICATE',stock_classification:null},
   {...baseRow,source_row:5,identity_classification:'CONFLICT',stock_classification:'STOCK_OK'},
   {...baseRow,source_row:6,identity_classification:'INVALID',stock_classification:null},
   {...baseRow,source_row:7,stock_classification:'STOCK_INSUFFICIENT'},
   {...baseRow,source_row:8,stock_classification:'STOCK_ITEM_MISSING'},
  ]
  expect(safeDaviRows(report(rows)).map(row=>row.source_row)).toEqual([2,3])
 })
 it('gera payload mínimo determinístico e fingerprint sensível ao conteúdo',async()=>{
  const rows=[candidate({source_row:3}),candidate({source_row:2})]
  expect(canonicalDaviSafeCandidates(rows)).toBe(canonicalDaviSafeCandidates([...rows].reverse()))
  expect(await fingerprintDaviSafeCandidates(rows)).toMatch(/^[0-9a-f]{64}$/)
  expect(await fingerprintDaviSafeCandidates(rows)).not.toBe(await fingerprintDaviSafeCandidates([{...rows[0],amount:'50.01'},rows[1]]))
 })
 it('RPC revalida lote inteiro antes da escrita, usa locks e aborta conflito detalhado',()=>{
  const firstWrite=migration.indexOf('insert into public.import_batches')
  expect(migration.indexOf('-- Pré-validação integral')).toBeLessThan(firstWrite)
  for(const guard of['for update','wrong_organization','stale_updated_at','commercial_identity_changed','mutable_state_changed','safe_row_became_duplicate','new_sale_conflict_or_ambiguity','stock_became_insufficient','diagnostic_fingerprint_mismatch'])expect(migration).toContain(guard)
  expect(migration).toContain('davi_safe_apply_conflict:')
  expect(migration).toContain("not in('NEW_SALE','EXACT_EXISTING')")
  expect(migration).toContain("not in('STOCK_OK','STOCK_NOT_REQUIRED')")
 })
 it('mantém estoque no trigger canônico, sem criar item ou movimento fictício',()=>{
  expect(migration).not.toMatch(/insert into public\.inventory_items|insert into public\.inventory_movements|update public\.inventory_items|update public\.inventory_allocations/i)
  expect(migration).toContain("inventory_allocation_eligible)")
  expect(migration).toContain("nullif(item->>'split_completed_at','')::date,true)")
 })
 it('aplica apenas os campos mutáveis já reconhecidos pelo analisador',()=>{
  for(const field of['payment_status','payment_method','paid_at','shipped_at','credit','note','split_completed_at'])expect(migration).toContain(`'${field}'`)
  const saleUpdate=migration.slice(migration.indexOf('update public.sales set'),migration.indexOf('where id=before_sale.id'))
  expect(saleUpdate).not.toMatch(/\b(client_id|perfume_id|amount|volume_ml|sale_date|sale_type)\b\s*=\s*case/)
 })
 it('é idempotente e audita batch, venda, before/after, fonte, linha, fingerprint e timestamp',()=>{
  for(const value of["status='completed' for update","'idempotent',true","'davi_safe_diagnostic_sale_applied'","'davi_safe_diagnostic_batch_applied'","'batch_id'","'sale_id'","'before'","'after'","'source'","'row'","'fingerprint'","'timestamp'"])expect(migration).toContain(value)
 })
 it('liga estados do botão, mostra erro e atualiza diagnóstico e tabela depois do sucesso',()=>{
  expect(component).toContain('disabled={!safe.length||applying||refreshing}')
  expect(component).toContain('APLICANDO...')
  expect(component).toContain('alterações aplicadas com sucesso')
  expect(component).toContain('davi_safe_apply_conflict:')
  expect(component).toContain('requer nova análise')
  expect(component).toContain('setReport(null)')
  expect(component).toContain('O diagnóstico foi atualizado automaticamente')
  expect(component).toContain('const refreshed=await analyzeDaviFile(file)')
  expect(component).toContain('vendas existentes encontradas')
  expect(component).toContain('alterações propostas')
    expect(component).toContain('await onApplied();const refreshed=await analyzeDaviFile(file)')
  expect(page).toContain('<DaviImportDiagnostics onApplied={load}/>')
 })
 it('mantém paginação completa e rejeita snapshot estruturalmente incompleto',()=>{
  const source=readFileSync('src/lib/davi-import-diagnostics.ts','utf8')
  expect(source).toContain("select(columns,{count:'exact'})")
  expect(source).toContain('Paginação incompleta em')
  expect(source).toContain('incomplete_tables')
 })
 it('reconhece o conflito de estado mesmo com o espaçamento real do cast jsonb::text do Postgres',()=>{
  // O Postgres normaliza jsonb::text inserindo um espaço após ':' — o regex antigo
  // ("code":" sem espaço) nunca batia com isso, então todo conflito caía no toast
  // técnico bruto. A correção detecta apenas o prefixo estável da mensagem.
  const realPostgresMessage='davi_safe_apply_conflict:{"row": "57", "code": "mutable_state_changed"}'
  const oldBrokenRegex=/davi_safe_apply_conflict:\{.*?"code":"([^"]+)".*?\}/
  expect(oldBrokenRegex.test(realPostgresMessage)).toBe(false)
  expect(realPostgresMessage.startsWith('davi_safe_apply_conflict:')).toBe(true)
  expect(component).toContain("raw.startsWith('davi_safe_apply_conflict:')")
  expect(component).not.toMatch(/"code":"\(\[\^"\]\+\)"/)
  for(const guardCode of['mutable_state_changed','stale_updated_at','stock_became_insufficient','diagnostic_fingerprint_mismatch'])
   expect(`davi_safe_apply_conflict:{"row": "9", "code": "${guardCode}"}`.startsWith('davi_safe_apply_conflict:')).toBe(true)
 })
 it('invalida o relatório, bloqueia o apply e reanalisa o mesmo arquivo automaticamente após conflito de estado',()=>{
  const staleBranch=component.slice(component.indexOf('isStaleConflict){'),component.indexOf('}else{setError(raw)'))
  expect(staleBranch).toContain('setReport(null)')
  expect(staleBranch).toContain('setRefreshing(true)')
  expect(staleBranch).toContain('const refreshed=await analyzeDaviFile(file)')
  expect(staleBranch).toContain('setReport(refreshed)')
  expect(staleBranch).toContain('finally{setRefreshing(false)}')
  expect(staleBranch).toContain('A base mudou desde a última análise. O diagnóstico foi atualizado automaticamente. Confira os novos resultados antes de aplicar.')
  expect(staleBranch).not.toContain('void applySafe()')
  expect(staleBranch).not.toContain('toast.push(raw')
  expect(component).toContain('console.warn(\'[davi-safe-apply]')
 })
 it('trata arquivo indisponível na reanálise mantendo o apply bloqueado, sem vazar erro técnico',()=>{
  const refreshFailure=component.slice(component.indexOf('}catch{setError('),component.indexOf('}finally{setRefreshing(false)}'))
  expect(refreshFailure).toContain('A base mudou. Analise novamente a planilha antes de aplicar.')
  expect(refreshFailure).not.toMatch(/P0001|mutable_state_changed|"row"|"code"/)
 })
 it('recalcula contadores e exige novo clique manual a partir do relatório reanalisado',()=>{
  expect(component).toContain('const safe=report?safeDaviRows(report):[]')
  expect(component).toContain('const groups=useMemo(()=>{const rows=report?.rows??[]')
  expect(component).toContain('ATUALIZANDO DIAGNÓSTICO...')
  expect(component).toContain('{refreshing&&<p className="davi-diagnostic-refreshing">')
 })
})
