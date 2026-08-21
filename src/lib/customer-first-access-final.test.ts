import {describe,expect,it} from 'vitest'
import {readFileSync} from 'node:fs'

const read=(path:string)=>readFileSync(path,'utf8')
const root=read('src/portal/CustomerPortalRoot.tsx')
const registration=read('supabase/functions/customer-registration-start/index.ts')
const administrativeInvite=read('supabase/functions/customer-account-invite/index.ts')
const claim=read('supabase/functions/customer-claim-start/index.ts')
const mailer=read('supabase/functions/_shared/customer-invite.ts')

describe('Minha RUAH first access',()=>{
  it('routes every current invite to the dedicated password page',()=>{for(const source of [registration,administrativeInvite,claim])expect(source).toContain('/minha-ruah/criar-senha?flow=invite')})
  it('keeps the e-mail CTA bound to the validated Supabase action link',()=>{expect(mailer).toContain('CRIAR MINHA SENHA');expect(mailer).toContain('input.actionLink');expect(administrativeInvite).toContain('actionLink: generated.properties.action_link');expect(registration).toContain('actionLink:generated.properties.action_link')})
  it('requires invite evidence, a session and the authenticated user metadata',()=>{const page=root.slice(root.indexOf('function ActivateCompletePage'),root.indexOf('function RegistrationPage'));expect(page).toContain("callbackFlow!=='invite'");expect(page).toContain('auth.getSession()');expect(page).toContain('auth.getUser()');expect(page).toContain('ruah_client_account_id');expect(page).toContain('ruah_public_registration');expect(page).not.toMatch(/auth_user_id/)})
  it('blocks mismatched passwords and enforces the visible password policy',()=>{expect(root).toContain('if (password !== confirm)');expect(root).toContain('As senhas não coincidem.');for(const requirement of ['10 caracteres','Letra maiúscula','Letra minúscula','Número','Caractere especial'])expect(root).toContain(requirement)})
  it('updates only the authenticated Supabase user and confirms success afterwards',()=>{expect(root).toContain('auth.updateUser({ password })');expect(root.indexOf("setStep('success')")).toBeGreaterThan(root.indexOf('auth.updateUser({ password })'));expect(root).toContain('Senha criada com sucesso.');expect(root).toContain('ENTRAR NO MINHA RUAH');expect(root).toContain("auth.signOut().then(()=>go('/minha-ruah/entrar'))")})
  it('handles invalid, expired and consumed links without showing the form',()=>{expect(root).toContain("callbackParams.has('error')");expect(root).toContain("callbackParams.has('error_code')");expect(root).toContain("callbackParams.has('error_description')");expect(root).toContain('Este link não é mais válido.');expect(root).toContain('já ter sido utilizado')})
  it('keeps recovery separate from first access',()=>{expect(root).toContain('/minha-ruah/redefinir-senha`');expect(root).toContain("path === '/minha-ruah/redefinir-senha'");expect(root).not.toContain("callbackFlow!=='recovery'");expect(root).toContain('<ActivateCompletePage recovery />')})
  it('keeps the legacy activation route for already-sent invite links',()=>{expect(root).toContain("path === '/minha-ruah/criar-senha'||path === '/minha-ruah/ativar'")})
})
