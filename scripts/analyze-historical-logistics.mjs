import {createHash} from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import readXlsxFile from 'read-excel-file/node'

const [input,snapshotPath,previousInput,previousStagingPath]=process.argv.slice(2)
if(!input||!snapshotPath)throw new Error('Uso: node scripts/analyze-historical-logistics.mjs dona.xlsx snapshot.json [planilha-anterior.xlsx] [staging-anterior.json]')
const normalize=(value)=>String(value??'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[\u200B-\u200D\uFEFF]/g,'').replace(/\s+/g,' ').trim().toLowerCase()
const number=(value)=>typeof value==='number'&&Number.isFinite(value)?Math.round(value*1000)/1000:null
const date=(value)=>value instanceof Date&&!Number.isNaN(value.valueOf())?value.toISOString().slice(0,10):String(value??'').match(/^\d{4}-\d{2}-\d{2}/)?.[0]??null
const key=(values)=>values.map((value)=>String(value??'')).join('|')
const add=(map,k,value)=>map.set(k,[...(map.get(k)??[]),value])
const hashFile=(file)=>createHash('sha256').update(fs.readFileSync(file)).digest('hex')
const deadline=(value)=>{
  const asDate=date(value)
  if(asDate)return{raw:asDate,date:asDate,status:null,kind:'date'}
  const raw=String(value??'').trim(),normalized=normalize(raw)
  const statuses=new Map([['disponivel','available'],['enviado','sent'],['pronta entrega','ready_stock'],['cancelado','cancelled']])
  return{raw:raw||null,date:null,status:statuses.get(normalized)??null,kind:raw?'text':'blank'}
}
const identity=(row)=>key([row.client,row.sale_date,row.perfume,row.sale_type,row.volume_ml,row.amount])
const mutableKey=(row)=>key([normalize(row.payment_status),normalize(row.payment_method),date(row.paid_at),number(row.credit_reference_amount),normalize(row.notes)])
const readRows=async(file)=>{
  const sheets=await readXlsxFile(file,{getSheets:true}),sheet=sheets.find((x)=>x.sheet==='PERFUMES')??sheets[0]
  const headers=(sheet.data[0]??[]).map((x)=>String(x??'').trim())
  return sheet.data.slice(1).map((values,index)=>({source_row:index+2,raw:Object.fromEntries(headers.map((header,column)=>[header,values[column]??null]))}))
    .filter(({raw})=>headers.some((h)=>raw[h]!==null&&String(raw[h]).trim())&&normalize(raw.CLIENTE)!=='total:')
    .map(({source_row,raw})=>{const parsedDeadline=deadline(raw['PRAZO DE ENVIO']);return{source_row,raw,client:normalize(raw.CLIENTE),sale_date:date(raw.DATA),perfume:normalize(raw.PERFUME),sale_type:normalize(raw.TIPO),volume_ml:number(raw.ML),amount:number(raw.VALOR),payment_status:raw.PAGAMENTO,payment_method:raw['FORMA DE PAGAMENTO'],paid_at:date(raw['DATA PAGMT']),credit_reference_amount:number(raw['CRÉDITO']),notes:raw['OBSERVAÇÃO'],shipped_at:date(raw['DATA DE ENVIO']),deadline:parsedDeadline}})
}

const snapshot=JSON.parse(fs.readFileSync(snapshotPath,'utf8')),clients=new Map(snapshot.tables.clients.map((x)=>[x.id,x])),perfumes=new Map(snapshot.tables.perfumes.map((x)=>[x.id,x]))
const currentSales=snapshot.tables.sales.filter((x)=>x.deleted_at===null).map((sale)=>({...sale,client:normalize(clients.get(sale.client_id)?.name??sale.client_name_raw??sale.original_client),sale_date:date(sale.sale_date),perfume:normalize(perfumes.get(sale.perfume_id)?.full_name_raw??sale.perfume_name_raw),sale_type:normalize(sale.sale_type),volume_ml:number(sale.volume_ml),amount:number(Number(sale.amount))}))
const byIdentity=new Map();for(const sale of currentSales)add(byIdentity,identity(sale),sale)
const rows=await readRows(input),used=new Set(),recentBatchId=Object.entries(currentSales.reduce((a,x)=>(x.import_batch_id&&(a[x.import_batch_id]=(a[x.import_batch_id]??0)+1),a),{})).find(([,count])=>count===796)?.[0]??null
const previousStage=previousStagingPath?JSON.parse(fs.readFileSync(previousStagingPath,'utf8')).rows:[]
const priorByIdentity=new Map();for(const row of previousStage)add(priorByIdentity,row.identity,row)
const outputRows=[]
for(const row of rows){
  row.identity=identity(row)
  const all=(byIdentity.get(row.identity)??[]).filter((sale)=>!used.has(sale.id))
  let match=null,classification='unmatched',reason='Nenhuma venda atual com identidade comercial exata.'
  if(all.length===1){match=all[0];classification='matched';reason='Identidade comercial exata e candidata única.'}
  else if(all.length>1){const mutable=all.filter((sale)=>mutableKey(sale)===mutableKey(row));if(mutable.length===1){match=mutable[0];classification='matched';reason='Identidade comercial repetida, desambiguada unicamente pelos campos comerciais existentes.'}else{classification='possible_duplicate';reason='Mais de uma venda atual candidata; logística não foi usada como identidade.'}}
  if(match)used.add(match.id)
  const proposed={},conflicts={}
  if(match&&row.shipped_at){if(!date(match.shipped_at))proposed.shipped_at=row.shipped_at;else if(date(match.shipped_at)!==row.shipped_at)conflicts.shipped_at={current:date(match.shipped_at),source:row.shipped_at}}
  if(match&&row.deadline.raw){if(!match.shipping_deadline_raw)proposed.shipping_deadline_raw=row.deadline.raw;else if(normalize(match.shipping_deadline_raw)!==normalize(row.deadline.raw))conflicts.shipping_deadline_raw={current:match.shipping_deadline_raw,source:row.deadline.raw}}
  if(match&&row.deadline.date){if(!date(match.shipping_deadline_date))proposed.shipping_deadline_date=row.deadline.date;else if(date(match.shipping_deadline_date)!==row.deadline.date)conflicts.shipping_deadline_date={current:date(match.shipping_deadline_date),source:row.deadline.date}}
  if(match&&row.deadline.status){if(!match.shipping_operational_status)proposed.shipping_operational_status=row.deadline.status;else if(normalize(match.shipping_operational_status)!==normalize(row.deadline.status)&&normalize(match.shipping_operational_status)!==normalize(row.deadline.raw))conflicts.shipping_operational_status={current:match.shipping_operational_status,source:row.deadline.status}}
  const prior=priorByIdentity.get(row.identity)??[]
  outputRows.push({...row,classification,reason,match_sale_id:match?.id??null,recent_import:match?.import_batch_id===recentBatchId,ambiguous_600:prior.some((x)=>['possible_duplicate','review_required'].includes(x.classification)),prior_classifications:[...new Set(prior.map((x)=>x.classification))],proposed,conflicts})
}

let additions=null
if(previousInput){
  const old=await readRows(previousInput),oldShipping=new Map()
  for(const row of old.filter((x)=>x.shipped_at))add(oldShipping,identity(row),row.shipped_at)
  const added=outputRows.filter((row)=>row.shipped_at&&!(oldShipping.get(row.identity)??[]).includes(row.shipped_at))
  additions={total:added.length,deterministic:added.filter((x)=>x.match_sale_id&&x.proposed.shipped_at).length,already_current:added.filter((x)=>x.match_sale_id&&!x.proposed.shipped_at&&!x.conflicts.shipped_at).length,possible_duplicate:added.filter((x)=>x.classification==='possible_duplicate').length,unmatched:added.filter((x)=>x.classification==='unmatched').length,ambiguous_600:added.filter((x)=>x.ambiguous_600).length,rows:added.map((x)=>({source_row:x.source_row,client:x.raw.CLIENTE,perfume:x.raw.PERFUME,sale_date:x.sale_date,shipped_at:x.shipped_at,classification:x.classification,match_sale_id:x.match_sale_id,ambiguous_600:x.ambiguous_600,prior_classifications:x.prior_classifications}))}
}
const count=(predicate)=>outputRows.filter(predicate).length
const report={created_at:new Date().toISOString(),source:path.basename(input),source_sha256:hashFile(input),snapshot:path.basename(snapshotPath),current:{clients:snapshot.tables.clients.length,sales:currentSales.length,recent_import_batch_id:recentBatchId,recent_import_sales:count((x)=>x.recent_import)},source_rows:rows.length,source_logistics:{shipped_at:count((x)=>x.shipped_at),deadline_date:count((x)=>x.deadline.date),deadline_text:count((x)=>x.deadline.kind==='text'),deadline_text_breakdown:Object.fromEntries(['available','sent','ready_stock','cancelled'].map((status)=>[status,count((x)=>x.deadline.status===status)]))},matching:{deterministic:count((x)=>x.classification==='matched'),possible_duplicate:count((x)=>x.classification==='possible_duplicate'),unmatched:count((x)=>x.classification==='unmatched'),belong_to_600_ambiguous:count((x)=>x.ambiguous_600)},safe_additions:{shipped_at:count((x)=>x.proposed.shipped_at),deadline_raw:count((x)=>x.proposed.shipping_deadline_raw),deadline_date:count((x)=>x.proposed.shipping_deadline_date),operational_status:count((x)=>x.proposed.shipping_operational_status),sales_touched:count((x)=>Object.keys(x.proposed).length>0)},conflicts:{sales:count((x)=>Object.keys(x.conflicts).length>0),shipped_at:count((x)=>x.conflicts.shipped_at),deadline_raw:count((x)=>x.conflicts.shipping_deadline_raw),deadline_date:count((x)=>x.conflicts.shipping_deadline_date),operational_status:count((x)=>x.conflicts.shipping_operational_status)},shipping_additions_vs_previous:additions}
const suffix=new Date().toISOString().replace(/[:.]/g,'-');fs.mkdirSync('private_data',{recursive:true})
const stagingFile=path.join('private_data',`historical-logistics-staging-${suffix}.json`),reportFile=path.join('private_data',`historical-logistics-report-${suffix}.json`)
fs.writeFileSync(stagingFile,JSON.stringify({report,rows:outputRows}));fs.writeFileSync(reportFile,JSON.stringify(report,null,2));console.log(JSON.stringify({...report,shipping_additions_vs_previous:additions&&{...additions,rows:undefined},files:{staging:stagingFile,report:reportFile}},null,2))
