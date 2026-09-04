import {approvedClientAlias,approvedNewSaleDecision,approvedPerfumeAlias,commercialPerfumeBase,hasExplicitSourceValue,isApprovedDistinctMilkPlus,isCancelledSourceMl,isHistoricalZeroMatchingValue,normalizeDecisionText as normalize} from './incremental-approved-decisions.mjs'

const ACTIVE_ALLOCATION_STATUSES = new Set(['reserved', 'shipping', 'shipped'])
const round = (value) => Math.round(Number(value ?? 0) * 1000) / 1000
const sameNumber = (left, right) => Number(left) === Number(right)
const dayDistance = (left, right) => {
  const a = Date.parse(`${left}T00:00:00Z`), b = Date.parse(`${right}T00:00:00Z`)
  return Number.isFinite(a) && Number.isFinite(b) ? Math.abs(a - b) / 86400000 : Number.POSITIVE_INFINITY
}
const distance = (a, b) => {
  const previous = Array.from({length: b.length + 1}, (_, index) => index)
  for (let i = 1; i <= a.length; i += 1) {
    let diagonal = previous[0]
    previous[0] = i
    for (let j = 1; j <= b.length; j += 1) {
      const above = previous[j]
      previous[j] = Math.min(previous[j] + 1, previous[j - 1] + 1, diagonal + (a[i - 1] === b[j - 1] ? 0 : 1))
      diagonal = above
    }
  }
  return previous[b.length]
}
const similar = (left, right) => Boolean(left && right) && (left === right || distance(left, right) <= 2 || (left.length > 8 && right.length > 8 && (left.includes(right) || right.includes(left))))
const add = (map, key, value) => map.set(key, [...(map.get(key) ?? []), value])
const byId = (rows) => new Map(rows.map((row) => [row.id, row]))
const indexKey = (...parts) => parts.map((part) => String(part ?? '')).join('|')
const numeric = (value) => {
  if (typeof value === 'number' && Number.isFinite(value)) return round(value)
  const raw = String(value ?? '').trim().replace(/^R\$\s*/i, '').replace(/\s/g, '')
  if (!raw || !/^-?[\d.,]+$/.test(raw)) return null
  const parsed = Number(raw.includes(',') ? raw.replace(/\./g, '').replace(',', '.') : raw)
  return Number.isFinite(parsed) ? round(parsed) : null
}
const sourceDate = (value) => {
  const raw = String(value ?? '').trim()
  const iso = raw.match(/^\d{4}-\d{2}-\d{2}/)?.[0]
  if (iso) return iso
  const mdy = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/)
  return mdy ? `${mdy[3]}-${mdy[1].padStart(2, '0')}-${mdy[2].padStart(2, '0')}` : null
}
const sourceStatus = (value) => {
  const status = normalize(value)
  if (['pago', 'paga', 'quitado', 'paid'].includes(status)) return 'paid'
  if (status.includes('cancel') || status.includes('estorn')) return 'cancelled'
  if (status.includes('aguard') || status.includes('pendente') || status.includes('nao pago') || status === 'pending') return 'pending'
  return 'unknown'
}
const uniqueTarget = (map, key) => {
  const values = [...new Set((map.get(key) ?? []).map((row) => typeof row === 'string' ? row : row.id))]
  return values.length === 1 ? values[0] : null
}

const saleView = (sale, clients, perfumes) => ({
  id: sale.id,
  organization_id: sale.organization_id,
  client_id: sale.client_id,
  perfume_id: sale.perfume_id,
  client: normalize(clients.get(sale.client_id)?.name ?? sale.client_name_raw ?? sale.original_client),
  client_name: clients.get(sale.client_id)?.name ?? sale.client_name_raw ?? sale.original_client ?? 'Cliente',
  perfume: normalize(perfumes.get(sale.perfume_id)?.full_name_raw ?? sale.perfume_name_raw),
  perfume_name: perfumes.get(sale.perfume_id)?.full_name_raw ?? sale.perfume_name_raw ?? 'Perfume',
  date: String(sale.sale_date ?? '').slice(0, 10),
  type: normalize(sale.sale_type),
  ml: Number(sale.volume_ml),
  amount: Number(sale.amount),
  raw: sale,
})

const rowClientMatches = (row, sale) => row.resolved_client_id
  ? row.resolved_client_id === sale.client_id
  : normalize(row.client ?? row.display_client) === sale.client
const rowPerfumeMatches = (row, sale) => row.resolved_perfume_id
  ? row.resolved_perfume_id === sale.perfume_id
  : normalize(row.perfume ?? row.display_perfume) === sale.perfume

/**
 * Converte as linhas já lidas no navegador para o mesmo contrato de staging
 * consumido pelo CLI. Não consulta nem altera banco; usa somente o snapshot.
 */
export function stageDaviParsedRows(parsedRows, snapshot) {
  const tables = snapshot.tables ?? snapshot
  const clients = (tables.clients ?? []).filter((row) => row.deleted_at == null)
  const perfumes = tables.perfumes ?? []
  const clientsById = byId(clients), perfumesById = byId(perfumes)
  const sales = (tables.sales ?? []).filter((row) => row.deleted_at == null).map((sale) => ({
    ...saleView(sale, clientsById, perfumesById),
    source_client: normalize(sale.client_name_raw ?? sale.original_client ?? clientsById.get(sale.client_id)?.name),
    source_perfume: normalize(sale.perfume_name_raw ?? perfumesById.get(sale.perfume_id)?.full_name_raw),
    payment_status: sourceStatus(sale.payment_status), payment_method: normalize(sale.payment_method),
    paid_at: sourceDate(sale.paid_at), shipped_at: sourceDate(sale.shipped_at), credit: numeric(sale.credit_reference_amount),
    note: normalize(sale.notes), split_completed_at: sourceDate(sale.split_completed_at),
  }))
  const clientsByName = new Map(), perfumesByName = new Map(), historicalClients = new Map(), historicalPerfumes = new Map()
  for (const client of clients) add(clientsByName, normalize(client.name), client)
  for (const perfume of perfumes) add(perfumesByName, normalize(perfume.full_name_raw), perfume)
  for (const sale of sales) {
    const rawClient = normalize(sale.raw.client_name_raw ?? sale.raw.original_client)
    const rawPerfume = normalize(sale.raw.perfume_name_raw)
    if (rawClient) add(historicalClients, rawClient, sale.client_id)
    if (rawPerfume) add(historicalPerfumes, rawPerfume, sale.perfume_id)
  }
  const variants = (row, omit = new Set()) => {
    const clientNames = [...new Set([row.client, row.source_client].filter(Boolean))]
    const perfumeNames = [...new Set([row.perfume, row.source_perfume].filter(Boolean))]
    const values = []
    for (const client of clientNames) for (const perfume of perfumeNames) values.push(indexKey(client,row.date,...(omit.has('perfume')?[]:[perfume]),row.type,...(omit.has('ml')?[]:[row.ml]),...(omit.has('amount')?[]:[row.amount])))
    return [...new Set(values)]
  }
  const core = new Map(), noAmount = new Map(), noMl = new Map(), noPerfume = new Map()
  for (const sale of sales) {
    for (const key of variants(sale)) add(core,key,sale)
    for (const key of variants(sale,new Set(['amount']))) add(noAmount,key,sale)
    for (const key of variants(sale,new Set(['ml']))) add(noMl,key,sale)
    for (const key of variants(sale,new Set(['perfume']))) add(noPerfume,key,sale)
  }
  const indexed = (map,row,omit,used) => [...new Map(variants(row,omit).flatMap((key)=>map.get(key)??[]).map((sale)=>[sale.id,sale])).values()].filter((sale)=>!used.has(sale.id))
  const existingClientNames=[...clientsByName.keys()],existingPerfumeNames=[...perfumesByName.keys()]
  const used = new Set()
  const resolved = parsedRows.map((parsed) => {
    const raw = parsed.raw ?? parsed
    const displayClient = String(parsed.client ?? raw.CLIENTE ?? '').trim()
    const displayPerfume = String(raw.PERFUME ?? parsed.perfume ?? '').trim()
    const clientName = normalize(displayClient), perfumeName = normalize(displayPerfume)
    const directClient = uniqueTarget(clientsByName, clientName)
    const clientAlias=approvedClientAlias(clientName),perfumeAlias=approvedPerfumeAlias(perfumeName)
    const directPerfume = uniqueTarget(perfumesByName, perfumeName)
    const basePerfume = uniqueTarget(perfumesByName, commercialPerfumeBase(perfumeName))
    const resolvedClientId = clientAlias?.targetId ?? directClient ?? uniqueTarget(historicalClients, clientName)
    const resolvedPerfumeId = perfumeAlias?.targetId ?? directPerfume ?? basePerfume ?? (isApprovedDistinctMilkPlus(perfumeName)?null:uniqueTarget(historicalPerfumes, perfumeName))
    const date = sourceDate(raw.DATA) ?? parsed.date, type = normalize(raw.TIPO ?? parsed.type)
    const ml = numeric(raw.ML ?? parsed.ml), amount = parsed.amount ?? numeric(raw.VALOR ?? parsed.amount)
    const paymentStatus = parsed.paymentStatus ?? sourceStatus(raw.PAGAMENTO)
    const base = {
      source_row: parsed.row ?? raw.sourceRow,
      display_client: displayClient, client: resolvedClientId ? normalize(clientsById.get(resolvedClientId)?.name) : clientName,
      resolved_client_id: resolvedClientId ?? undefined,
      display_perfume: displayPerfume, perfume: resolvedPerfumeId ? normalize(perfumesById.get(resolvedPerfumeId)?.full_name_raw) : perfumeName,
      resolved_perfume_id: resolvedPerfumeId ?? undefined,
      date, type, ml, amount, payment_status: paymentStatus,
      source_client:clientName,source_perfume:perfumeName,
      payment_method: normalize(raw['FORMA DE PAGAMENTO'] ?? parsed.paymentMethod), paid_at: sourceDate(raw['DATA PAGMT']), shipped_at: sourceDate(raw['DATA DE ENVIO']),credit:numeric(raw['CRÉDITO']),note:normalize(raw['OBSERVAÇÃO']),split_completed_at:sourceDate(raw['DATA DO SPLIT']),
      raw, proposed_changes: {}, signature: indexKey(clientName, date, perfumeName, type, ml, amount, parsed.row ?? raw.sourceRow),
      historical_zero_candidate:isHistoricalZeroMatchingValue(raw.VALOR),cancelled_source:isCancelledSourceMl(raw.ML),
      explicit_mutable:{payment_status:hasExplicitSourceValue(raw.PAGAMENTO),payment_method:hasExplicitSourceValue(raw['FORMA DE PAGAMENTO']),paid_at:hasExplicitSourceValue(raw['DATA PAGMT']),shipped_at:hasExplicitSourceValue(raw['DATA DE ENVIO']),credit:hasExplicitSourceValue(raw['CRÉDITO']),note:hasExplicitSourceValue(raw['OBSERVAÇÃO']),split_completed_at:hasExplicitSourceValue(raw['DATA DO SPLIT'])},
    }
    base.approved_new_decision=approvedNewSaleDecision(base)
    return base
  })
  const ambiguousClients=new Set(resolved.filter(row=>!row.resolved_client_id&&!clientsByName.has(row.client)&&existingClientNames.some(name=>similar(row.client,name))).map(row=>row.client))
  const ambiguousPerfumes=new Set(resolved.filter(row=>!row.resolved_perfume_id&&!isApprovedDistinctMilkPlus(row.source_perfume)&&!perfumesByName.has(row.perfume)&&existingPerfumeNames.some(name=>similar(row.perfume,name))).map(row=>row.perfume))
  const rows=resolved.map((base)=>{
    const{displayClient,displayPerfume}= {displayClient:base.display_client,displayPerfume:base.display_perfume}
    const{date,type,ml,amount,payment_status:paymentStatus,resolved_client_id:resolvedClientId,resolved_perfume_id:resolvedPerfumeId}=base
    const mutableDiff=(sale)=>Object.fromEntries(['payment_status','payment_method','paid_at','shipped_at','credit','note','split_completed_at'].filter(field=>base.explicit_mutable[field]&&sale[field]!==base[field]).map(field=>[field,{before:sale[field],after:base[field]}]))
    const finishMatch = (match, reason) => {
      used.add(match.id)
      const changes = mutableDiff(match)
      return {...base, classification: Object.keys(changes).length ? 'existing_changed' : 'existing_exact', match_candidate: match.id, confidence: Object.keys(changes).length ? 0.99 : 1, reason: Object.keys(changes).length ? 'Identidade comercial exata; campos mutáveis alterados.' : reason, proposed_changes: changes}
    }
    const essentials=Boolean(base.client&&date&&base.perfume&&['apc','split'].includes(type))
    if(base.cancelled_source){
      const candidates=essentials&&amount!==null?indexed(noMl,base,new Set(['ml']),used):[]
      if(candidates.length===1)return finishMatch(candidates[0],'Cancelamento da fonte vinculado à única venda histórica, sem alterar o volume.')
      return{...base,classification:'skipped_cancelled_source',match_candidate:null,confidence:candidates.length?0.5:1,reason:candidates.length?'Mais de uma venda histórica possível para o cancelamento da fonte.':'Linha cancelada sem venda correspondente.'}
    }
    if(base.historical_zero_candidate){
      const candidates=essentials&&ml!==null?indexed(noAmount,base,new Set(['amount']),used).filter(sale=>sale.amount===0):[]
      if(candidates.length===1)return finishMatch(candidates[0],'Valor vazio usado somente para corresponder à venda histórica de valor zero.')
      return{...base,classification:candidates.length?'possible_duplicate':'review_required',match_candidate:null,confidence:candidates.length?0.5:0,reason:candidates.length?'Mais de uma venda histórica de valor zero corresponde à linha.':'Campo obrigatório ausente: valor.'}
    }
    if (!essentials || ml == null || amount == null) {
      return {...base, classification: 'review_required', match_candidate: null, confidence: 0, reason: 'Dados obrigatórios ausentes ou inconsistentes.'}
    }
    const exact=indexed(core,base,new Set(),used)
    const exactMutable=exact.find(sale=>Object.keys(mutableDiff(sale)).length===0)
    if (exactMutable) return finishMatch(exactMutable, 'Identidade e campos mutáveis equivalentes.')
    if (exact.length === 1) return finishMatch(exact[0], 'Identidade e campos mutáveis equivalentes.')
    if (exact.length > 1) return {...base, classification: 'possible_duplicate', match_candidate: null, confidence: 0.75, reason: 'Mais de uma venda existente com a mesma identidade comercial.'}
    if(base.approved_new_decision)return{...base,classification:'new_safe',match_candidate:null,confidence:1,reason:`Venda nova aprovada explicitamente: ${base.approved_new_decision}.`}
    if(ambiguousClients.has(base.client))return{...base,classification:'possible_duplicate',match_candidate:null,confidence:0.4,reason:'Cliente novo semelhante a cadastro existente; revisão humana obrigatória.'}
    if(ambiguousPerfumes.has(base.perfume))return{...base,classification:'possible_duplicate',match_candidate:null,confidence:0.5,reason:'Perfume novo semelhante a descrição existente; possível alias ou perfume distinto.'}
    const near=[...new Map([...indexed(noAmount,base,new Set(['amount']),used),...indexed(noMl,base,new Set(['ml']),used),...indexed(noPerfume,base,new Set(['perfume']),used)].map(sale=>[sale.id,sale])).values()]
    if(near.length)return{...base,classification:'possible_duplicate',match_candidate:null,confidence:near.length===1?0.7:0.65,reason:near.length===1?'Uma dimensão da identidade comercial diverge; revisão humana obrigatória.':'Múltiplas correspondências comerciais próximas.'}
    return {...base, classification: 'new_safe', match_candidate: null, confidence: 0.95, reason: 'Sem correspondência exata ou próxima na base atual.'}
  })
  return {organization_id: snapshot.organization_id, rows}
}

const candidateReason = (row, sale) => {
  const client = rowClientMatches(row, sale)
  const perfume = rowPerfumeMatches(row, sale)
  const type = normalize(row.type) === sale.type
  const ml = sameNumber(row.ml, sale.ml)
  const amount = sameNumber(row.amount, sale.amount)
  const days = dayDistance(row.date, sale.date)
  const date = days === 0
  if (client && perfume && type && ml && amount && date) return {kind: 'probable', confidence: 0.98, reason: 'Mesma identidade comercial completa; existem múltiplas vendas candidatas.'}
  if (client && perfume && type && ml && amount && days <= 3) return {kind: 'probable', confidence: 0.9, reason: `Mesmo cliente + perfume + tipo + ml + valor; data próxima (${days} dia(s)).`}
  if (client && perfume && type && date && (!ml || !amount)) return {kind: 'conflict', confidence: 0.82, reason: `Mesmo cliente + perfume + tipo + data, mas ${ml ? 'valor' : amount ? 'ml' : 'ml e valor'} diverge(m).`}
  if (client && type && ml && amount && date && !perfume) return {kind: 'conflict', confidence: 0.78, reason: 'Cliente + tipo + ml + valor + data coincidem, mas o perfume diverge.'}
  const fuzzyClient = !row.resolved_client_id && similar(normalize(row.client ?? row.display_client), sale.client)
  const fuzzyPerfume = !row.resolved_perfume_id && similar(normalize(row.perfume ?? row.display_perfume), sale.perfume)
  if ((client || fuzzyClient) && (perfume || fuzzyPerfume) && type && ml && amount && days <= 3) {
    return {kind: 'probable', confidence: 0.7, reason: 'Identidade comercial coincide após similaridade textual; revisão humana obrigatória.'}
  }
  return null
}

const candidateSummary = (sale) => ({sale_id: sale.id, client_id: sale.client_id, client: sale.client_name, perfume_id: sale.perfume_id, perfume: sale.perfume_name, date: sale.date, type: sale.type, ml: sale.ml, amount: sale.amount})

const classifyIdentity = (row, sales) => {
  if (['existing_exact', 'existing_changed'].includes(row.classification) && row.match_candidate) {
    return {
      identity_classification: 'EXACT_EXISTING',
      action: row.classification === 'existing_changed' ? 'atualizar' : 'ignorar_sem_mudanca',
      sale_id: row.match_candidate,
      candidate_sale_ids: [row.match_candidate],
      reason: row.reason,
      confidence: row.confidence,
    }
  }
  if (row.classification === 'new_safe') return {identity_classification: 'NEW_SALE', action: 'criar_apos_aprovacao', sale_id: null, candidate_sale_ids: [], reason: row.reason, confidence: row.confidence}
  if (['review_required', 'skipped_cancelled_source'].includes(row.classification)) {
    return {identity_classification: 'INVALID', action: 'revisar', sale_id: null, candidate_sale_ids: [], reason: row.reason, confidence: row.confidence}
  }

  const candidates = sales.map((sale) => ({sale, match: candidateReason(row, sale)})).filter((item) => item.match)
    .sort((left, right) => right.match.confidence - left.match.confidence || left.sale.id.localeCompare(right.sale.id))
  const best = candidates[0]
  if (!best) return {identity_classification: 'PROBABLE_DUPLICATE', action: 'revisar', sale_id: null, candidate_sale_ids: [], reason: row.reason, confidence: row.confidence}
  const matchingCandidates = candidates.filter((item) => item.match.confidence === best.match.confidence)
  return {
    identity_classification: best.match.kind === 'conflict' ? 'CONFLICT' : 'PROBABLE_DUPLICATE',
    action: 'revisar',
    sale_id: matchingCandidates.length === 1 ? best.sale.id : null,
    candidate_sale_ids: matchingCandidates.map((item) => item.sale.id),
    reason: best.match.reason,
    confidence: best.match.confidence,
    existing_matches: matchingCandidates.map((item) => candidateSummary(item.sale)),
  }
}

const allocationNeed = (row, identity, sale, activeAllocation, options) => {
  if (!['EXACT_EXISTING', 'NEW_SALE'].includes(identity.identity_classification)) return {required: false, review_excluded: true, reason: 'Identidade sem decisão automática; estoque não foi presumido.'}
  if (identity.identity_classification === 'EXACT_EXISTING' && row.classification === 'existing_exact') return {required: false, reason: 'Venda existente sem escrita planejada.'}

  const paymentStatus = row.payment_status ?? sale?.payment_status
  const eligible = identity.identity_classification === 'NEW_SALE'
    ? options.newSaleAllocationEligible
    : Boolean(sale?.inventory_allocation_eligible)
  if (!eligible) return {required: false, reason: 'Venda histórica ou explicitamente inelegível para alocação.'}
  if (paymentStatus !== 'paid') return {required: false, reason: 'Venda não ficará paga nesta aplicação.'}
  if (!row.resolved_perfume_id && !sale?.perfume_id) return {required: true, missing_reference: true, needed_ml: round(row.ml), reason: 'Perfume não resolvido.'}

  const currentAllocated = activeAllocation ? Number(activeAllocation.quantity_ml) : 0
  const targetMl = Number(row.ml ?? sale?.volume_ml)
  return {
    required: true,
    needed_ml: round(targetMl - currentAllocated),
    target_ml: round(targetMl),
    already_allocated_ml: round(currentAllocated),
    reason: activeAllocation ? 'Somente o delta em relação à alocação ativa.' : 'Nova reserva operacional necessária.',
  }
}

export function analyzeDaviImport({staging, snapshot, options = {}}) {
  const resolvedOptions = {newSaleAllocationEligible: true, ...options}
  const tables = snapshot.tables ?? snapshot
  const clients = byId((tables.clients ?? []).filter((row) => row.deleted_at == null))
  const perfumes = byId(tables.perfumes ?? [])
  const currentSales = (tables.sales ?? []).filter((row) => row.deleted_at == null)
  const saleMap = byId(currentSales)
  const sales = currentSales.map((sale) => saleView(sale, clients, perfumes))
  const activeAllocations = (tables.inventory_allocations ?? []).filter((row) => ACTIVE_ALLOCATION_STATUSES.has(row.status))
  const allocationBySale = new Map()
  for (const allocation of activeAllocations) add(allocationBySale, allocation.sale_id, allocation)
  const activeItems = (tables.inventory_items ?? []).filter((item) => item.status === 'active')
  const itemsByPerfume = new Map()
  for (const item of activeItems) add(itemsByPerfume, indexKey(item.organization_id, item.perfume_id), item)

  const stagingBySourceRow = new Map(staging.rows.map((row) => [row.source_row, row]))
  const rows = staging.rows.map((row) => {
    const identity = classifyIdentity(row, sales)
    const sale = identity.sale_id ? saleMap.get(identity.sale_id) : null
    const allocations = sale ? allocationBySale.get(sale.id) ?? [] : []
    const allocationConflict = allocations.length > 1
    const activeAllocation = allocations.length === 1 ? allocations[0] : null
    const need = allocationNeed(row, identity, sale, activeAllocation, resolvedOptions)
    return {
      source_row: row.source_row,
      client: row.display_client,
      perfume: row.display_perfume,
      type: row.type,
      ml: row.ml,
      amount: row.amount,
      date: row.date,
      source_signature: row.signature ?? null,
      payment_status: row.payment_status,
      proposed_changes: row.proposed_changes,
      ...identity,
      allocation_need: {...need, allocation_conflict: allocationConflict},
      inventory: null,
    }
  })

  const demandRows = []
  for (const result of rows) {
    const need = result.allocation_need
    if (need.review_excluded) {
      result.stock_classification = null
      result.stock_reason = need.reason
      continue
    }
    if (!need.required || need.needed_ml <= 0) {
      result.stock_classification = 'STOCK_NOT_REQUIRED'
      result.stock_reason = need.needed_ml < 0 ? 'A alteração liberaria estoque; nenhuma demanda adicional.' : need.reason
      continue
    }
    if (need.allocation_conflict) {
      result.stock_classification = null
      result.stock_reason = 'Mais de uma alocação ativa para a venda; revisão manual obrigatória.'
      continue
    }
    const sale = result.sale_id ? saleMap.get(result.sale_id) : null
    const perfumeId = sale?.perfume_id ?? stagingBySourceRow.get(result.source_row)?.resolved_perfume_id
    const organizationId = sale?.organization_id ?? staging.organization_id ?? snapshot.organization_id ?? currentSales[0]?.organization_id
    const items = itemsByPerfume.get(indexKey(organizationId, perfumeId)) ?? []
    if (need.missing_reference || items.length === 0) {
      result.stock_classification = 'STOCK_ITEM_MISSING'
      result.stock_reason = 'Nenhum inventory_item ativo e aplicável foi encontrado.'
      result.inventory = {perfume_id: perfumeId ?? null, needed_ml: need.needed_ml}
      continue
    }
    if (items.length > 1) {
      result.stock_classification = null
      result.stock_reason = 'Mais de um inventory_item ativo para o perfume; revisão manual obrigatória.'
      continue
    }
    const item = items[0]
    if (result.date && item.reference_date && result.date < String(item.reference_date).slice(0, 10)) {
      result.stock_classification = 'STOCK_NOT_REQUIRED'
      result.stock_reason = 'Venda anterior à data de referência do item; regra atual não aloca.'
      result.inventory = {inventory_item_id: item.id, perfume_id: item.perfume_id, available_ml: round(item.available_ml), needed_ml: 0}
      continue
    }
    demandRows.push({result, item, need})
  }

  const running = new Map(activeItems.map((item) => [item.id, Number(item.available_ml)]))
  for (const {result, item, need} of demandRows.sort((left, right) => left.result.source_row - right.result.source_row)) {
    const before = running.get(item.id)
    const after = round(before - need.needed_ml)
    running.set(item.id, after)
    result.stock_classification = after >= 0 ? 'STOCK_OK' : 'STOCK_INSUFFICIENT'
    result.stock_reason = after >= 0 ? 'Saldo projetado permanece não negativo.' : 'A demanda agregada até esta linha excede o saldo disponível.'
    result.inventory = {inventory_item_id: item.id, perfume_id: item.perfume_id, available_before_batch_ml: round(item.available_ml), running_before_ml: round(before), already_allocated_ml: need.already_allocated_ml, needed_ml: need.needed_ml, projected_after_row_ml: after}
  }

  const perfumeGroups = new Map()
  for (const item of activeItems) {
    const perfume = perfumes.get(item.perfume_id)
    perfumeGroups.set(item.id, {inventory_item_id: item.id, perfume_id: item.perfume_id, perfume: perfume?.full_name_raw ?? item.perfume_id, available_ml: round(item.available_ml), already_reserved_ml: 0, new_demand_ml: 0})
  }
  for (const allocation of activeAllocations) {
    const group = perfumeGroups.get(allocation.inventory_item_id)
    if (group) group.already_reserved_ml = round(group.already_reserved_ml + Number(allocation.quantity_ml))
  }
  for (const {item, need} of demandRows) {
    const group = perfumeGroups.get(item.id)
    group.new_demand_ml = round(group.new_demand_ml + need.needed_ml)
  }
  const inventory_by_perfume = [...perfumeGroups.values()].filter((group) => group.new_demand_ml > 0).map((group) => {
    const balance = round(group.available_ml - group.new_demand_ml)
    return {...group, projected_balance_ml: balance, deficit_ml: round(Math.max(0, -balance)), surplus_ml: round(Math.max(0, balance))}
  }).sort((left, right) => left.perfume.localeCompare(right.perfume))

  const count = (field, value) => rows.filter((row) => row[field] === value).length
  const volume = (classification) => round(rows.filter((row) => row.stock_classification === classification).reduce((sum, row) => sum + Number(row.inventory?.needed_ml ?? 0), 0))
  const identity = {
    new_sales: count('identity_classification', 'NEW_SALE'),
    updates: count('identity_classification', 'EXACT_EXISTING'),
    updates_with_changes: rows.filter((row) => row.identity_classification === 'EXACT_EXISTING' && Object.keys(row.proposed_changes ?? {}).length > 0).length,
    probable_duplicates: count('identity_classification', 'PROBABLE_DUPLICATE'),
    conflicts: count('identity_classification', 'CONFLICT'),
    invalid: count('identity_classification', 'INVALID'),
  }
  const stock = {
    stock_ok: {sales: count('stock_classification', 'STOCK_OK'), ml: volume('STOCK_OK')},
    stock_insufficient: {sales: count('stock_classification', 'STOCK_INSUFFICIENT'), ml: volume('STOCK_INSUFFICIENT')},
    stock_item_missing: {sales: count('stock_classification', 'STOCK_ITEM_MISSING'), ml: volume('STOCK_ITEM_MISSING')},
    stock_not_required: count('stock_classification', 'STOCK_NOT_REQUIRED'),
    excluded_for_manual_review: rows.filter((row) => row.stock_classification == null).length,
    perfumes_with_deficit: inventory_by_perfume.filter((group) => group.deficit_ml > 0).length,
    total_deficit_ml: round(inventory_by_perfume.reduce((sum, group) => sum + group.deficit_ml, 0)),
  }
  return {
    zero_write: true,
    simulation_policy: {new_sales_allocation_eligible: resolvedOptions.newSaleAllocationEligible, available_ml_is_net_of_existing_reservations: true, fuzzy_match_never_applied_automatically: true},
    total_lines: rows.length,
    identity,
    stock,
    inventory_by_perfume,
    rows,
  }
}

const stableHash = (value) => {
  let hash = 2166136261
  for (const character of String(value)) { hash ^= character.charCodeAt(0); hash = Math.imul(hash, 16777619) }
  return (hash >>> 0).toString(16).padStart(8, '0')
}
const perfumeIdentity = (value, stripBottle = false) => {
  let result = normalize(value).replace(/[‐‑‒–—―-]+/g, ' ').replace(/[^a-z0-9\s&+]/g, ' ').replace(/\s+/g, ' ').trim()
  if (stripBottle) result = result.replace(/\s*frasco\s*\d+\s*$/i, '').trim()
  return result
}
const finding = (code, severity, category, identity, fields) => ({
  id: `${code}:${stableHash(identity)}`, code, severity, category, ...fields,
})

/** Audita exclusivamente o estado persistido do CRM. Nenhuma linha de planilha é sintetizada. */
export function analyzeCurrentCrm(snapshot, options = {}) {
  const tables = snapshot.tables ?? snapshot
  const allSales = tables.sales ?? [], allClients = tables.clients ?? [], allPerfumes = tables.perfumes ?? []
  const orgCandidates = [...new Set([...allSales, ...(tables.inventory_items ?? []), ...(tables.inventory_allocations ?? [])].map(row => row.organization_id).filter(Boolean))]
  const organizationId = options.organizationId ?? snapshot.organization_id ?? (orgCandidates.length === 1 ? orgCandidates[0] : null)
  if (!organizationId) throw new Error('organization_id obrigatório para diagnóstico tenant-scoped.')
  const inOrg = (row) => row.organization_id === organizationId
  const clients = allClients.filter(inOrg), perfumes = allPerfumes.filter(inOrg), sales = allSales.filter(inOrg)
  const items = (tables.inventory_items ?? []).filter(inOrg), allocations = (tables.inventory_allocations ?? []).filter(inOrg)
  const shipments = (tables.shipments ?? []).filter(inOrg), shipmentItems = (tables.shipment_items ?? []).filter(inOrg)
  const preparationBatches = (tables.preparation_batches ?? []).filter(inOrg)
  const preparationBatchIds = new Set(preparationBatches.map(row => row.id))
  const preparationItems = (tables.preparation_batch_items ?? []).filter(row => preparationBatchIds.has(row.batch_id))
  const clientMap = byId(clients), perfumeMap = byId(perfumes), saleMap = byId(sales), itemMap = byId(items), allocationMap = byId(allocations)
  const shipmentMap = byId(shipments), preparationBatchMap = byId(preparationBatches)
  const findings = [], activeAllocations = allocations.filter(row => ACTIVE_ALLOCATION_STATUSES.has(row.status))
  const activeBySale = new Map(), activeByItem = new Map()
  for (const allocation of activeAllocations) { add(activeBySale, allocation.sale_id, allocation); add(activeByItem, allocation.inventory_item_id, allocation) }
  const activeShipmentByAllocation = new Map(shipmentItems.filter(row => row.removed_at == null).map(row => [row.allocation_id, shipmentMap.get(row.shipment_id)]))
  const confirmedPreparation = new Set(preparationItems.filter(row => preparationBatchMap.get(row.batch_id)?.status === 'confirmed').map(row => row.allocation_id))
  const addFinding = (entry) => findings.push(entry)

  const activeSales = sales.filter(sale => sale.deleted_at == null && sale.payment_status !== 'cancelled')
  const commercialGroups = new Map()
  for (const sale of activeSales) {
    const key = indexKey(sale.client_id, sale.perfume_id, sourceDate(sale.sale_date), normalize(sale.sale_type), numeric(sale.volume_ml), numeric(sale.amount))
    if (sale.client_id && sale.perfume_id && sale.sale_date && sale.sale_type && numeric(sale.volume_ml) != null && numeric(sale.amount) != null) add(commercialGroups, key, sale)
  }
  for (const [key, group] of commercialGroups) if (group.length > 1) addFinding(finding('POSSIBLE_DUPLICATE','REVIEW','duplicates',key,{
    title:'Possíveis vendas duplicadas',reason:'Mesmo cliente, perfume, data, tipo, ml e valor. A repetição pode ser legítima e exige revisão.',
    expected:'Uma identidade comercial por ocorrência comprovada',actual:{occurrences:group.length},sale_id:null,
    related_entities:{sale_ids:group.map(row=>row.id),client_id:group[0].client_id,perfume_id:group[0].perfume_id},
  }))

  const catalogByStrict = new Map(), rawTargets = new Map(), aliasPairs = new Map()
  for (const perfume of perfumes) add(catalogByStrict, perfumeIdentity(perfume.full_name_raw, true), perfume)
  for (const sale of activeSales) {
    const rawName = sale.perfume_name_raw ?? sale.raw_data?.PERFUME
    const canonical = perfumeMap.get(sale.perfume_id)
    if (!rawName || !canonical) continue
    const rawStrict = perfumeIdentity(rawName), canonicalStrict = perfumeIdentity(canonical.full_name_raw)
    const rawLoose = perfumeIdentity(rawName, true), canonicalLoose = perfumeIdentity(canonical.full_name_raw, true)
    add(rawTargets, rawStrict, sale.perfume_id)
    if (rawStrict === canonicalStrict) continue
    const catalogMatches = [...new Map((catalogByStrict.get(rawLoose) ?? []).map(row=>[row.id,row])).values()]
    const conflictingCatalog = catalogMatches.filter(row => row.id !== sale.perfume_id)
    if (conflictingCatalog.length === 1 && rawLoose !== canonicalLoose) {
      addFinding(finding('PERFUME_CONFLICT','WARNING','perfumes',`${sale.id}|${conflictingCatalog[0].id}`,{
        sale_id:sale.id,title:'Venda ligada a perfume diferente da origem',reason:'O nome original corresponde inequivocamente a outro perfume do catálogo.',
        expected:{perfume_id:conflictingCatalog[0].id,perfume:conflictingCatalog[0].full_name_raw},actual:{perfume_id:sale.perfume_id,perfume:canonical.full_name_raw,raw_perfume:rawName},
        related_entities:{perfume_ids:[sale.perfume_id,conflictingCatalog[0].id]},
      }))
    } else if (rawLoose === canonicalLoose || similar(rawLoose, canonicalLoose)) {
      const pairKey=indexKey(rawStrict,sale.perfume_id)
      const current=aliasPairs.get(pairKey)??{raw:rawName,canonical:canonical.full_name_raw,perfume_id:sale.perfume_id,sale_ids:[]}
      current.sale_ids.push(sale.id);aliasPairs.set(pairKey,current)
    }
  }
  for (const [key, ids] of rawTargets) if (new Set(ids).size > 1) addFinding(finding('PERFUME_CONFLICT','WARNING','perfumes',key,{
    sale_id:null,title:'Nome original aponta para mais de um perfume',reason:'A mesma descrição original está vinculada a perfumes canônicos diferentes.',
    expected:'Um único perfume canônico por nome de origem aprovado',actual:{perfume_ids:[...new Set(ids)]},related_entities:{perfume_ids:[...new Set(ids)]},
  }))
  for (const [key, pair] of aliasPairs) addFinding(finding('POSSIBLE_ALIAS','INFO','perfumes',key,{
    sale_id:null,title:'Possível alias de perfume',reason:'A diferença parece limitada a caixa, pontuação, acentuação ou identificação de frasco; nenhuma equivalência foi criada.',
    expected:{canonical:pair.canonical,perfume_id:pair.perfume_id},actual:{source_name:pair.raw,occurrences:pair.sale_ids.length},
    related_entities:{perfume_id:pair.perfume_id,sale_ids:pair.sale_ids.slice(0,50),total_sales:pair.sale_ids.length},
  }))

  const globalReferenceDate = items.map(item=>sourceDate(item.reference_date)).filter(Boolean).sort()[0] ?? null
  const unallocatedDemand = new Map()
  for (const sale of sales) {
    const client = clientMap.get(sale.client_id), perfume = perfumeMap.get(sale.perfume_id)
    if (!sale.client_id || !client || client.deleted_at != null) addFinding(finding('BROKEN_CLIENT_REFERENCE','CRITICAL','references',sale.id,{
      sale_id:sale.id,title:'Referência de cliente inválida',reason:'A venda não aponta para um cliente ativo deste tenant.',expected:{organization_id:organizationId,active_client:true},actual:{client_id:sale.client_id??null},related_entities:{client_id:sale.client_id??null},
    }))
    if (!sale.perfume_id || !perfume) addFinding(finding('BROKEN_PERFUME_REFERENCE','CRITICAL','references',sale.id,{
      sale_id:sale.id,title:'Referência de perfume inválida',reason:'A venda não aponta para um perfume deste tenant.',expected:{organization_id:organizationId,perfume_reference:true},actual:{perfume_id:sale.perfume_id??null},related_entities:{perfume_id:sale.perfume_id??null},
    }))
    const invalidCore = !sourceDate(sale.sale_date) || !['apc','split'].includes(normalize(sale.sale_type)) || numeric(sale.volume_ml) == null || Number(sale.volume_ml) <= 0 || numeric(sale.amount) == null || Number(sale.amount) < 0
    if (invalidCore) addFinding(finding('INCOMPATIBLE_COMMERCIAL_DATA','WARNING','commercial',sale.id,{
      sale_id:sale.id,title:'Dados comerciais incompatíveis',reason:'Data, tipo, ml ou valor não atendem ao contrato comercial atual.',expected:{sale_type:['APC','SPLIT'],volume_ml:'> 0',amount:'>= 0',sale_date:'valid'},actual:{sale_type:sale.sale_type,volume_ml:sale.volume_ml,amount:sale.amount,sale_date:sale.sale_date},related_entities:{client_id:sale.client_id,perfume_id:sale.perfume_id},
    }))
    const rawAmount = numeric(sale.raw_data?.VALOR ?? sale.raw_data?.[' VALOR'] ?? sale.original_amount)
    const amount = numeric(sale.amount)
    if (rawAmount != null && amount != null && Math.abs(rawAmount-amount) > 0.01) addFinding(finding('ORIGINAL_VALUE_MISMATCH','WARNING','commercial',sale.id,{
      sale_id:sale.id,title:'Valor original diverge do valor atual',reason:'O valor numérico preservado na origem difere significativamente de sales.amount.',expected:{source_amount:rawAmount},actual:{sale_amount:amount,difference:round(amount-rawAmount)},related_entities:{client_id:sale.client_id,perfume_id:sale.perfume_id},
    }))

    const active = activeBySale.get(sale.id) ?? []
    if (active.length > 1) addFinding(finding('MULTIPLE_ACTIVE_ALLOCATIONS','CRITICAL','inventory',sale.id,{
      sale_id:sale.id,title:'Venda com múltiplas alocações ativas',reason:'Uma venda operacional deve possuir no máximo uma alocação ativa.',expected:{active_allocations:1},actual:{active_allocations:active.length},related_entities:{allocation_ids:active.map(row=>row.id)},
    }))
    const legitimatelyShipped = Boolean(sale.shipped_at) || active.some(allocation=>allocation.status==='shipped'||['posted','delivered'].includes(activeShipmentByAllocation.get(allocation.id)?.status))
    if (sale.payment_status === 'paid' && sale.inventory_allocation_eligible && sale.deleted_at == null && !legitimatelyShipped && active.length === 0) {
      const itemCandidates = items.filter(item=>item.status==='active'&&item.perfume_id===sale.perfume_id)
      const saleDate=sourceDate(sale.sale_date)
      const operationallyCurrent = saleDate && globalReferenceDate && saleDate >= globalReferenceDate
      if (!operationallyCurrent) continue
      if (itemCandidates.length === 0) addFinding(finding('PAID_ELIGIBLE_SALE_WITHOUT_INVENTORY_ITEM','CRITICAL','inventory',sale.id,{
        sale_id:sale.id,title:'Venda paga e elegível sem item de estoque',reason:'A venda é posterior ao início do estoque operacional, exige alocação e não possui inventory_item ativo.',expected:{active_inventory_item:true,allocation:true},actual:{perfume_id:sale.perfume_id,allocation:false},related_entities:{perfume_id:sale.perfume_id},
      }))
      else if (itemCandidates.length === 1) {
        const item=itemCandidates[0]
        if (!item.reference_date || saleDate >= sourceDate(item.reference_date)) {
          add(unallocatedDemand,item.id,sale)
          addFinding(finding('PAID_SALE_WITHOUT_ALLOCATION','WARNING','inventory',sale.id,{
            sale_id:sale.id,title:'Venda paga sem alocação',reason:'A venda deveria consumir estoque operacional, mas não possui alocação ativa.',expected:{inventory_item_id:item.id,allocated_ml:numeric(sale.volume_ml)},actual:{allocation:false},related_entities:{perfume_id:sale.perfume_id,inventory_item_id:item.id},
          }))
        }
      } else addFinding(finding('MULTIPLE_ACTIVE_INVENTORY_ITEMS','CRITICAL','inventory',sale.id,{
        sale_id:sale.id,title:'Mais de um item ativo aplicável',reason:'Não é seguro escolher automaticamente qual item deve atender a venda.',expected:{active_items:1},actual:{active_items:itemCandidates.length},related_entities:{inventory_item_ids:itemCandidates.map(row=>row.id),perfume_id:sale.perfume_id},
      }))
    }
  }

  for (const allocation of activeAllocations) {
    const sale=saleMap.get(allocation.sale_id),item=itemMap.get(allocation.inventory_item_id),isLegacy=allocation.allocation_source==='legacy_manual_verified'
    if (!sale || !item || !perfumeMap.get(allocation.perfume_id)) addFinding(finding('BROKEN_ALLOCATION_REFERENCE','CRITICAL','references',allocation.id,{
      sale_id:allocation.sale_id??null,title:'Alocação com referência quebrada',reason:'Venda, item ou perfume relacionado à alocação não foi encontrado neste tenant.',expected:{sale:true,inventory_item:true,perfume:true},actual:{sale:Boolean(sale),inventory_item:Boolean(item),perfume:Boolean(perfumeMap.get(allocation.perfume_id))},related_entities:{allocation_id:allocation.id,sale_id:allocation.sale_id,inventory_item_id:allocation.inventory_item_id,perfume_id:allocation.perfume_id},
    }))
    if (!sale || !item) continue
    if (allocation.organization_id!==sale.organization_id||item.organization_id!==sale.organization_id) addFinding(finding('ALLOCATION_TENANT_MISMATCH','CRITICAL','inventory',allocation.id,{
      sale_id:sale.id,title:'Alocação ligada ao tenant incorreto',reason:'Venda, alocação e item não compartilham a mesma organização.',expected:{organization_id:sale.organization_id},actual:{allocation_organization_id:allocation.organization_id,item_organization_id:item.organization_id},related_entities:{allocation_id:allocation.id,inventory_item_id:item.id},
    }))
    if (allocation.perfume_id!==sale.perfume_id||item.perfume_id!==sale.perfume_id) addFinding(finding('ALLOCATION_PERFUME_MISMATCH','CRITICAL','inventory',allocation.id,{
      sale_id:sale.id,title:'Alocação vinculada ao perfume errado',reason:'O perfume da venda, da alocação e do item físico não coincide.',expected:{perfume_id:sale.perfume_id},actual:{allocation_perfume_id:allocation.perfume_id,item_perfume_id:item.perfume_id},related_entities:{allocation_id:allocation.id,inventory_item_id:item.id},
    }))
    const expectedQuantity=allocation.status==='reserved'?numeric(sale.volume_ml):numeric(allocation.original_quantity_ml??sale.volume_ml)
    if (expectedQuantity!=null&&numeric(allocation.quantity_ml)!==expectedQuantity&&!confirmedPreparation.has(allocation.id)&&!activeShipmentByAllocation.has(allocation.id)) addFinding(finding('ALLOCATION_QUANTITY_MISMATCH','WARNING','inventory',allocation.id,{
      sale_id:sale.id,title:'Quantidade alocada diferente da venda',reason:'Não há preparação ou envio ativo que explique a diferença.',expected:{quantity_ml:expectedQuantity},actual:{quantity_ml:numeric(allocation.quantity_ml)},related_entities:{allocation_id:allocation.id,inventory_item_id:item.id},
    }))
    if (!isLegacy && sale.payment_status==='pending') addFinding(finding('ACTIVE_ALLOCATION_ON_PENDING_SALE','WARNING','inventory',allocation.id,{
      sale_id:sale.id,title:'Alocação ativa em venda pendente',reason:'Alocação operacional ativa normalmente exige venda paga.',expected:{payment_status:'paid'},actual:{payment_status:sale.payment_status},related_entities:{allocation_id:allocation.id},
    }))
    if (!isLegacy && sale.inventory_allocation_eligible===false) addFinding(finding('ACTIVE_ALLOCATION_ON_INELIGIBLE_SALE','WARNING','inventory',allocation.id,{
      sale_id:sale.id,title:'Alocação ativa em venda inelegível',reason:'A venda está marcada para não participar do estoque operacional.',expected:{inventory_allocation_eligible:true},actual:{inventory_allocation_eligible:false},related_entities:{allocation_id:allocation.id},
    }))
    const progressed=allocation.status==='shipped'||['posted','delivered'].includes(activeShipmentByAllocation.get(allocation.id)?.status)
    if (!progressed&&(sale.deleted_at!=null||sale.payment_status==='cancelled')) addFinding(finding('ACTIVE_ALLOCATION_ON_CANCELLED_OR_DELETED_SALE','CRITICAL','inventory',allocation.id,{
      sale_id:sale.id,title:'Operação ativa em venda cancelada ou excluída',reason:'A alocação ainda está ativa sem evidência de envio concluído.',expected:{sale_active:true,payment_status:'paid'},actual:{deleted_at:sale.deleted_at,payment_status:sale.payment_status,allocation_status:allocation.status},related_entities:{allocation_id:allocation.id,shipment_id:allocation.shipment_id},
    }))
  }

  const inventoryByPerfume=[]
  for (const item of items.filter(row=>row.status==='active')) {
    const reserved=round((activeByItem.get(item.id)??[]).reduce((sum,row)=>sum+Number(row.quantity_ml??0),0))
    const demand=round((unallocatedDemand.get(item.id)??[]).reduce((sum,row)=>sum+Number(row.volume_ml??0),0))
    const available=numeric(item.available_ml)??0,projected=round(available-demand),deficit=round(Math.max(0,-projected))
    inventoryByPerfume.push({inventory_item_id:item.id,perfume_id:item.perfume_id,perfume:perfumeMap.get(item.perfume_id)?.full_name_raw??item.perfume_id,available_ml:available,reserved_ml:reserved,unallocated_demand_ml:demand,projected_balance_ml:projected,deficit_ml:deficit})
    if (deficit>0) addFinding(finding('AGGREGATED_INVENTORY_DEFICIT','CRITICAL','inventory',item.id,{
      sale_id:null,title:'Déficit agregado de estoque',reason:'A soma das vendas operacionais não alocadas excede o saldo disponível deste item.',expected:{minimum_projected_balance_ml:0},actual:{available_ml:available,reserved_ml:reserved,unallocated_demand_ml:demand,projected_balance_ml:projected,deficit_ml:deficit},related_entities:{inventory_item_id:item.id,perfume_id:item.perfume_id,sale_ids:(unallocatedDemand.get(item.id)??[]).map(row=>row.id)},
    }))
    if (numeric(item.available_ml)!=null&&Number(item.available_ml)<0) addFinding(finding('NEGATIVE_AVAILABLE_INVENTORY','CRITICAL','inventory',item.id,{
      sale_id:null,title:'Saldo disponível negativo',reason:'O próprio inventory_item demonstra available_ml abaixo de zero.',expected:{available_ml:'>= 0'},actual:{available_ml:numeric(item.available_ml)},related_entities:{inventory_item_id:item.id,perfume_id:item.perfume_id},
    }))
  }
  for (const shipmentItem of shipmentItems.filter(row=>row.removed_at==null)) if (!shipmentMap.get(shipmentItem.shipment_id)||!allocationMap.get(shipmentItem.allocation_id)||!saleMap.get(shipmentItem.sale_id)) addFinding(finding('BROKEN_SHIPMENT_REFERENCE','CRITICAL','references',shipmentItem.id,{
    sale_id:shipmentItem.sale_id??null,title:'Item de envio com referência quebrada',reason:'O item ativo de envio não aponta para envio, venda e alocação válidos.',expected:{shipment:true,sale:true,allocation:true},actual:{shipment:Boolean(shipmentMap.get(shipmentItem.shipment_id)),sale:Boolean(saleMap.get(shipmentItem.sale_id)),allocation:Boolean(allocationMap.get(shipmentItem.allocation_id))},related_entities:{shipment_item_id:shipmentItem.id,shipment_id:shipmentItem.shipment_id,allocation_id:shipmentItem.allocation_id},
  }))
  for (const prepItem of preparationItems) if (!allocationMap.get(prepItem.allocation_id)||!preparationBatchMap.get(prepItem.batch_id)) addFinding(finding('BROKEN_PREPARATION_REFERENCE','CRITICAL','references',prepItem.id,{
    sale_id:allocationMap.get(prepItem.allocation_id)?.sale_id??null,title:'Preparação com referência quebrada',reason:'O item de preparação não aponta para lote e alocação válidos deste tenant.',expected:{batch:true,allocation:true},actual:{batch:Boolean(preparationBatchMap.get(prepItem.batch_id)),allocation:Boolean(allocationMap.get(prepItem.allocation_id))},related_entities:{preparation_item_id:prepItem.id,batch_id:prepItem.batch_id,allocation_id:prepItem.allocation_id},
  }))

  if (snapshot.consistency?.changed_during_read) addFinding(finding('SNAPSHOT_CHANGED_DURING_READ','WARNING','references',snapshot.consistency.signature??'changed',{
    sale_id:null,title:'Base alterada durante a leitura',reason:'As marcas de atualização mudaram enquanto as páginas eram consultadas; execute novamente.',expected:{stable_snapshot:true},actual:snapshot.consistency,related_entities:{},
  }))
  const uniqueFindings=[...new Map(findings.map(entry=>[entry.id,entry])).values()]
  const severity={CRITICAL:0,WARNING:0,REVIEW:0,INFO:0},category={duplicates:0,perfumes:0,inventory:0,references:0,commercial:0}
  for(const entry of uniqueFindings){severity[entry.severity]+=1;category[entry.category]+=1}
  const countCode=(code)=>uniqueFindings.filter(entry=>entry.code===code).length
  return {
    zero_write:true,mode:'current_crm',organization_id:organizationId,created_at:new Date().toISOString(),
    analyzed:{sales:sales.length,clients:clients.length,perfumes:perfumes.length,inventory_items:items.length,inventory_allocations:allocations.length},
    severity,category,
    summary:{
      possible_duplicates:countCode('POSSIBLE_DUPLICATE'),possible_aliases:countCode('POSSIBLE_ALIAS'),perfume_conflicts:countCode('PERFUME_CONFLICT'),
      sales_without_item:countCode('PAID_ELIGIBLE_SALE_WITHOUT_INVENTORY_ITEM'),paid_without_allocation:countCode('PAID_SALE_WITHOUT_ALLOCATION'),
      incompatible_allocations:uniqueFindings.filter(entry=>['MULTIPLE_ACTIVE_ALLOCATIONS','ALLOCATION_TENANT_MISMATCH','ALLOCATION_PERFUME_MISMATCH','ALLOCATION_QUANTITY_MISMATCH','ACTIVE_ALLOCATION_ON_PENDING_SALE','ACTIVE_ALLOCATION_ON_INELIGIBLE_SALE','ACTIVE_ALLOCATION_ON_CANCELLED_OR_DELETED_SALE','MULTIPLE_ACTIVE_INVENTORY_ITEMS'].includes(entry.code)).length,
      perfumes_with_projected_deficit:countCode('AGGREGATED_INVENTORY_DEFICIT'),reference_inconsistencies:category.references,
      value_conflicts:countCode('ORIGINAL_VALUE_MISMATCH'),commercial_incompatibilities:countCode('INCOMPATIBLE_COMMERCIAL_DATA'),
    },
    consistency:snapshot.consistency??{changed_during_read:false},inventory_by_perfume:inventoryByPerfume,findings:uniqueFindings,
  }
}
