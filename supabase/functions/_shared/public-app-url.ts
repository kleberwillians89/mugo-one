export const DEPLOYED_PUBLIC_APP_URL='https://crm.ruahparfums.com.br'
export const VERCEL_PUBLIC_APP_URL='https://crmruahparfums.vercel.app'
const LEGACY_INVALID_PUBLIC_APP_URL=['https://crm','ruahparfums.com.br'].join('')

// ADDITIONAL_ALLOWED_ORIGINS (variável de ambiente opcional, origens
// https separadas por vírgula) permite habilitar o domínio de uma nova
// organização/tenant sem alterar código-fonte — parte da productização
// Mugô One (ver docs/RUAH_HARDCODE_CATALOG.md). Sem a variável definida,
// o comportamento é idêntico ao anterior (só os domínios da RUAH).
function additionalAllowedOrigins():string[]{
  const raw=Deno.env.get('ADDITIONAL_ALLOWED_ORIGINS')??''
  const origins:string[]=[]
  for(const candidate of raw.split(',').map((s)=>s.trim()).filter(Boolean)){
    try{
      const url=new URL(candidate)
      if(url.protocol==='https:'&&!url.username&&!url.password&&url.pathname==='/'&&!url.search&&!url.hash)origins.push(url.origin)
    }catch{/* entrada inválida em ADDITIONAL_ALLOWED_ORIGINS é ignorada, nunca derruba a função */}
  }
  return origins
}

export function publicAppUrl(){
  const raw=(Deno.env.get('PUBLIC_APP_URL')??DEPLOYED_PUBLIC_APP_URL).trim().replace(/\/+$/,'')
  const configured=raw===LEGACY_INVALID_PUBLIC_APP_URL?DEPLOYED_PUBLIC_APP_URL:raw
  let url:URL
  try{url=new URL(configured)}catch{throw new Error('invalid_public_app_url')}
  if(url.protocol!=='https:'||url.username||url.password||url.pathname!=='/'||url.search||url.hash)throw new Error('invalid_public_app_url')
  if(![DEPLOYED_PUBLIC_APP_URL,VERCEL_PUBLIC_APP_URL,...additionalAllowedOrigins()].includes(url.origin))throw new Error('invalid_public_app_url')
  return url.origin
}

export function firstAccessRedirectUrl(){return`${publicAppUrl()}/minha-ruah/criar-senha?flow=invite`}

export function allowedPublicOrigins(){return new Set([DEPLOYED_PUBLIC_APP_URL,VERCEL_PUBLIC_APP_URL,publicAppUrl(),'http://localhost:5173',...additionalAllowedOrigins()])}

export function isAllowedPublicOrigin(origin:string|null){return !origin||allowedPublicOrigins().has(origin)}
