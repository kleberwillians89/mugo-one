import {describe,expect,it,vi} from 'vitest'
import {captureInviteCallback,resolveInviteSession} from './first-access-callback'

const session={access_token:'access',refresh_token:'refresh',user:{id:'user-1'}}
const auth=(overrides:Record<string,unknown>={})=>({
  exchangeCodeForSession:vi.fn().mockResolvedValue({data:{session},error:null}),
  verifyOtp:vi.fn().mockResolvedValue({data:{session},error:null}),
  setSession:vi.fn().mockResolvedValue({data:{session},error:null}),
  getSession:vi.fn().mockResolvedValueOnce({data:{session:null},error:null}).mockResolvedValue({data:{session},error:null}),
  ...overrides,
})

describe('callback do primeiro acesso Minha RUAH',()=>{
  it('processa convite novo com PKCE code',async()=>{const client=auth();const result=await resolveInviteSession(client as never,captureInviteCallback({search:'?flow=invite&code=valid',hash:''}));expect(result).toEqual(session);expect(client.exchangeCodeForSession).toHaveBeenCalledWith('valid')})
  it('processa clique no e-mail com hash do Supabase no mobile/desktop',async()=>{const client=auth();await expect(resolveInviteSession(client as never,captureInviteCallback({search:'?flow=invite',hash:'#type=invite&access_token=a&refresh_token=r'}))).resolves.toEqual(session);expect(client.setSession).toHaveBeenCalledWith({access_token:'a',refresh_token:'r'})})
  it('processa token_hash de convite',async()=>{const client=auth();await resolveInviteSession(client as never,captureInviteCallback({search:'?flow=invite&token_hash=hash',hash:''}));expect(client.verifyOtp).toHaveBeenCalledWith({token_hash:'hash',type:'invite'})})
  it('rejeita token expirado ou link reutilizado',async()=>{const client=auth({exchangeCodeForSession:vi.fn().mockResolvedValue({data:{session:null},error:{message:'expired'}})});await expect(resolveInviteSession(client as never,captureInviteCallback({search:'?flow=invite&code=consumed',hash:''}))).resolves.toBeNull()})
  it('rejeita token inválido',async()=>{const client=auth({verifyOtp:vi.fn().mockResolvedValue({data:{session:null},error:{message:'invalid'}})});await expect(resolveInviteSession(client as never,captureInviteCallback({search:'?flow=invite&token_hash=bad',hash:''}))).resolves.toBeNull()})
  it('rejeita callback sem sessão',async()=>{const client=auth({getSession:vi.fn().mockResolvedValue({data:{session:null},error:null})});await expect(resolveInviteSession(client as never,captureInviteCallback({search:'?flow=invite&code=valid',hash:''}))).resolves.toBeNull()})
  it('rejeita abertura direta da rota sem evidência de convite',async()=>{const client=auth();await expect(resolveInviteSession(client as never,captureInviteCallback({search:'?flow=invite',hash:''}))).resolves.toBeNull();expect(client.getSession).not.toHaveBeenCalled()})
  it('rejeita callback com erro explícito do Supabase',async()=>{const client=auth();await expect(resolveInviteSession(client as never,captureInviteCallback({search:'?flow=invite&error_code=otp_expired&code=x',hash:''}))).resolves.toBeNull()})
  it('rejeita qualquer tentativa de redirect malicioso',async()=>{const client=auth();await expect(resolveInviteSession(client as never,captureInviteCallback({search:'?flow=invite&code=x&next=https://evil.example',hash:''}))).resolves.toBeNull()})
})
