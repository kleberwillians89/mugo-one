import {execFileSync} from 'node:child_process'
import {createHash} from 'node:crypto'
import {readFileSync} from 'node:fs'

const projectRef='pfhvqkzafgoyumxmbwqc'
const metadata=JSON.parse(readFileSync('scripts/manifests/canonical-davi-sales-archive-20260904.json','utf8'))
const manifestBytes=readFileSync(metadata.private_payload)
const rows=JSON.parse(manifestBytes.toString('utf8'))
const sha=value=>createHash('sha256').update(value).digest('hex')
const canonical=items=>items.slice().sort((left,right)=>left.sale_id.localeCompare(right.sale_id)).map(row=>[
 row.sale_id,row.organization_id,row.expected_updated_at,row.amount,row.client_id,row.perfume_id,
 row.sale_date,row.sale_type,row.volume_ml,row.payment_status,
].join('|')).join('\n')

if(sha(manifestBytes)!==metadata.manifest_sha256)throw new Error('SHA-256 do arquivo do manifesto diverge do aprovado.')
if(sha(canonical(rows))!==metadata.payload_sha256)throw new Error('SHA-256 semântico do manifesto diverge do aprovado.')
if(rows.length!==metadata.sale_count)throw new Error('Quantidade do manifesto diverge da aprovada.')
if(rows.reduce((sum,row)=>sum+Math.round(Number(row.amount)*100),0)!==Math.round(Number(metadata.amount)*100))throw new Error('Valor do manifesto diverge do aprovado.')

const keys=JSON.parse(execFileSync('supabase',['projects','api-keys','--project-ref',projectRef,'--output','json'],{encoding:'utf8'}))
const key=keys.find(item=>item.name==='service_role'||item.type==='service_role')?.api_key
if(!key)throw new Error('Credencial administrativa indisponível.')
const base=`https://${projectRef}.supabase.co/rest/v1`
const headers={apikey:key,authorization:`Bearer ${key}`}
const adminsResponse=await fetch(`${base}/organization_members?organization_id=eq.${metadata.organization_id}&role=eq.admin&select=user_id&order=created_at.asc&limit=1`,{headers})
if(!adminsResponse.ok)throw new Error(`Consulta do administrador falhou: HTTP ${adminsResponse.status}`)
const [admin]=await adminsResponse.json()
if(!admin?.user_id)throw new Error('Administrador aprovado não encontrado para a organização.')

const response=await fetch(`${base}/rpc/apply_approved_canonical_davi_sales_archive`,{
 method:'POST',headers:{...headers,'content-type':'application/json'},body:JSON.stringify({
  p_organization_id:metadata.organization_id,p_user_id:admin.user_id,p_batch_id:metadata.batch_id,
  p_source_hash:metadata.source_sha256,p_manifest_hash:metadata.manifest_sha256,p_rows:rows,
 }),
})
const body=await response.json().catch(()=>null)
if(!response.ok)throw new Error(`Arquivamento recusado: HTTP ${response.status} ${JSON.stringify(body)}`)
console.log(JSON.stringify({
 batch_id:body.batch_id,idempotent:body.idempotent,archived_sales:body.archived_sales,
 returned_sale_ids:Array.isArray(body.sale_ids)?body.sale_ids.length:0,
},null,2))
