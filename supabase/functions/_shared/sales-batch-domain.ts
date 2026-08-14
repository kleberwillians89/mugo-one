export type ParsedBatchSale={client_name:string;sale_type:'APC'|'SPLIT';volume_ml:number;amount:number;raw:string;phone:string|null;address:string|null}
export type ParsedSalesBatch={perfume:string;bottle_number:number|null;original_volume_ml:number|null;quote_per_ml:number|null;recrimping_fee:number|null;apc_volume_ml:number|null;apc_extra:number|null;deadline_raw:string|null;deadline_day_month:string|null;business_days:number|null;announced_balance_ml:number|null;sales:ParsedBatchSale[];totals:{sales:number;volume_ml:number;amount:number;calculated_balance_ml:number|null;volume_consistent:boolean};raw_text:string}

const number=(value:string)=>Number(value.replace(/\./g,'').replace(',','.'))
const money=(value:string)=>Math.round(number(value)*100)/100
const clean=(value:string)=>value
  .normalize('NFC').replace(/[\u00a0\u200b-\u200d\ufeff]/gu,' ')
  .replace(/^[\s>*_~`•▪◾◼◆◇▶►➤➜➡📦💳🚨🔗-]+/gu,'')
  .replace(/[\s*_~`•▪◾◼◆◇▶►➤➜➡📦💳🚨🔗]+$/gu,'').replace(/\s+/g,' ').trim()

export function normalizeSalesBatchText(value:string){return String(value??'').replace(/\r\n?/g,'\n').normalize('NFC').replace(/[\u00a0\u200b-\u200d\ufeff]/gu,' ')}
export function countSaleCandidateLines(value:string){return normalizeSalesBatchText(value).split('\n').map(clean).filter(line=>/^(?:APC|\d{1,2}\s*mls?)\s*[:\-–—]/i.test(line)&&!/^\s*(?:APC|\d{1,2}\s*mls?)\s*[:\-–—]\s*R\$/i.test(line)).length}

export function normalizeBatchName(value:unknown){return String(value??'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim()}
export function missingShippingFields(client:Record<string,unknown>){return [['CPF',client.cpf||client.cnpj],['telefone',client.phone||client.whatsapp_phone],['CEP',client.postal_code],['endereço',client.address_line],['número',client.address_number],['bairro',client.district],['cidade',client.city],['UF',client.state]].filter(([,value])=>!String(value??'').trim()).map(([label])=>String(label))}
export function classifyClientMatches(name:string,clients:Record<string,unknown>[]){const normalized=normalizeBatchName(name),exact=clients.filter(c=>normalizeBatchName(c.normalized_name||c.name)===normalized),suggestions=exact.length?exact:clients.filter(c=>{const candidate=normalizeBatchName(c.name);return candidate.includes(normalized)||normalized.includes(candidate)}).slice(0,5);return{status:exact.length===1?'found' as const:exact.length>1||suggestions.length?'review' as const:'new' as const,match:exact.length===1?exact[0]:null,suggestions}}

export function parseDaviSalesBatch(rawText:string):ParsedSalesBatch{
  const raw=normalizeSalesBatchText(rawText).trim();if(!raw)throw new Error('empty_batch')
  const lines=raw.split(/\r?\n/).map(clean).filter(Boolean),title=lines[0]||''
  const bottle=raw.match(/\(\s*Frasco\s+(\d+)\s*\)/i),original=raw.match(/Frasco original com\s*(\d+(?:[.,]\d+)?)\s*ml/i)
  const quote=raw.match(/Cotaç[aã]o:\s*R\$\s*([\d.,]+)\s*\/\s*ml/i),recrimp=raw.match(/R\$\s*([\d.,]+)\s*recravaç[aã]o/i)
  const apcRule=raw.match(/APC:\s*(\d+(?:[.,]\d+)?)\s*ml\s*\+\s*R\$\s*([\d.,]+)/i)
  const deadline=raw.match(/Disponibilidade[^:]*:\s*([^\n]+?)(?:\s*\((\d+)\s*dias úteis\))?(?:\n|$)/i),dayMonth=deadline?.[1]?.match(/(\d{1,2}\/\d{1,2})/)?.[1]??null
  const balance=raw.match(/(\d+(?:[.,]\d+)?)\s*mls?\s+dispon[ií]ve/i)
  const prices=new Map<string,number>();for(const line of lines){const match=line.match(/^(\d{1,2})\s*mls?\s*[:\-–—]\s*R\$\s*([\d.,]+)\s*$/i);if(match)prices.set(String(Number(match[1])),money(match[2]))}
  const apcPriceLine=lines.map(line=>line.match(/^APC\s*[:\-–—]\s*R\$\s*([\d.,]+)\s*$/i)).find(Boolean),apcPrice=apcPriceLine||null
  const sales:ParsedBatchSale[]=[]
  for(const line of lines){const match=line.match(/^(APC|\d{1,2}\s*mls?)\s*[:\-–—]\s*(.+)$/i);if(!match||/^R\$/i.test(match[2])||/\d+\s*mls?\s*\+\s*R\$/i.test(match[2]))continue;const type=match[1].toUpperCase()==='APC'?'APC':'SPLIT',volume=type==='APC'?number(apcRule?.[1]||'0'):number(match[1].replace(/mls?/i,''));const client=clean(match[2]);if(!client||!volume)continue;const amount=type==='APC'?(apcPrice?money(apcPrice[1]):Math.round((volume*number(quote?.[1]||'0')+number(apcRule?.[2]||'0'))*100)/100):(prices.get(String(volume))??Math.round(volume*number(quote?.[1]||'0')*100)/100);sales.push({client_name:client,sale_type:type,volume_ml:volume,amount,raw:line,phone:null,address:null})}
  const totalMl=sales.reduce((sum,s)=>sum+s.volume_ml,0),totalAmount=Math.round(sales.reduce((sum,s)=>sum+s.amount,0)*100)/100,originalMl=original?number(original[1]):null,announced=balance?number(balance[1]):null,calculated=originalMl==null?null:originalMl-totalMl
  return {perfume:title.replace(/\s*[—-]?\s*\(.*$/,'').trim(),bottle_number:bottle?Number(bottle[1]):null,original_volume_ml:originalMl,quote_per_ml:quote?money(quote[1]):null,recrimping_fee:recrimp?money(recrimp[1]):null,apc_volume_ml:apcRule?number(apcRule[1]):null,apc_extra:apcRule?money(apcRule[2]):null,deadline_raw:deadline?.[1]?.trim()??null,deadline_day_month:dayMonth,business_days:deadline?.[2]?Number(deadline[2]):null,announced_balance_ml:announced,sales,totals:{sales:sales.length,volume_ml:totalMl,amount:totalAmount,calculated_balance_ml:calculated,volume_consistent:calculated!==null&&announced!==null?Math.abs(calculated-announced)<.001:true},raw_text:raw}
}
