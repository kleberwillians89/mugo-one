export type ParsedBatchSale={client_name:string;sale_type:'APC'|'SPLIT';volume_ml:number;amount:number;raw:string;phone:string|null;address:string|null;perfume_name?:string;sale_date_raw?:string|null;shipping_deadline_raw?:string|null;sale_date?:string|null;shipping_deadline_date?:string|null;payment_status_raw?:string|null;payment_method_raw?:string|null;paid_at_raw?:string|null}
export type ParsedPerfumeIdentity={raw_perfume_name:string;normalized_perfume_name:string;display_name:string;brand:string|null;bottle_number:number|null}
export type ParsedBatchGroup=ParsedPerfumeIdentity&{perfume:string;sales:ParsedBatchSale[];totals:{sales:number;volume_ml:number;amount:number};availability_rows:number;availability_ml:number;availability_amount:number}
export type PricingValidationIssue={sale_type:'APC'|'SPLIT';volume_ml:number;announced_amount:number;expected_amount:number}
export type ShippingAvailabilityKind='available_now'|'available_from_date'|'expected_by_date'|'lead_time'|'unknown'
export type ShippingAvailability={shipping_availability_text:string|null;shipping_availability_kind:ShippingAvailabilityKind;shipping_available_date:string|null;shipping_lead_business_days:number|null;shipping_availability_review_required:boolean}
export type ParsedSalesBatch={source_format:'whatsapp'|'tsv';perfume:string;bottle_number:number|null;original_volume_ml:number|null;quote_per_ml:number|null;recrimping_fee:number|null;apc_volume_ml:number|null;apc_extra:number|null;pricing_consistent:boolean;pricing_issues:PricingValidationIssue[];deadline_raw:string|null;deadline_day_month:string|null;business_days:number|null;announced_balance_ml:number|null;remaining_available_ml:number|null;sales:ParsedBatchSale[];groups?:ParsedBatchGroup[];availability_rows?:number;availability_ml?:number;availability_amount?:number;totals:{sales:number;volume_ml:number;amount:number;calculated_balance_ml:number|null;total_operation_ml:number|null;volume_consistent:boolean};raw_text:string}

const number=(value:string)=>Number(value.replace(/\./g,'').replace(',','.'))
const money=(value:string)=>Math.round(number(value)*100)/100
const clean=(value:string)=>value
  .normalize('NFC').replace(/[\u00a0\u200b-\u200d\ufeff]/gu,' ')
  .replace(/^[\s>*_~`•▪◾◼◆◇▶►➤➜➡📦💳🚨🔗-]+/gu,'')
  .replace(/[\s*_~`•▪◾◼◆◇▶►➤➜➡📦💳🚨🔗]+$/gu,'').replace(/\s+/g,' ').trim()

export function normalizeSalesBatchText(value:string){return String(value??'').replace(/\r\n?/g,'\n').normalize('NFC').replace(/[\u00a0\u200b-\u200d\ufeff]/gu,' ')}
const isoDate=(year:number,month:number,day:number)=>{const date=new Date(Date.UTC(year,month-1,day));return date.getUTCFullYear()===year&&date.getUTCMonth()===month-1&&date.getUTCDate()===day?date.toISOString().slice(0,10):null}
const addBusinessDays=(iso:string,days:number)=>{const date=new Date(`${iso}T12:00:00Z`);let remaining=days;while(remaining>0){date.setUTCDate(date.getUTCDate()+1);if(date.getUTCDay()!==0&&date.getUTCDay()!==6)remaining--}return date.toISOString().slice(0,10)}
export function parseShippingAvailability(rawText:string,offerDate:string):ShippingAvailability{
  const raw=normalizeSalesBatchText(rawText),line=raw.match(/(?:disponibilidade\s+para\s+envio|envio|disponibilidade)\s*:\s*([^\n]+)/i)?.[1]?.trim()??null
  const source=line??raw.split('\n').map(value=>value.trim()).find(value=>/(pronta entrega|dispon[ií]vel imediatamente|envio a partir|previs[aã]o.*envio|dispon[ií]vel em\s+\d+\s*dias)/i.test(value))??null
  if(!source)return{shipping_availability_text:null,shipping_availability_kind:'unknown',shipping_available_date:null,shipping_lead_business_days:null,shipping_availability_review_required:true}
  const normalized=normalizeBatchName(source),lead=source.match(/(\d+)\s*dias?\s+[uú]teis/i),dateMatch=source.match(/\b(\d{1,2})\/(\d{1,2})(?:\/(\d{4}))?\b/)
  let kind:ShippingAvailabilityKind='unknown'
  if(/pronta entrega|disponivel imediatamente|envio imediato/.test(normalized))kind='available_now'
  else if(/a partir de/.test(normalized))kind='available_from_date'
  else if(/ate\s+\d|previsao|previsto|estimad/.test(normalized))kind='expected_by_date'
  else if(lead)kind='lead_time'
  let availableDate:string|null=null,review=kind==='unknown'
  if(dateMatch){const base=new Date(`${offerDate}T12:00:00Z`),year=dateMatch[3]?Number(dateMatch[3]):base.getUTCFullYear();availableDate=isoDate(year,Number(dateMatch[2]),Number(dateMatch[1]));if(!availableDate||availableDate<offerDate){availableDate=null;review=true}}
  else if(kind==='lead_time'&&lead)availableDate=addBusinessDays(offerDate,Number(lead[1]))
  if((kind==='available_from_date'||kind==='expected_by_date')&&!availableDate)review=true
  return{shipping_availability_text:source,shipping_availability_kind:kind,shipping_available_date:availableDate,shipping_lead_business_days:lead?Number(lead[1]):null,shipping_availability_review_required:review}
}
export function parseRemainingAvailableLine(value:string):number|null{
  const line=clean(value).replace(/[.!]+$/,'').trim()
  const amount='(\\d+(?:[.,]\\d+)?)'
  const patterns=[
    new RegExp(`^${amount}\\s*mls?\\s*(?::|[-–—])\\s*dispon[ií]vel(?:\\s+para\\s+venda)?$`,'i'),
    new RegExp(`^${amount}\\s*mls?\\s+dispon[ií]vel(?:\\s+para\\s+venda)?$`,'i'),
    new RegExp(`^dispon[ií]vel\\s+para\\s+venda\\s*:\\s*${amount}\\s*mls?$`,'i'),
    new RegExp(`^restam\\s+${amount}\\s*mls?$`,'i'),
    new RegExp(`^saldo\\s*:\\s*${amount}\\s*mls?$`,'i'),
  ]
  for(const pattern of patterns){const match=line.match(pattern);if(match)return number(match[1])}
  return null
}
export function countSaleCandidateLines(value:string){return normalizeSalesBatchText(value).split('\n').map(clean).filter(line=>parseRemainingAvailableLine(line)===null&&/^(?:APC|\d{1,2}\s*mls?)\s*[:\-–—]/i.test(line)&&!/^\s*(?:APC|\d{1,2}\s*mls?)\s*[:\-–—]\s*R\$/i.test(line)).length}
const mdy=(value:string)=>{const match=value.trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);if(!match)return null;const month=Number(match[1]),day=Number(match[2]),year=Number(match[3]),date=new Date(Date.UTC(year,month-1,day));return date.getUTCFullYear()===year&&date.getUTCMonth()===month-1&&date.getUTCDate()===day?`${year}-${String(month).padStart(2,'0')}-${String(day).padStart(2,'0')}`:null}
export function isTabularSalesBatch(value:string){return normalizeSalesBatchText(value).split('\n').some(line=>(line.match(/\t/g)||[]).length>=4)}
export function parseTabularSalesBatch(rawText:string):ParsedSalesBatch{
  const raw=normalizeSalesBatchText(rawText).trim(),sales:ParsedBatchSale[]=[],availability=new Map<string,{rows:number;volume_ml:number;amount:number}>()
  for(const rawLine of raw.split('\n')){const columns=rawLine.split('\t').map(value=>value.trim()),client=columns[0]||'',type=String(columns[4]||'').toUpperCase(),volume=number(String(columns[5]||'0')),perfume=columns[6]||'',amountMatch=String(columns[7]||'').match(/R?\$?\s*([\d.]+(?:,\d{1,2})?)/);if(!client||!['APC','SPLIT'].includes(type)||!volume||!perfume||!amountMatch)continue;const key=normalizeBatchName(perfume);if(normalizeBatchName(client)==='disponivel para venda'){const bucket=availability.get(key)??{rows:0,volume_ml:0,amount:0};bucket.rows+=1;bucket.volume_ml+=volume;bucket.amount=Math.round((bucket.amount+money(amountMatch[1]))*100)/100;availability.set(key,bucket);continue}sales.push({client_name:client,sale_type:type as 'APC'|'SPLIT',volume_ml:volume,amount:money(amountMatch[1]),raw:rawLine,phone:null,address:null,perfume_name:perfume,sale_date_raw:columns[1]||null,shipping_deadline_raw:columns[2]||null,sale_date:mdy(columns[1]||''),shipping_deadline_date:mdy(columns[2]||''),payment_status_raw:columns[8]||null,payment_method_raw:columns[9]||null,paid_at_raw:columns[10]||null})}
  const grouped=new Map<string,ParsedBatchGroup>();for(const sale of sales){const identity=perfumeIdentity(sale.perfume_name),key=`${identity.normalized_perfume_name}::${identity.bottle_number??''}`,avail=availability.get(normalizeBatchName(sale.perfume_name))??{rows:0,volume_ml:0,amount:0},current=grouped.get(key)??{perfume:identity.display_name,...identity,sales:[],totals:{sales:0,volume_ml:0,amount:0},availability_rows:avail.rows,availability_ml:avail.volume_ml,availability_amount:avail.amount};current.sales.push(sale);current.totals={sales:current.sales.length,volume_ml:current.sales.reduce((sum,row)=>sum+row.volume_ml,0),amount:Math.round(current.sales.reduce((sum,row)=>sum+row.amount,0)*100)/100};grouped.set(key,current)}
  const groups=[...grouped.values()].sort((a,b)=>a.perfume.localeCompare(b.perfume,'pt-BR',{sensitivity:'base'})),totalMl=sales.reduce((sum,row)=>sum+row.volume_ml,0),totalAmount=Math.round(sales.reduce((sum,row)=>sum+row.amount,0)*100)/100
  const availabilityTotals=[...availability.values()].reduce((acc,row)=>({rows:acc.rows+row.rows,volume_ml:acc.volume_ml+row.volume_ml,amount:Math.round((acc.amount+row.amount)*100)/100}),{rows:0,volume_ml:0,amount:0})
  return{source_format:'tsv',perfume:groups[0]?.perfume??'',bottle_number:null,original_volume_ml:null,quote_per_ml:null,recrimping_fee:null,apc_volume_ml:null,apc_extra:null,pricing_consistent:true,pricing_issues:[],deadline_raw:null,deadline_day_month:null,business_days:null,announced_balance_ml:null,remaining_available_ml:availabilityTotals.rows?availabilityTotals.volume_ml:null,sales,groups,availability_rows:availabilityTotals.rows,availability_ml:availabilityTotals.volume_ml,availability_amount:availabilityTotals.amount,totals:{sales:sales.length,volume_ml:totalMl,amount:totalAmount,calculated_balance_ml:null,total_operation_ml:availabilityTotals.rows?totalMl+availabilityTotals.volume_ml:null,volume_consistent:true},raw_text:raw}
}

export function normalizeBatchName(value:unknown){return String(value??'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim()}
export function perfumeIdentity(value:unknown):ParsedPerfumeIdentity{const raw=String(value??'').normalize('NFC').replace(/\s+/g,' ').trim(),bottle=raw.match(/\(\s*frasco\s+(\d+)\s*\)\s*$/i),withoutBottle=raw.replace(/\s*\(\s*frasco\s+\d+\s*\)\s*$/i,'').trim(),parts=withoutBottle.split(/\s+[—–-]\s+/).map(part=>part.trim()).filter(Boolean);return{raw_perfume_name:raw,normalized_perfume_name:normalizeBatchName(withoutBottle),display_name:withoutBottle,brand:parts.length>1?parts.at(-1)!:null,bottle_number:bottle?Number(bottle[1]):null}}
export function normalizePerfumeName(value:unknown){return perfumeIdentity(value).normalized_perfume_name}
export function missingShippingFields(client:Record<string,unknown>){return [['CPF',client.cpf||client.cnpj],['telefone',client.phone||client.whatsapp_phone],['CEP',client.postal_code],['endereço',client.address_line],['número',client.address_number],['bairro',client.district],['cidade',client.city],['UF',client.state]].filter(([,value])=>!String(value??'').trim()).map(([label])=>String(label))}
export function classifyClientMatches(name:string,clients:Record<string,unknown>[]){const normalized=normalizeBatchName(name),exact=clients.filter(c=>normalizeBatchName(c.normalized_name||c.name)===normalized),suggestions=exact.length?exact:clients.filter(c=>{const candidate=normalizeBatchName(c.name);return candidate.includes(normalized)||normalized.includes(candidate)}).slice(0,5);return{status:exact.length===1?'found' as const:exact.length>1||suggestions.length?'review' as const:'new' as const,match:exact.length===1?exact[0]:null,suggestions}}

export function parseDaviSalesBatch(rawText:string):ParsedSalesBatch{
  if(isTabularSalesBatch(rawText))return parseTabularSalesBatch(rawText)
  const raw=normalizeSalesBatchText(rawText).trim();if(!raw)throw new Error('empty_batch')
  const lines=raw.split(/\r?\n/).map(clean).filter(Boolean),firstLine=lines[0]||'',title=/^(?:APC|\d{1,2}\s*mls?)\s*[:\-–—]/i.test(firstLine)?'':firstLine
  const bottleNumbers=[...raw.matchAll(/(?:^|[\n(])\s*Frasco\s+(\d+)\s*(?:[.)]|$)/gim)].map(match=>Number(match[1])),distinctBottleNumbers=[...new Set(bottleNumbers)]
  if(distinctBottleNumbers.length>1)throw new Error('multiple_bottle_numbers')
  const bottleNumber=distinctBottleNumbers[0]??null,original=raw.match(/Frasco original\s+(?:com|de)\s*(\d+(?:[.,]\d+)?)\s*ml/i)
  const quote=raw.match(/Cotaç[aã]o:\s*R\$\s*([\d.,]+)\s*\/\s*ml/i),recrimp=raw.match(/R\$\s*([\d.,]+)\s*recravaç[aã]o/i)
  const apcRule=raw.match(/APC:\s*(\d+(?:[.,]\d+)?)\s*ml\s*\+\s*R\$\s*([\d.,]+)/i)
  const deadline=raw.match(/(?:Disponibilidade|Liberaç[aã]o)[^:]*:\s*([^\n]+)/i),dayMonth=deadline?.[1]?.match(/(\d{1,2}\/\d{1,2})/)?.[1]??null,deadlineBusinessDays=deadline?.[1]?.match(/(\d+)\s*dias?\s+[uú]teis/i)
  const balance=raw.match(/(\d+(?:[.,]\d+)?)\s*mls?\s+dispon[ií]ve/i)
  const prices=new Map<string,number>();for(const line of lines){const match=line.match(/^(\d{1,2})\s*mls?\s*[:\-–—]\s*R\$\s*([\d.,]+)\s*$/i);if(match)prices.set(String(Number(match[1])),money(match[2]))}
  const apcPriceLine=lines.map(line=>line.match(/^APC\s*[:\-–—]\s*R\$\s*([\d.,]+)\s*$/i)).find(Boolean),apcPrice=apcPriceLine||null
  const quoteValue=quote?money(quote[1]):null,recrimpingValue=recrimp?money(recrimp[1]):0,apcExtraValue=apcRule?money(apcRule[2]):0,pricingIssues:PricingValidationIssue[]=[]
  if(quoteValue!==null){for(const [volumeKey,announcedAmount] of prices){const volume=Number(volumeKey),expectedAmount=Math.round((volume*quoteValue+recrimpingValue)*100)/100;if(Math.abs(announcedAmount-expectedAmount)>=.01)pricingIssues.push({sale_type:'SPLIT',volume_ml:volume,announced_amount:announcedAmount,expected_amount:expectedAmount})}if(apcPrice&&apcRule){const volume=number(apcRule[1]),announcedAmount=money(apcPrice[1]),expectedAmount=Math.round((volume*quoteValue+apcExtraValue)*100)/100;if(Math.abs(announcedAmount-expectedAmount)>=.01)pricingIssues.push({sale_type:'APC',volume_ml:volume,announced_amount:announcedAmount,expected_amount:expectedAmount})}}
  const remainingValues=lines.map(parseRemainingAvailableLine).filter((value):value is number=>value!==null)
  if(remainingValues.length>1)throw new Error('multiple_remaining_balances')
  const remainingAvailable=remainingValues[0]??null
  const unpricedBuyerVolumes=lines.flatMap(line=>{const match=line.match(/^(\d{1,2})\s*mls?\s*[:\-–—]\s*(?!R\$)(.+)$/i);return match&&parseRemainingAvailableLine(line)===null?[number(match[1])]:[]}).filter(volume=>!prices.has(String(volume)))
  const inferredApcVolume=!apcRule&&apcPrice&&unpricedBuyerVolumes.length===1?unpricedBuyerVolumes[0]:null
  const sales:ParsedBatchSale[]=[]
  for(const line of lines){if(parseRemainingAvailableLine(line)!==null)continue;const match=line.match(/^(APC|\d{1,2}\s*mls?)\s*[:\-–—]\s*(.+)$/i);if(!match||/^R\$/i.test(match[2])||/\d+\s*mls?\s*\+\s*R\$/i.test(match[2]))continue;const numericVolume=match[1].toUpperCase()==='APC'?null:number(match[1].replace(/mls?/i,'')),isConfiguredApc=Boolean(numericVolume&&((apcRule&&Math.abs(numericVolume-number(apcRule[1]))<.001)||(inferredApcVolume&&Math.abs(numericVolume-inferredApcVolume)<.001))),type=match[1].toUpperCase()==='APC'||isConfiguredApc?'APC':'SPLIT',volume=type==='APC'?number(apcRule?.[1]||String(numericVolume??0)):numericVolume??0;const client=clean(match[2]);if(!client||!volume)continue;const amount=type==='APC'?(apcPrice?money(apcPrice[1]):Math.round((volume*(quoteValue??0)+apcExtraValue)*100)/100):(prices.get(String(volume))??Math.round((volume*(quoteValue??0)+recrimpingValue)*100)/100);sales.push({client_name:client,sale_type:type,volume_ml:volume,amount,raw:line,phone:null,address:null})}
  const totalMl=sales.reduce((sum,s)=>sum+s.volume_ml,0),totalAmount=Math.round(sales.reduce((sum,s)=>sum+s.amount,0)*100)/100,originalMl=original?number(original[1]):null,announced=balance?number(balance[1]):null,calculated=remainingAvailable??(originalMl==null?null:originalMl-totalMl),totalOperation=remainingAvailable==null?originalMl:totalMl+remainingAvailable,volumeConsistent=remainingAvailable!==null&&originalMl!==null?Math.abs(totalOperation!-originalMl)<.001:calculated!==null&&announced!==null?Math.abs(calculated-announced)<.001:true
  return {source_format:'whatsapp',perfume:title.replace(/\s*[—-]?\s*\(.*$/,'').trim(),bottle_number:bottleNumber,original_volume_ml:originalMl,quote_per_ml:quoteValue,recrimping_fee:recrimp?money(recrimp[1]):null,apc_volume_ml:apcRule?number(apcRule[1]):null,apc_extra:apcRule?money(apcRule[2]):null,pricing_consistent:pricingIssues.length===0,pricing_issues:pricingIssues,deadline_raw:deadline?.[1]?.trim()??null,deadline_day_month:dayMonth,business_days:deadlineBusinessDays?Number(deadlineBusinessDays[1]):null,announced_balance_ml:remainingAvailable??announced,remaining_available_ml:remainingAvailable,sales,totals:{sales:sales.length,volume_ml:totalMl,amount:totalAmount,calculated_balance_ml:calculated,total_operation_ml:totalOperation,volume_consistent:volumeConsistent},raw_text:raw}
}
