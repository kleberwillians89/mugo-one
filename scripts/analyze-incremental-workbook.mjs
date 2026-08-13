import {createHash} from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import readXlsxFile from 'read-excel-file/node'

const input=process.argv[2],snapshotPath=process.argv[3]
if(!input)throw new Error('Uso: npm run analyze:incremental -- arquivo.xlsx [snapshot-supabase.json]')
const normalize=(value)=>String(value??'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[\u200B-\u200D\uFEFF]/g,'').replace(/\s+/g,' ').trim().toLowerCase()
const comparable=(value)=>normalize(value)||null
const number=(value)=>typeof value==='number'&&Number.isFinite(value)?Math.round(value*1000)/1000:null
const date=(value)=>value instanceof Date&&!Number.isNaN(value.valueOf())?value.toISOString().slice(0,10):String(value??'').match(/^\d{4}-\d{2}-\d{2}/)?.[0]??null
const status=(value)=>{const x=normalize(value);if(['pago','paga','quitado','paid'].includes(x))return'paid';if(x.includes('cancel')||x.includes('estorn'))return'cancelled';if(x.includes('aguard')||x.includes('pendente')||x.includes('nao pago')||x==='pending')return'pending';return'unknown'}
const hash=(value)=>createHash('sha256').update(value).digest('hex')
const key=(values)=>values.map((value)=>String(value??'')).join('|')
const add=(map,k,value)=>map.set(k,[...(map.get(k)??[]),value])
const distance=(a,b)=>{const previous=Array.from({length:b.length+1},(_,i)=>i);for(let i=1;i<=a.length;i++){let diagonal=previous[0];previous[0]=i;for(let j=1;j<=b.length;j++){const above=previous[j],cost=a[i-1]===b[j-1]?0:1;previous[j]=Math.min(previous[j]+1,previous[j-1]+1,diagonal+cost);diagonal=above}}return previous[b.length]}
const similarPerson=(a,b)=>distance(a,b)<=2||(a.length>8&&b.length>8&&(a.includes(b)||b.includes(a)))
const similarPerfume=(a,b)=>distance(a,b)<=2
const newestSnapshot=()=>fs.existsSync('private_data')?fs.readdirSync('private_data').filter((name)=>name.startsWith('supabase-snapshot-')&&name.endsWith('.json')).sort().at(-1):null
const resolvedSnapshot=snapshotPath??(newestSnapshot()?path.join('private_data',newestSnapshot()):null)
if(!resolvedSnapshot)throw new Error('Snapshot autenticado obrigatório para classificar o delta.')
const snapshot=JSON.parse(fs.readFileSync(resolvedSnapshot,'utf8'))
const sales=(snapshot.tables.sales??[]).filter((sale)=>sale.deleted_at===null)
const clients=snapshot.tables.clients??[],perfumes=snapshot.tables.perfumes??[]
const clientById=new Map(clients.map((client)=>[client.id,client])),perfumeById=new Map(perfumes.map((perfume)=>[perfume.id,perfume]))
const normalizedExistingClients=new Map(),normalizedExistingPerfumes=new Map()
for(const client of clients)add(normalizedExistingClients,normalize(client.name),client)
for(const perfume of perfumes)add(normalizedExistingPerfumes,normalize(perfume.full_name_raw),perfume)
const normalizedSale=(sale)=>({
  id:sale.id,client:normalize(clientById.get(sale.client_id)?.name??sale.client_name_raw??sale.original_client),date:date(sale.sale_date),
  perfume:normalize(perfumeById.get(sale.perfume_id)?.full_name_raw??sale.perfume_name_raw),type:normalize(sale.sale_type),
  ml:number(sale.volume_ml),amount:number(Number(sale.amount)),payment_status:status(sale.payment_status),
  payment_method:comparable(sale.payment_method),paid_at:date(sale.paid_at),shipped_at:date(sale.shipped_at),
  credit:number(sale.credit_reference_amount),note:comparable(sale.notes),raw:sale,
})
const existing=sales.map(normalizedSale),indexes={core:new Map(),noAmount:new Map(),noMl:new Map(),noPerfume:new Map()}
const identity=(row)=>key([row.client,row.date,row.perfume,row.type,row.ml,row.amount])
for(const row of existing){add(indexes.core,identity(row),row);add(indexes.noAmount,key([row.client,row.date,row.perfume,row.type,row.ml]),row);add(indexes.noMl,key([row.client,row.date,row.perfume,row.type,row.amount]),row);add(indexes.noPerfume,key([row.client,row.date,row.type,row.ml,row.amount]),row)}
const workbook=await readXlsxFile(input,{getSheets:true}),sheet=workbook.find((item)=>item.sheet==='PERFUMES')??workbook[0]
const headers=(sheet.data[0]??[]).map((value)=>String(value??'').trim()),used=new Set(),fileIdentities=new Map(),staging=[]
const sourceRows=sheet.data.slice(1).map((values,index)=>({source_row:index+2,raw:Object.fromEntries(headers.map((header,column)=>[header,values[column]??null]))})).filter(({raw})=>headers.some((header)=>raw[header]!==null&&String(raw[header]).trim())&&normalize(raw.CLIENTE)!=='total:')
const sheetClientNames=new Set(sourceRows.map(({raw})=>normalize(raw.CLIENTE)).filter((name)=>name&&name!=='disponivel para venda')),sheetPerfumeNames=new Set(sourceRows.map(({raw})=>normalize(raw.PERFUME)).filter(Boolean))
const existingClientNames=[...normalizedExistingClients.keys()],existingPerfumeNames=[...normalizedExistingPerfumes.keys()]
const ambiguousNewClients=new Set([...sheetClientNames].filter((name)=>!normalizedExistingClients.has(name)&&existingClientNames.some((candidate)=>similarPerson(name,candidate))))
const possiblePerfumeAliases=new Set([...sheetPerfumeNames].filter((name)=>!normalizedExistingPerfumes.has(name)&&existingPerfumeNames.some((candidate)=>similarPerfume(name,candidate))))
const changes={payment_status:0,pending_to_paid:0,unknown_to_paid:0,paid_at_added:0,payment_method:0,shipped_at_added:0,note:0,amount:0,ml:0,perfume:0,type:0}
const diff=(old,row)=>{
  const proposed={};for(const field of ['payment_status','payment_method','paid_at','shipped_at','credit','note','amount','ml','perfume','type'])if(old[field]!==row[field])proposed[field]={before:old[field],after:row[field]}
  return proposed
}
const recordChanges=(old,row,proposed)=>{
  if(proposed.payment_status){changes.payment_status++;if(old.payment_status==='pending'&&row.payment_status==='paid')changes.pending_to_paid++;if(old.payment_status==='unknown'&&row.payment_status==='paid')changes.unknown_to_paid++}
  if(!old.paid_at&&row.paid_at)changes.paid_at_added++;if(proposed.payment_method)changes.payment_method++;if(!old.shipped_at&&row.shipped_at)changes.shipped_at_added++
  for(const field of ['note','amount','ml','perfume','type'])if(proposed[field])changes[field]++
}
for(const {source_row,raw} of sourceRows){
  const row={source_row,client:normalize(raw.CLIENTE),display_client:String(raw.CLIENTE??'').trim(),date:date(raw.DATA),perfume:normalize(raw.PERFUME),display_perfume:String(raw.PERFUME??'').trim(),type:normalize(raw.TIPO),ml:number(raw.ML),amount:number(raw.VALOR),payment_status:status(raw.PAGAMENTO),payment_method:comparable(raw['FORMA DE PAGAMENTO']),paid_at:date(raw['DATA PAGMT']),shipped_at:date(raw['DATA DE ENVIO']),credit:number(raw['CRÉDITO']),note:comparable(raw['OBSERVAÇÃO']),raw}
  row.identity=identity(row);row.signature=hash(row.identity);const occurrences=fileIdentities.get(row.identity)??0;fileIdentities.set(row.identity,occurrences+1)
  const invalid=!row.client||row.client==='disponivel para venda'||!row.date||!row.perfume||!['apc','split'].includes(row.type)||row.ml===null||row.amount===null
  let classification='review_required',match=null,confidence=0,reason=invalid?'Dados obrigatórios ausentes ou operacionais.':''
  if(!invalid&&ambiguousNewClients.has(row.client)){classification='review_required';confidence=.4;reason='Cliente novo semelhante a cadastro existente; revisão humana obrigatória.'}
  else if(!invalid&&possiblePerfumeAliases.has(row.perfume)){classification='possible_duplicate';confidence=.5;reason='Perfume novo semelhante a descrição existente; possível alias ou frasco distinto.'}
  else if(!invalid){
    const exactCandidates=(indexes.core.get(row.identity)??[]).filter((candidate)=>!used.has(candidate.id))
    const exactMutable=exactCandidates.find((candidate)=>Object.keys(diff(candidate,row)).length===0)
    if(exactMutable){classification='existing_exact';match=exactMutable;confidence=1;reason='Identidade e campos mutáveis equivalentes.'}
    else if(exactCandidates.length===1){classification='existing_changed';match=exactCandidates[0];confidence=.99;reason='Identidade comercial exata; campos secundários alterados.'}
    else if(exactCandidates.length>1){classification='possible_duplicate';confidence=.75;reason='Mais de uma venda existente com a mesma identidade comercial.'}
    else {
      const near=[...(indexes.noAmount.get(key([row.client,row.date,row.perfume,row.type,row.ml]))??[]),...(indexes.noMl.get(key([row.client,row.date,row.perfume,row.type,row.amount]))??[]),...(indexes.noPerfume.get(key([row.client,row.date,row.type,row.ml,row.amount]))??[])].filter((candidate)=>!used.has(candidate.id))
      const unique=[...new Map(near.map((candidate)=>[candidate.id,candidate])).values()]
      if(unique.length>=1||occurrences>0){classification='possible_duplicate';confidence=unique.length===1?.7:.65;reason=occurrences>0?'Linha repetida ou alterada dentro da planilha.':unique.length===1?'Uma dimensão da identidade comercial diverge; revisão humana obrigatória.':'Múltiplas correspondências comerciais próximas.'}
      else {classification='new_safe';confidence=.95;reason='Sem correspondência exata ou próxima na base atual.'}
    }
  }
  if(match)used.add(match.id)
  const proposed_changes=match&&classification==='existing_changed'?diff(match,row):{}
  if(match&&classification==='existing_changed')recordChanges(match,row,proposed_changes)
  staging.push({...row,classification,match_candidate:match?.id??null,confidence,reason,proposed_changes})
}
const counts=Object.fromEntries(['existing_exact','existing_changed','new_safe','possible_duplicate','review_required'].map((name)=>[name,staging.filter((row)=>row.classification===name).length]))
const newRows=staging.filter((row)=>row.classification==='new_safe'),sum=(rows,field)=>Math.round(rows.reduce((total,row)=>total+Number(row[field]??0),0)*100)/100
const clientReport={current:clients.length,in_sheet:sheetClientNames.size,existing:[...sheetClientNames].filter((name)=>normalizedExistingClients.has(name)).length,new_safe:[...sheetClientNames].filter((name)=>!normalizedExistingClients.has(name)&&!ambiguousNewClients.has(name)).length,possible_duplicate:ambiguousNewClients.size,review_required:0}
const perfumeReport={current:perfumes.length,in_sheet:sheetPerfumeNames.size,existing:[...sheetPerfumeNames].filter((name)=>normalizedExistingPerfumes.has(name)).length,new_safe:[...sheetPerfumeNames].filter((name)=>!normalizedExistingPerfumes.has(name)&&!possiblePerfumeAliases.has(name)).length,possible_alias:possiblePerfumeAliases.size,review_required:0}
const monthly=Object.entries(newRows.reduce((acc,row)=>{const month=row.date.slice(0,7);acc[month]=(acc[month]??0)+1;return acc},{})).sort()
const report={created_at:new Date().toISOString(),source:path.basename(input),snapshot:path.basename(resolvedSnapshot),total_lines:staging.length,valid_lines:staging.length-counts.review_required,rejected:counts.review_required,...counts,clients:clientReport,perfumes:perfumeReport,delta:{sales:newRows.length,value:sum(newRows,'amount'),ml:sum(newRows,'ml'),paid:sum(newRows.filter((row)=>row.payment_status==='paid'),'amount'),pending:sum(newRows.filter((row)=>row.payment_status==='pending'),'amount'),cancelled:sum(newRows.filter((row)=>row.payment_status==='cancelled'),'amount'),unknown:sum(newRows.filter((row)=>row.payment_status==='unknown'),'amount'),first_date:newRows.map((row)=>row.date).sort()[0]??null,last_date:newRows.map((row)=>row.date).sort().at(-1)??null,monthly},changes}
const outputDir='private_data';fs.mkdirSync(outputDir,{recursive:true});const suffix=new Date().toISOString().replace(/[:.]/g,'-')
fs.writeFileSync(path.join(outputDir,`incremental-staging-${suffix}.json`),JSON.stringify({report,rows:staging}))
fs.writeFileSync(path.join(outputDir,`incremental-report-${suffix}.json`),JSON.stringify(report,null,2))
console.log(JSON.stringify(report,null,2))
