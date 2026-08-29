import {createHash} from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import readXlsxFile from 'read-excel-file/node'
import {
  approvedClientAlias, approvedNewSaleDecision, approvedPerfumeAlias, commercialPerfumeBase, hasExplicitSourceValue, inventoryBaseline,
  isApprovedDistinctMilkPlus, isCancelledSourceMl, isHistoricalZeroMatchingValue,
  normalizeDecisionText as normalize,
} from './incremental-approved-decisions.mjs'

const input=process.argv[2],snapshotPath=process.argv[3]
if(!input)throw new Error('Uso: npm run analyze:incremental -- arquivo.xlsx [snapshot-supabase.json]')
const comparable=(value)=>normalize(value)||null
const number=(value)=>typeof value==='number'&&Number.isFinite(value)?Math.round(value*1000)/1000:null
const date=(value)=>value instanceof Date&&!Number.isNaN(value.valueOf())?value.toISOString().slice(0,10):String(value??'').match(/^\d{4}-\d{2}-\d{2}/)?.[0]??null
const status=(value)=>{const x=normalize(value);if(['pago','paga','quitado','paid'].includes(x))return'paid';if(x.includes('cancel')||x.includes('estorn'))return'cancelled';if(x.includes('aguard')||x.includes('pendente')||x.includes('nao pago')||x==='pending')return'pending';return'unknown'}
const hash=(value)=>createHash('sha256').update(value).digest('hex')
const key=(values)=>values.map((value)=>String(value??'')).join('|')
const add=(map,k,value)=>map.set(k,[...(map.get(k)??[]),value])
const unique=(rows)=>[...new Map(rows.map((row)=>[row.id,row])).values()]
const distance=(a,b)=>{const previous=Array.from({length:b.length+1},(_,i)=>i);for(let i=1;i<=a.length;i++){let diagonal=previous[0];previous[0]=i;for(let j=1;j<=b.length;j++){const above=previous[j],cost=a[i-1]===b[j-1]?0:1;previous[j]=Math.min(previous[j]+1,previous[j-1]+1,diagonal+cost);diagonal=above}}return previous[b.length]}
const similarPerson=(a,b)=>distance(a,b)<=2||(a.length>8&&b.length>8&&(a.includes(b)||b.includes(a)))
const similarPerfume=(a,b)=>distance(a,b)<=2
const newestSnapshot=()=>fs.existsSync('private_data')?fs.readdirSync('private_data').filter((name)=>name.startsWith('supabase-snapshot-')&&name.endsWith('.json')).sort().at(-1):null
const resolvedSnapshot=snapshotPath??(newestSnapshot()?path.join('private_data',newestSnapshot()):null)
if(!resolvedSnapshot)throw new Error('Snapshot autenticado obrigatório para classificar o delta.')
const snapshot=JSON.parse(fs.readFileSync(resolvedSnapshot,'utf8'))
const sales=(snapshot.tables.sales??[]).filter((sale)=>sale.deleted_at===null)
const clients=(snapshot.tables.clients??[]).filter((client)=>client.deleted_at===null),perfumes=snapshot.tables.perfumes??[]
const clientById=new Map(clients.map((client)=>[client.id,client])),perfumeById=new Map(perfumes.map((perfume)=>[perfume.id,perfume]))
const normalizedExistingClients=new Map(),normalizedExistingPerfumes=new Map()
for(const client of clients)add(normalizedExistingClients,normalize(client.name),client)
for(const perfume of perfumes)add(normalizedExistingPerfumes,normalize(perfume.full_name_raw),perfume)

const normalizedSale=(sale)=>({
  id:sale.id,client_id:sale.client_id,perfume_id:sale.perfume_id,
  client:normalize(clientById.get(sale.client_id)?.name??sale.client_name_raw??sale.original_client),
  source_client:normalize(sale.client_name_raw??sale.original_client??clientById.get(sale.client_id)?.name),
  date:date(sale.sale_date),
  perfume:normalize(perfumeById.get(sale.perfume_id)?.full_name_raw??sale.perfume_name_raw),
  source_perfume:normalize(sale.perfume_name_raw??perfumeById.get(sale.perfume_id)?.full_name_raw),
  type:normalize(sale.sale_type),ml:number(sale.volume_ml),amount:number(Number(sale.amount)),payment_status:status(sale.payment_status),
  payment_method:comparable(sale.payment_method),paid_at:date(sale.paid_at),shipped_at:date(sale.shipped_at),
  credit:number(sale.credit_reference_amount),note:comparable(sale.notes),split_completed_at:date(sale.split_completed_at),raw:sale,
})
const existing=sales.map(normalizedSale)

// Um nome exato já usado historicamente pode apontar para a identidade canônica.
// Isso é determinístico e auditável; nenhuma similaridade/fuzzy cria resolução.
const historicalClientTargets=new Map(),historicalPerfumeTargets=new Map()
for(const row of existing){
  if(row.source_client&&row.client_id)add(historicalClientTargets,row.source_client,row.client_id)
  if(row.source_perfume&&row.perfume_id)add(historicalPerfumeTargets,row.source_perfume,row.perfume_id)
}
const uniqueTarget=(map,value)=>{const ids=[...new Set(map.get(value)??[])];return ids.length===1?ids[0]:null}

const variants=(row,omit=new Set())=>{
  const clientNames=[...new Set([row.client,row.source_client].filter(Boolean))]
  const perfumeNames=[...new Set([row.perfume,row.source_perfume].filter(Boolean))]
  const keys=[]
  for(const client of clientNames)for(const perfume of perfumeNames)keys.push(key([
    client,row.date,...(omit.has('perfume')?[]:[perfume]),row.type,...(omit.has('ml')?[]:[row.ml]),...(omit.has('amount')?[]:[row.amount]),
  ]))
  return [...new Set(keys)]
}
const indexes={core:new Map(),noAmount:new Map(),noMl:new Map(),noPerfume:new Map()}
for(const row of existing){
  for(const value of variants(row))add(indexes.core,value,row)
  for(const value of variants(row,new Set(['amount'])))add(indexes.noAmount,value,row)
  for(const value of variants(row,new Set(['ml'])))add(indexes.noMl,value,row)
  for(const value of variants(row,new Set(['perfume'])))add(indexes.noPerfume,value,row)
}
const indexedCandidates=(index,row,omit,used)=>unique(variants(row,omit).flatMap((value)=>index.get(value)??[])).filter((candidate)=>!used.has(candidate.id))

const workbook=await readXlsxFile(input,{getSheets:true}),sheet=workbook.find((item)=>item.sheet==='PERFUMES')??workbook[0]
const headers=(sheet.data[0]??[]).map((value)=>String(value??'').trim())
const hasSplitColumn=headers.some((header)=>normalize(header)==='data do split')
const populated=sheet.data.slice(1).map((values,index)=>({source_row:index+2,raw:Object.fromEntries(headers.map((header,column)=>[header,values[column]??null]))})).filter(({raw})=>headers.some((header)=>raw[header]!==null&&String(raw[header]).trim()))
const ignoredOperationalRows=populated.filter(({raw})=>['total:','disponivel para venda'].includes(normalize(raw.CLIENTE)))
const sourceRows=populated.filter(({raw})=>!['total:','disponivel para venda'].includes(normalize(raw.CLIENTE)))

const resolvedRows=sourceRows.map(({source_row,raw})=>{
  const row={
    source_row,source_client:normalize(raw.CLIENTE),display_client:String(raw.CLIENTE??'').trim(),date:date(raw.DATA),
    source_perfume:normalize(raw.PERFUME),display_perfume:String(raw.PERFUME??'').trim(),type:normalize(raw.TIPO),
    ml:number(raw.ML),amount:number(raw.VALOR),payment_status:status(raw.PAGAMENTO),payment_method:comparable(raw['FORMA DE PAGAMENTO']),
    paid_at:date(raw['DATA PAGMT']),shipped_at:date(raw['DATA DE ENVIO']),credit:number(raw['CRÉDITO']),note:comparable(raw['OBSERVAÇÃO']),split_completed_at:hasSplitColumn?date(raw['DATA DO SPLIT']):null,raw,
    historical_zero_candidate:isHistoricalZeroMatchingValue(raw.VALOR),cancelled_source:isCancelledSourceMl(raw.ML),resolutions:[],
    explicit_mutable:{payment_status:hasExplicitSourceValue(raw.PAGAMENTO),payment_method:hasExplicitSourceValue(raw['FORMA DE PAGAMENTO']),paid_at:hasExplicitSourceValue(raw['DATA PAGMT']),shipped_at:hasExplicitSourceValue(raw['DATA DE ENVIO']),credit:hasExplicitSourceValue(raw['CRÉDITO']),note:hasExplicitSourceValue(raw['OBSERVAÇÃO']),split_completed_at:hasSplitColumn&&hasExplicitSourceValue(raw['DATA DO SPLIT'])},
  }
  row.client=row.source_client;row.perfume=row.source_perfume

  const clientAlias=approvedClientAlias(row.source_client)
  const directClient=(normalizedExistingClients.get(row.source_client)??[]).length===1?(normalizedExistingClients.get(row.source_client)??[])[0].id:null
  const clientId=clientAlias?.targetId??directClient??uniqueTarget(historicalClientTargets,row.source_client)
  if(clientId){
    const target=clientById.get(clientId);if(!target)throw new Error(`Resolução de cliente aponta para ID ausente: ${clientId}`)
    row.client=normalize(target.name);row.resolved_client_id=clientId
    row.resolutions.push({kind:clientAlias?'explicit_human_alias':'exact_historical_identity',entity:'client',source:row.display_client,target_id:clientId,target_name:target.name,decision:clientAlias?.decision??null})
  }

  const perfumeAlias=approvedPerfumeAlias(row.source_perfume)
  const directPerfume=(normalizedExistingPerfumes.get(row.source_perfume)??[]).length===1?(normalizedExistingPerfumes.get(row.source_perfume)??[])[0].id:null
  const basePerfumeName=commercialPerfumeBase(row.source_perfume)
  const basePerfume=(normalizedExistingPerfumes.get(basePerfumeName)??[]).length===1?(normalizedExistingPerfumes.get(basePerfumeName)??[])[0].id:null
  const historicalPerfume=isApprovedDistinctMilkPlus(row.source_perfume)?null:uniqueTarget(historicalPerfumeTargets,row.source_perfume)
  const perfumeId=perfumeAlias?.targetId??directPerfume??basePerfume??historicalPerfume
  if(perfumeId){
    const target=perfumeById.get(perfumeId);if(!target)throw new Error(`Resolução de perfume aponta para ID ausente: ${perfumeId}`)
    row.perfume=normalize(target.full_name_raw);row.resolved_perfume_id=perfumeId
    row.resolutions.push({kind:perfumeAlias?'explicit_human_alias':'exact_historical_identity',entity:'perfume',source:row.display_perfume,target_id:perfumeId,target_name:target.full_name_raw,decision:perfumeAlias?.decision??null})
  }else if(isApprovedDistinctMilkPlus(row.source_perfume)){
    row.catalog_resolution={decision:'MILK_PLUS_DISTINCT_NEW',action:'create_commercial_perfume_only',canonical_name:'MILK + - COMMODITY',inventory_item:false,inventory_movement:false,inventory_purchase_entry:false,physical_ml:0,operational_code:null}
  }
  row.approved_new_decision=approvedNewSaleDecision(row)
  return row
})

const sheetClientNames=new Set(resolvedRows.map((row)=>row.client).filter(Boolean)),sheetPerfumeNames=new Set(resolvedRows.map((row)=>row.perfume).filter(Boolean))
const existingClientNames=[...normalizedExistingClients.keys()],existingPerfumeNames=[...normalizedExistingPerfumes.keys()]
const ambiguousNewClients=new Set(resolvedRows.filter((row)=>!row.resolved_client_id&&!normalizedExistingClients.has(row.client)&&existingClientNames.some((candidate)=>similarPerson(row.client,candidate))).map((row)=>row.client))
const possiblePerfumeAliases=new Set(resolvedRows.filter((row)=>!row.resolved_perfume_id&&!isApprovedDistinctMilkPlus(row.source_perfume)&&!normalizedExistingPerfumes.has(row.perfume)&&existingPerfumeNames.some((candidate)=>similarPerfume(row.perfume,candidate))).map((row)=>row.perfume))

const mutableFields=['payment_status','payment_method','paid_at','shipped_at','credit','note',...(hasSplitColumn?['split_completed_at']:[])]
const mutableDiff=(old,row)=>Object.fromEntries(mutableFields.filter((field)=>row.explicit_mutable[field]&&old[field]!==row[field]).map((field)=>[field,{before:old[field],after:row[field]}]))
const changes={payment_status:0,pending_to_paid:0,unknown_to_paid:0,paid_at_added:0,payment_method:0,shipped_at_added:0,note:0,credit:0,split_completed_at:0}
const recordChanges=(old,row,proposed)=>{
  if(proposed.payment_status){changes.payment_status++;if(old.payment_status==='pending'&&row.payment_status==='paid')changes.pending_to_paid++;if(old.payment_status==='unknown'&&row.payment_status==='paid')changes.unknown_to_paid++}
  if(!old.paid_at&&row.paid_at)changes.paid_at_added++;if(proposed.payment_method)changes.payment_method++;if(!old.shipped_at&&row.shipped_at)changes.shipped_at_added++;if(proposed.note)changes.note++;if(proposed.credit)changes.credit++;if(proposed.split_completed_at)changes.split_completed_at++
}

const used=new Set(),staging=[]
const matchedClassification=(candidate,row,exactReason,changedReason)=>{
  const proposed=mutableDiff(candidate,row)
  return Object.keys(proposed).length===0
    ?{classification:'existing_exact',match:candidate,confidence:1,reason:exactReason,proposed_changes:{}}
    :{classification:'existing_changed',match:candidate,confidence:.99,reason:changedReason,proposed_changes:proposed}
}

for(const row of resolvedRows){
  row.identity=variants(row)[0];row.signature=hash(`${row.identity}|${row.source_row}`)
  let result={classification:'review_required',match:null,confidence:0,reason:'Dados obrigatórios ausentes ou inconsistentes.',proposed_changes:{}}
  const splitProvided=hasSplitColumn&&hasExplicitSourceValue(row.raw['DATA DO SPLIT'])
  const essentialsValid=Boolean(row.client&&row.date&&row.perfume&&['apc','split'].includes(row.type)&&(!splitProvided||(row.split_completed_at&&row.type==='split')))

  if(row.cancelled_source){
    const candidates=essentialsValid&&row.amount!==null?indexedCandidates(indexes.noMl,row,new Set(['ml']),used):[]
    if(candidates.length===1){
      result=matchedClassification(candidates[0],row,'Cancelamento da fonte vinculado à única venda histórica, sem alterar o volume.','Cancelamento da fonte vinculado à única venda histórica; somente campos mutáveis explícitos diferem.')
      result.cancelled_source_disposition='matched_existing'
    }else{
      result={classification:'skipped_cancelled_source',match:null,confidence:candidates.length?0.5:1,reason:candidates.length?'Mais de uma venda histórica possível para o cancelamento da fonte; nenhuma escrita permitida.':'Nenhuma venda histórica única para o cancelamento da fonte; linha ignorada sem escrita.',proposed_changes:{},cancelled_source_disposition:'skipped'}
    }
  }else if(row.historical_zero_candidate){
    const candidates=essentialsValid&&row.ml!==null?indexedCandidates(indexes.noAmount,row,new Set(['amount']),used).filter((candidate)=>candidate.amount===0):[]
    if(candidates.length===1){
      result=matchedClassification(candidates[0],row,'Valor vazio usado somente para corresponder à venda histórica de valor zero.','Venda histórica de valor zero encontrada; somente campos mutáveis explícitos diferem.')
      result.zero_value_matching={matching_amount:0,preserve_sale_amount:true,never_create_new:true}
    }else if(candidates.length>1){
      result={classification:'possible_duplicate',match:null,confidence:.5,reason:'Mais de uma venda histórica de valor zero corresponde à linha; nenhuma escrita permitida.',proposed_changes:{}}
    }else{
      result={classification:'review_required',match:null,confidence:0,reason:'Valor vazio sem correspondência histórica única de valor zero; a linha nunca pode criar uma venda nova.',proposed_changes:{}}
    }
  }else if(!essentialsValid||row.ml===null||row.amount===null){
    result={classification:'review_required',match:null,confidence:0,reason:'Dados obrigatórios ausentes ou inconsistentes.',proposed_changes:{}}
  }else{
    const exactCandidates=indexedCandidates(indexes.core,row,new Set(),used)
    const exactMutable=exactCandidates.find((candidate)=>Object.keys(mutableDiff(candidate,row)).length===0)
    if(exactMutable)result=matchedClassification(exactMutable,row,'Identidade e campos mutáveis equivalentes.','Identidade comercial exata; campos mutáveis alterados.')
    else if(exactCandidates.length===1)result=matchedClassification(exactCandidates[0],row,'Identidade e campos mutáveis equivalentes.','Identidade comercial exata; campos mutáveis alterados.')
    else if(exactCandidates.length>1)result={classification:'possible_duplicate',match:null,confidence:.75,reason:'Mais de uma venda existente com a mesma identidade comercial.',proposed_changes:{}}
    else if(row.approved_new_decision)result={classification:'new_safe',match:null,confidence:1,reason:`Venda nova aprovada explicitamente: ${row.approved_new_decision}.`,proposed_changes:{}}
    else if(ambiguousNewClients.has(row.client))result={classification:'possible_duplicate',match:null,confidence:.4,reason:'Cliente novo semelhante a cadastro existente; revisão humana obrigatória.',proposed_changes:{}}
    else if(possiblePerfumeAliases.has(row.perfume))result={classification:'possible_duplicate',match:null,confidence:.5,reason:'Perfume novo semelhante a descrição existente; possível alias ou perfume distinto.',proposed_changes:{}}
    else {
      const near=unique([
        ...indexedCandidates(indexes.noAmount,row,new Set(['amount']),used),
        ...indexedCandidates(indexes.noMl,row,new Set(['ml']),used),
        ...indexedCandidates(indexes.noPerfume,row,new Set(['perfume']),used),
      ])
      if(near.length>=1)result={classification:'possible_duplicate',match:null,confidence:near.length===1?.7:.65,reason:near.length===1?'Uma dimensão da identidade comercial diverge; revisão humana obrigatória.':'Múltiplas correspondências comerciais próximas.',proposed_changes:{}}
      else result={classification:'new_safe',match:null,confidence:.95,reason:'Sem correspondência exata ou próxima na base atual.',proposed_changes:{}}
    }
  }

  if(result.match){used.add(result.match.id);if(result.classification==='existing_changed')recordChanges(result.match,row,result.proposed_changes)}
  staging.push({...row,classification:result.classification,match_candidate:result.match?.id??null,confidence:result.confidence,reason:result.reason,proposed_changes:result.proposed_changes,cancelled_source_disposition:result.cancelled_source_disposition??null,zero_value_matching:result.zero_value_matching??null,database_write_planned:false})
}

const classificationNames=['existing_exact','existing_changed','new_safe','possible_duplicate','review_required','skipped_cancelled_source']
const counts=Object.fromEntries(classificationNames.map((name)=>[name,staging.filter((row)=>row.classification===name).length]))
const newRows=staging.filter((row)=>row.classification==='new_safe'),sum=(rows,field)=>Math.round(rows.reduce((total,row)=>total+Number(row[field]??0),0)*100)/100
const newClientNames=new Set(newRows.filter((row)=>!row.resolved_client_id&&!normalizedExistingClients.has(row.client)).map((row)=>row.client))
const trueNewPerfumeNames=new Set(newRows.filter((row)=>!row.resolved_perfume_id&&!normalizedExistingPerfumes.has(row.perfume)).map((row)=>row.perfume))
const clientReport={current:clients.length,in_sheet:sheetClientNames.size,existing:sheetClientNames.size-newClientNames.size,new_safe:newClientNames.size,possible_duplicate:ambiguousNewClients.size,review_required:0}
const perfumeReport={current:perfumes.length,in_sheet:sheetPerfumeNames.size,existing:sheetPerfumeNames.size-trueNewPerfumeNames.size,new_safe:trueNewPerfumeNames.size,possible_alias:possiblePerfumeAliases.size,review_required:0}
const monthly=Object.entries(newRows.reduce((acc,row)=>{const month=row.date.slice(0,7);acc[month]=(acc[month]??0)+1;return acc},{})).sort()
const missingFromNewSource=existing.length-used.size
const stockBefore=inventoryBaseline(snapshot.tables)
const special={
  milk_plus_new_sales:newRows.filter((row)=>isApprovedDistinctMilkPlus(row.source_perfume)).length,
  musc_rogue_alias_sales:newRows.filter((row)=>approvedPerfumeAlias(row.source_perfume)?.decision==='MUSC_ROGUE_TO_MUSC_ROUGE').length,
  ana_paula_giombelli_new_sales:newRows.filter((row)=>row.approved_new_decision==='ANA_PAULA_GIOMBELI_NEW').length,
  zero_value_historical_matched:staging.filter((row)=>row.zero_value_matching&&row.match_candidate).length,
  cancelled_historical_matched:staging.filter((row)=>row.cancelled_source_disposition==='matched_existing').length,
  cancelled_skipped:counts.skipped_cancelled_source,
}
const delta={sales:newRows.length,value:sum(newRows,'amount'),ml:sum(newRows,'ml'),paid:sum(newRows.filter((row)=>row.payment_status==='paid'),'amount'),pending:sum(newRows.filter((row)=>row.payment_status==='pending'),'amount'),cancelled:sum(newRows.filter((row)=>row.payment_status==='cancelled'),'amount'),unknown:sum(newRows.filter((row)=>row.payment_status==='unknown'),'amount'),new_split:newRows.filter((row)=>row.type==='split').length,new_apc:newRows.filter((row)=>row.type==='apc').length,first_date:newRows.map((row)=>row.date).sort()[0]??null,last_date:newRows.map((row)=>row.date).sort().at(-1)??null,monthly}
const requestedTotals={
  TOTAL_SALES_CANDIDATES:staging.length,UNCHANGED:counts.existing_exact,CHANGED:counts.existing_changed,NEW:counts.new_safe,
  AMBIGUOUS:counts.possible_duplicate,REVIEW_REQUIRED:counts.review_required,SKIPPED_CANCELLED_SOURCE:counts.skipped_cancelled_source,
  MISSING_FROM_NEW_SOURCE:missingFromNewSource,MILK_PLUS_NEW_SALES:special.milk_plus_new_sales,MUSC_ROGUE_ALIAS_SALES:special.musc_rogue_alias_sales,
  ANA_PAULA_GIOMBELLI_NEW_SALES:special.ana_paula_giombelli_new_sales,ZERO_VALUE_HISTORICAL_MATCHED:special.zero_value_historical_matched,
  CANCELLED_HISTORICAL_MATCHED:special.cancelled_historical_matched,CANCELLED_SKIPPED:special.cancelled_skipped,CLIENTS_NEW:newClientNames.size,
  PERFUMES_TRUE_NEW:trueNewPerfumeNames.size,NEW_SPLIT:delta.new_split,NEW_APC:delta.new_apc,VALUE_NEW:delta.value,
}
const report={
  created_at:new Date().toISOString(),source:path.basename(input),snapshot:path.basename(resolvedSnapshot),zero_write:true,database_reads_only:true,database_writes:0,
  layout:{columns:headers.length,has_split_column:hasSplitColumn},
  total_lines:staging.length,ignored_operational_lines:ignoredOperationalRows.length,valid_lines:staging.length-counts.review_required-counts.possible_duplicate,
  rejected:counts.review_required,...counts,missing_from_new_source:missingFromNewSource,preserve_missing:true,clients:clientReport,perfumes:perfumeReport,
  delta,changes,special,inventory_before:stockBefore,inventory_effect:{inventory_items:0,inventory_movements:0,inventory_purchase_entries:0,physical_ml:0,'RUAH-P':0},
  missing_reconciliation:{human_reviewed_total:140,zero_value_historical_matched:special.zero_value_historical_matched,cancelled_historical_matched:special.cancelled_historical_matched,recalculated_missing:missingFromNewSource,arithmetic_reconciled:140-special.zero_value_historical_matched-special.cancelled_historical_matched===missingFromNewSource,policy:'preserve_all_no_delete_no_cancel_no_automatic_change'},
  requested_totals:requestedTotals,gate:{ambiguous_must_be_zero:counts.possible_duplicate===0,review_is_visible:true,zero_write:true},
}
const outputDir='private_data';fs.mkdirSync(outputDir,{recursive:true});const suffix=new Date().toISOString().replace(/[:.]/g,'-')
fs.writeFileSync(path.join(outputDir,`incremental-staging-${suffix}.json`),JSON.stringify({report,rows:staging}))
fs.writeFileSync(path.join(outputDir,`incremental-report-${suffix}.json`),JSON.stringify(report,null,2))
console.log(JSON.stringify(report,null,2))
