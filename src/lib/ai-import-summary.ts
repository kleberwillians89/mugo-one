import {brl,countedLabel,integer} from './format'

export type AiImportSummary={
  sales_created:number;clients_created:number;clients_existing:number
  perfumes_processed:number;perfumes_matched:number;inventory_items_bootstrapped:number
  total_ml_sold:number;total_amount_sold:number;commercial_remaining_ml:number;commercial_remaining_amount:number
  shipping_incomplete:number;paid_source_count:number;awaiting_source_count:number;unstated_payment_count:number;idempotent:boolean
}

// Deterministic, human-only Portuguese sentences built straight from the
// backend aggregates — never a raw field name, never a UUID, never a
// recalculated number. This is both (a) what a human operator reads when
// the AI paraphrase is unavailable, and (b) the ONLY input sent to the AI
// paraphraser, so the model has nothing code-shaped to echo back.
export function buildAiImportSummarySentences(summary:AiImportSummary):string[]{
  const sentences:string[]=[]
  sentences.push(`${countedLabel(summary.sales_created,'venda foi registrada','vendas foram registradas')}, totalizando ${brl(summary.total_amount_sold)} e ${countedLabel(summary.total_ml_sold,'ml vendido','ml vendidos')}.`)

  if(summary.commercial_remaining_ml>0)
    sentences.push(`A lista também continha ${countedLabel(summary.commercial_remaining_ml,'ml','ml')} ainda disponíveis para venda (${brl(summary.commercial_remaining_amount)}), que não entraram como venda.`)

  if(summary.clients_created>0&&summary.clients_existing>0)
    sentences.push(`${countedLabel(summary.clients_created,'novo cliente foi criado','novos clientes foram criados')} e ${countedLabel(summary.clients_existing,'cliente já existia','clientes já existiam')} no CRM.`)
  else if(summary.clients_created>0)
    sentences.push(`${countedLabel(summary.clients_created,'novo cliente foi criado','novos clientes foram criados')} no CRM.`)
  else if(summary.clients_existing>0)
    sentences.push(summary.clients_existing===1?'O cliente já existia no CRM.':`Os ${integer(summary.clients_existing)} clientes já existiam no CRM.`)

  if(summary.shipping_incomplete>0)
    sentences.push(summary.shipping_incomplete===1
      ?'O cadastro do cliente ainda está incompleto para envio.'
      :`${countedLabel(summary.shipping_incomplete,'cadastro','cadastros')} de clientes ainda estão incompletos para envio.`)

  if(summary.perfumes_processed===1&&summary.perfumes_matched===1)
    sentences.push('O perfume já estava cadastrado no estoque e foi vinculado à venda.')
  else if(summary.perfumes_processed>1&&summary.perfumes_matched>0)
    sentences.push(`${countedLabel(summary.perfumes_matched,'perfume já estava','perfumes já estavam')} cadastrado(s) no estoque e foi(ram) vinculado(s) às vendas.`)
  if(summary.inventory_items_bootstrapped>0)
    sentences.push(`${countedLabel(summary.inventory_items_bootstrapped,'perfume foi registrado','perfumes foram registrados')} a partir das vendas e aguarda(m) conferência física antes de liberar estoque operacional.`)

  const paymentParts=[
    summary.paid_source_count>0?`${countedLabel(summary.paid_source_count,'paga','pagas')}`:null,
    summary.awaiting_source_count>0?`${countedLabel(summary.awaiting_source_count,'aguardando','aguardando')}`:null,
    summary.unstated_payment_count>0?`${countedLabel(summary.unstated_payment_count,'sem status informado','sem status informado')}`:null,
  ].filter((part):part is string=>Boolean(part))
  if(paymentParts.length)
    sentences.push(`Na lista original: ${paymentParts.join(' · ')}. As vendas importadas entraram como pendentes conforme a regra atual do CRM.`)

  return sentences
}
