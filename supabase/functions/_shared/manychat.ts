export type MessageType='collection'|'access'
export type Fetcher=(input:string|URL,init?:RequestInit)=>Promise<Response>

export class ManychatApiError extends Error{
  constructor(public code:string,public httpStatus=502){super(code)}
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

async function call(fetcher:Fetcher,url:string,apiKey:string,init:RequestInit={}){
  let response:Response
  try{response=await fetcher(url,{...init,headers:{authorization:`Bearer ${apiKey}`,'content-type':'application/json'}})}
  catch{throw new ManychatApiError('manychat_unavailable',503)}
  const body=await parse(response)
  if(response.status===401||response.status===403)throw new ManychatApiError('manychat_token_invalid')
  return{response,body}
}

export async function sendManychatFlow(input:{apiKey:string;flowNs:string;phone:string;name:string;fetcher?:Fetcher}){
  const fetcher=input.fetcher??fetch,phone=normalizeBrazilianPhone(input.phone)
  if(!phone)throw new ManychatApiError('invalid_phone',422)
  let lookup=await call(fetcher,`https://api.manychat.com/fb/subscriber/findBySystemField?phone=${encodeURIComponent(phone)}`,input.apiKey)
  let id:string
  if(lookup.response.ok&&!hasNoSubscriber(lookup.body))id=subscriberId(lookup.body)
  else if(lookup.response.ok||isNotFound(lookup.response.status,lookup.body)){
    const name=splitContactName(input.name)
    const created=await call(fetcher,'https://api.manychat.com/fb/subscriber/createSubscriber',input.apiKey,{method:'POST',body:JSON.stringify({...name,whatsapp_phone:phone})})
    if(!created.response.ok)throw new ManychatApiError('manychat_create_contact_failed')
    id=subscriberId(created.body)
  }else throw new ManychatApiError('manychat_lookup_failed')
  const sent=await call(fetcher,'https://api.manychat.com/fb/sending/sendFlow',input.apiKey,{method:'POST',body:`{"subscriber_id":${id},"flow_ns":${JSON.stringify(input.flowNs)}}`})
  if(!sent.response.ok)throw new ManychatApiError('manychat_send_failed')
  return{subscriber_id:id,phone_last4:phone.slice(-4)}
}

const inFlight=new Map<string,Promise<unknown>>()
export async function withInFlightKey<T>(key:string,operation:()=>Promise<T>){
  const existing=inFlight.get(key) as Promise<T>|undefined
  if(existing)return existing
  const current=operation().finally(()=>inFlight.delete(key));inFlight.set(key,current);return current
}
