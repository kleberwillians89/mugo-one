export type PrintProbe={available:boolean;httpStatus:number|null;contentType:string|null;reason:'ready'|'missing_url'|'invalid_url'|'untrusted_source'|'external_error'|'not_pdf'}

const officialHost=(hostname:string)=>hostname==='superfrete.com'||hostname.endsWith('.superfrete.com')
const unsafeHost=(hostname:string)=>hostname==='localhost'||hostname.endsWith('.localhost')||hostname==='0.0.0.0'||hostname==='127.0.0.1'||hostname==='::1'||hostname.startsWith('10.')||hostname.startsWith('192.168.')||/^172\.(1[6-9]|2\d|3[01])\./.test(hostname)

export function officialPrintUrl(value:unknown){
  try{const url=new URL(String(value??''));return url.protocol==='https:'&&officialHost(url.hostname)?url:null}catch{return null}
}

export function safeRedirectUrl(value:string){
  try{const url=new URL(value);return url.protocol==='https:'&&!unsafeHost(url.hostname)}catch{return false}
}

export function looksLikePdf(headers:Headers,firstBytes:Uint8Array){
  const type=String(headers.get('content-type')??'').toLowerCase(),disposition=String(headers.get('content-disposition')??'').toLowerCase()
  return type.includes('application/pdf')||disposition.includes('.pdf')||new TextDecoder().decode(firstBytes.slice(0,5))==='%PDF-'
}

export async function probeOfficialPrintFile(value:unknown,fetcher:typeof fetch=fetch):Promise<PrintProbe>{
  if(!String(value??'').trim())return {available:false,httpStatus:null,contentType:null,reason:'missing_url'}
  const source=officialPrintUrl(value)
  if(!source)return {available:false,httpStatus:null,contentType:null,reason:String(value).startsWith('https:')?'untrusted_source':'invalid_url'}
  try{
    const response=await fetcher(source,{method:'GET',redirect:'follow',signal:AbortSignal.timeout(15_000),headers:{accept:'application/pdf,application/octet-stream;q=0.9,*/*;q=0.1'}})
    const contentType=response.headers.get('content-type')
    if(!safeRedirectUrl(response.url||source.href)){await response.body?.cancel();return {available:false,httpStatus:response.status,contentType,reason:'untrusted_source'}}
    let firstBytes=new Uint8Array()
    if(response.ok&&response.body){const reader=response.body.getReader();const chunk=await reader.read();firstBytes=chunk.value??firstBytes;await reader.cancel()}
    const available=response.ok&&looksLikePdf(response.headers,firstBytes)
    return {available,httpStatus:response.status,contentType,reason:available?'ready':'not_pdf'}
  }catch{return {available:false,httpStatus:null,contentType:null,reason:'external_error'}}
}
