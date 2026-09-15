export type MessageType='collection'|'access'
export type Fetcher=(input:string|URL,init?:RequestInit)=>Promise<Response>
export type ManychatCollectionFields={nome_cliente:string;numero_pedido:string;valor_pedido:number;imagem_cobranca_url?:string}

export class ManychatApiError extends Error{
  constructor(public code:string,public httpStatus=502,public providerStatus?:number,public providerReason?:string){super(code)}
}

export function normalizeBrazilianPhone(value:unknown){
  let digits=String(value??'').replace(/\D/g,'')
  if(digits.length===10||digits.length===11)digits=`55${digits}`
  if(!/^55[1-9][0-9]{9,10}$/.test(digits))return null
  return`+${digits}`
}

export function splitContactName(value:string){
  const parts=value.trim().split(/\s+/).filter(Boolean)
  return{first_name:parts[0]||'Cliente',last_name:parts.slice(1).join(' ')}
}

export function constantTimeEqual(left:string,right:string){
  const length=Math.max(left.length,right.length);let difference=left.length^right.length
  for(let index=0;index<length;index++)difference|=(left.charCodeAt(index)||0)^(right.charCodeAt(index)||0)
  return difference===0
}

export function formatBrl(value:number){return new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'}).format(value).replace(/\u00a0/g,' ')}
export function firstName(value:string){return value.trim().split(/\s+/)[0]||'Cliente'}

const parse=async(response:Response)=>{try{return await response.json() as Record<string,unknown>}catch{return{}}}
const providerMessage=(body:Record<string,unknown>)=>JSON.stringify(body).slice(0,500)
const safeProviderReason=(body:Record<string,unknown>)=>{
  const nested=body.error as Record<string,unknown>|undefined
  const value=body.message??body.error_message??nested?.message??nested?.description
  if(typeof value!=='string'||!value.trim())return undefined
  return value.trim().slice(0,240).replace(/[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/g,'[email]').replace(/\+?\d[\d\s().-]{7,}\d/g,'[telefone]')
}
const isNotFound=(status:number,body:Record<string,unknown>)=>status===404||(status===400&&/(not found|does not exist|subscriber.+exist)/i.test(providerMessage(body)))
const subscriberData=(body:Record<string,unknown>)=>{
  const data=body.data
  if(Array.isArray(data))return data[0] as Record<string,unknown>|undefined
  return data as Record<string,unknown>|undefined
}
const subscriberId=(body:Record<string,unknown>)=>{
  const data=subscriberData(body),id=String(data?.id??'')
  if(!/^\d+$/.test(id))throw new ManychatApiError('manychat_invalid_subscriber')
  return id
}
const hasNoSubscriber=(body:Record<string,unknown>)=>Array.isArray(body.data)&&body.data.length===0
const subscriberRows=(body:Record<string,unknown>)=>Array.isArray(body.data)?body.data.filter((row):row is Record<string,unknown>=>Boolean(row)&&typeof row==='object'):[]

async function call(fetcher:Fetcher,url:string,apiKey:string,init:RequestInit={}){
  let response:Response
  try{response=await fetcher(url,{...init,signal:init.signal??AbortSignal.timeout(10000),headers:{authorization:`Bearer ${apiKey}`,'content-type':'application/json'}})}
  catch{throw new ManychatApiError('manychat_unavailable',503)}
  const body=await parse(response)
  if(response.status===401||response.status===403)throw new ManychatApiError('manychat_token_invalid')
  return{response,body}
}

const normalizedFieldName=(value:unknown)=>String(value??'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,'_').replace(/^_|_$/g,'')
const fieldAliases={nome_cliente:['nome_cliente'],numero_pedido:['numero_pedido'],valor_pedido:['valor_pedido','ruah_valor_pendente'],imagem_cobranca_url:['imagem_cobranca_url']} as const

export async function updateManychatCustomFields(input:{apiKey:string;subscriberId:string;values:ManychatCollectionFields;fetcher?:Fetcher}){
  const fetcher=input.fetcher??fetch
  const listed=await call(fetcher,'https://api.manychat.com/fb/page/getCustomFields',input.apiKey)
  if(!listed.response.ok)throw new ManychatApiError('manychat_custom_fields_lookup_failed',502,listed.response.status,safeProviderReason(listed.body))
  const rows=Array.isArray(listed.body.data)?listed.body.data.filter((row):row is Record<string,unknown>=>Boolean(row)&&typeof row==='object'):[]
  const byName=new Map(rows.map(row=>[normalizedFieldName(row.name),row]))
  const resolved=(Object.keys(fieldAliases) as Array<keyof typeof fieldAliases>).map(key=>({key,row:fieldAliases[key].map(alias=>byName.get(alias)).find(Boolean)}))
  const missing=resolved.filter(item=>!item.row&&item.key!=='imagem_cobranca_url').map(item=>item.key)
  if(missing.length)throw new ManychatApiError('manychat_custom_fields_missing',422,undefined,missing.join(', '))
  const valueField=resolved.find(item=>item.key==='valor_pedido')?.row
  if(String(valueField?.type??'').toLowerCase()!=='number')throw new ManychatApiError('manychat_value_field_type',422,undefined,'valor_pedido precisa ser Number')
  if(!Number.isFinite(input.values.valor_pedido))throw new ManychatApiError('manychat_invalid_order_value',422)
  const fields=resolved.flatMap(({key,row})=>{
    if(!row)return[]
    const value=input.values[key]
    if(value===undefined||value==='')return[]
    const id=Number(row.id)
    if(!Number.isSafeInteger(id)||id<=0)throw new ManychatApiError('manychat_custom_fields_invalid',502)
    return[{field_id:id,field_value:value}]
  })
  const updated=await call(fetcher,'https://api.manychat.com/fb/subscriber/setCustomFields',input.apiKey,{method:'POST',body:`{"subscriber_id":${input.subscriberId},"fields":${JSON.stringify(fields)}}`})
  if(!updated.response.ok)throw new ManychatApiError('manychat_custom_fields_update_failed',502,updated.response.status,safeProviderReason(updated.body))
  return fields.length
}

export async function sendManychatFlow(input:{apiKey:string;flowNs:string;phone:string;name:string;customFields?:ManychatCollectionFields;fetcher?:Fetcher}){
  const fetcher=input.fetcher??fetch,phone=normalizeBrazilianPhone(input.phone)
  if(!phone)throw new ManychatApiError('invalid_phone',422)
  let lookup=await call(fetcher,`https://api.manychat.com/fb/subscriber/findBySystemField?phone=${encodeURIComponent(phone)}`,input.apiKey)
  let id:string
  if(lookup.response.ok&&!hasNoSubscriber(lookup.body))id=subscriberId(lookup.body)
  else if(lookup.response.ok||isNotFound(lookup.response.status,lookup.body)){
    const byName=await call(fetcher,`https://api.manychat.com/fb/subscriber/findByName?name=${encodeURIComponent(input.name.trim())}`,input.apiKey)
    const exact=subscriberRows(byName.body).filter(row=>normalizeBrazilianPhone(row.whatsapp_phone??row.phone)===phone)
    if(byName.response.ok&&exact.length===1)id=subscriberId({data:exact[0]})
    else{
      const name=splitContactName(input.name)
      const created=await call(fetcher,'https://api.manychat.com/fb/subscriber/createSubscriber',input.apiKey,{method:'POST',body:JSON.stringify({...name,whatsapp_phone:phone})})
      if(!created.response.ok)throw new ManychatApiError('manychat_create_contact_failed',502,created.response.status,safeProviderReason(created.body))
      id=subscriberId(created.body)
    }
  }else throw new ManychatApiError('manychat_lookup_failed')
  console.info('[manychat] contact_resolved',{source:lookup.response.ok&&!hasNoSubscriber(lookup.body)?'phone':'whatsapp'})
  if(input.customFields){
    await updateManychatCustomFields({apiKey:input.apiKey,subscriberId:id,values:input.customFields,fetcher})
    console.info('[manychat] custom_fields_updated',{field_count:input.customFields.imagem_cobranca_url?4:3})
  }
  const sent=await call(fetcher,'https://api.manychat.com/fb/sending/sendFlow',input.apiKey,{method:'POST',body:`{"subscriber_id":${id},"flow_ns":${JSON.stringify(input.flowNs)}}`})
  if(!sent.response.ok){
    const flows=await call(fetcher,'https://api.manychat.com/fb/page/getFlows',input.apiKey)
    const rawFlows=(flows.body.data as Record<string,unknown>|undefined)?.flows
    const flowRows=Array.isArray(rawFlows)?rawFlows as Array<Record<string,unknown>>:[]
    if(flows.response.ok&&!flowRows.some(flow=>String(flow.ns??'')===input.flowNs))throw new ManychatApiError('manychat_flow_not_found',422,sent.response.status,safeProviderReason(sent.body))
    throw new ManychatApiError('manychat_send_failed',502,sent.response.status,safeProviderReason(sent.body))
  }
  console.info('[manychat] flow_started')
  return{subscriber_id:id,phone_last4:phone.slice(-4)}
}

const inFlight=new Map<string,Promise<unknown>>()
export async function withInFlightKey<T>(key:string,operation:()=>Promise<T>){
  const existing=inFlight.get(key) as Promise<T>|undefined
  if(existing)return existing
  const current=operation().finally(()=>inFlight.delete(key));inFlight.set(key,current);return current
}
