import type {SupabaseClient} from '@supabase/supabase-js'

export type InviteCallback={flow:string|null;code:string;tokenHash:string;accessToken:string;refreshToken:string;error:string;unsafeRedirect:boolean;hasEvidence:boolean}

export function captureInviteCallback(source:Pick<Location,'search'|'hash'>|{search:string;hash:string}):InviteCallback{
  const params=new URLSearchParams(`${source.search.replace(/^\?/,'')}&${source.hash.replace(/^#/,'')}`)
  const flow=params.get('flow')??params.get('type')
  const code=params.get('code')??'',tokenHash=params.get('token_hash')??'',accessToken=params.get('access_token')??'',refreshToken=params.get('refresh_token')??''
  return{
    flow,code,tokenHash,accessToken,refreshToken,
    error:params.get('error_description')??params.get('error_code')??params.get('error')??'',
    unsafeRedirect:['redirect','redirect_to','return_to','next'].some(key=>params.has(key)),
    hasEvidence:Boolean(code||tokenHash||(accessToken&&refreshToken)),
  }
}

export const initialInviteCallback=captureInviteCallback(typeof location==='undefined'?{search:'',hash:''}:location)

type Auth=Pick<SupabaseClient['auth'],'exchangeCodeForSession'|'getSession'|'setSession'|'verifyOtp'>

export async function resolveInviteSession(auth:Auth,callback:InviteCallback=initialInviteCallback){
  if(callback.flow!=='invite'||callback.error||callback.unsafeRedirect||!callback.hasEvidence)return null
  const existing=await auth.getSession()
  if(existing.data.session&&!existing.error)return existing.data.session
  if(callback.code){const result=await auth.exchangeCodeForSession(callback.code);if(result.error)return null}
  else if(callback.tokenHash){const result=await auth.verifyOtp({token_hash:callback.tokenHash,type:'invite'});if(result.error)return null}
  else{const result=await auth.setSession({access_token:callback.accessToken,refresh_token:callback.refreshToken});if(result.error)return null}
  const {data,error}=await auth.getSession()
  return error?null:data.session
}

export function removeAuthSecretsFromUrl(){
  if(typeof history==='undefined'||typeof location==='undefined')return
  history.replaceState({},'',`${location.pathname}?flow=invite`)
}
