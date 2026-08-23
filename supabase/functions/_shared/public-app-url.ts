export const DEPLOYED_PUBLIC_APP_URL='https://crm.ruahparfums.com.br'
export const VERCEL_PUBLIC_APP_URL='https://crmruahparfums.vercel.app'
const LEGACY_INVALID_PUBLIC_APP_URL=['https://crm','ruahparfums.com.br'].join('')

export function publicAppUrl(){
  const raw=(Deno.env.get('PUBLIC_APP_URL')??DEPLOYED_PUBLIC_APP_URL).trim().replace(/\/+$/,'')
  const configured=raw===LEGACY_INVALID_PUBLIC_APP_URL?DEPLOYED_PUBLIC_APP_URL:raw
  let url:URL
  try{url=new URL(configured)}catch{throw new Error('invalid_public_app_url')}
  if(url.protocol!=='https:'||url.username||url.password||url.pathname!=='/'||url.search||url.hash)throw new Error('invalid_public_app_url')
  if(![DEPLOYED_PUBLIC_APP_URL,VERCEL_PUBLIC_APP_URL].includes(url.origin))throw new Error('invalid_public_app_url')
  return url.origin
}

export function firstAccessRedirectUrl(){return`${publicAppUrl()}/minha-ruah/criar-senha?flow=invite`}

export function allowedPublicOrigins(){return new Set([DEPLOYED_PUBLIC_APP_URL,VERCEL_PUBLIC_APP_URL,publicAppUrl(),'http://localhost:5173'])}

export function isAllowedPublicOrigin(origin:string|null){return !origin||allowedPublicOrigins().has(origin)}
