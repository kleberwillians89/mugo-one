export type SuperFreteConfig = { token:string;baseUrl:string;userAgent:string }
export {isTimeout,normalizeQuote,numberValue,providerValidation,safeProviderError,validDocument,validPhone} from './superfrete-domain.ts'

export function superFreteConfig():SuperFreteConfig {
  const token=Deno.env.get('SUPERFRETE_TOKEN')?.trim()
  const baseUrl=(Deno.env.get('SUPERFRETE_BASE_URL')||'https://api.superfrete.com').trim().replace(/\/$/,'')
  const userAgent=Deno.env.get('SUPERFRETE_USER_AGENT')?.trim()
  if(!token||!userAgent)throw new Error('superfrete_not_configured')
  if(!/^https:\/\//.test(baseUrl))throw new Error('superfrete_invalid_base_url')
  return {token,baseUrl,userAgent}
}

export async function superFreteRequest(path:string,init:RequestInit,timeoutMs=20000){
  const config=superFreteConfig(),controller=new AbortController(),timer=setTimeout(()=>controller.abort(),timeoutMs)
  try{
    const response=await fetch(`${config.baseUrl}${path}`,{...init,signal:controller.signal,headers:{
      accept:'application/json','content-type':'application/json',authorization:`Bearer ${config.token}`,'user-agent':config.userAgent,...(init.headers||{}),
    }})
    const raw=await response.text();let body:unknown=null
    try{body=raw?JSON.parse(raw):null}catch{/* resposta não JSON descartada */}
    if(!response.ok){const error=new Error(`superfrete_http_${response.status}`) as Error&{status:number;providerBody:unknown};error.status=response.status;error.providerBody=body;throw error}
    return body
  }finally{clearTimeout(timer)}
}

export const digits=(value:unknown)=>String(value??'').replace(/\D/g,'')
export function extractOrderState(value:unknown){
  const root=(value&&typeof value==='object'?value:{}) as Record<string,unknown>
  const orders=Array.isArray(root.orders)?root.orders:[]
  const purchase=(root.purchase&&typeof root.purchase==='object'?root.purchase:{}) as Record<string,unknown>
  const candidate=(orders[0]||purchase.order||purchase||root) as Record<string,unknown>
  return {...candidate,status:candidate.status??purchase.status??root.status,tracking:candidate.tracking??root.tracking,print:candidate.print??root.print}
}
