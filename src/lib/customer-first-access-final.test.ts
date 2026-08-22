import {describe,expect,it} from 'vitest'
import {readFileSync} from 'node:fs'

const read=(path:string)=>readFileSync(path,'utf8')
const root=read('src/portal/CustomerPortalRoot.tsx')
const registration=read('supabase/functions/customer-registration-start/index.ts')
const administrativeInvite=read('supabase/functions/customer-account-invite/index.ts')
const claim=read('supabase/functions/customer-claim-start/index.ts')
const mailer=read('supabase/functions/_shared/customer-invite.ts')
const publicUrl=read('supabase/functions/_shared/public-app-url.ts')
const callback=read('src/portal/first-access-callback.ts')
const portalCss=read('src/portal/customer-portal.css')
const contextMigration=read('supabase/migrations/202608220001_customer_first_access_context.sql')

describe('Minha RUAH first access',()=>{
  it('routes every current invite through the single public URL configuration',()=>{for(const source of [registration,administrativeInvite,claim])expect(source).toContain('firstAccessRedirectUrl()');expect(publicUrl).toContain("DEPLOYED_PUBLIC_APP_URL='https://crmruahparfums.vercel.app'");expect(publicUrl).toContain("Deno.env.get('PUBLIC_APP_URL')")})
  it('keeps the e-mail CTA bound to the validated Supabase action link',()=>{expect(mailer).toContain('CRIAR MINHA SENHA');expect(mailer).toContain('input.actionLink');expect(administrativeInvite).toContain('actionLink: generated.properties.action_link');expect(registration).toContain('actionLink:generated.properties.action_link')})
  it('requires fresh invite evidence, a session and authenticated user metadata',()=>{const page=root.slice(root.indexOf('function ActivateCompletePage'),root.indexOf('function RegistrationPage'));expect(page).toContain('resolveInviteSession');expect(callback).toContain("callback.flow!=='invite'");expect(callback).toContain('!callback.hasEvidence');expect(page).toContain('auth.getUser()');expect(page).toContain('ruah_client_account_id');expect(page).toContain('ruah_public_registration');expect(page).not.toMatch(/auth_user_id/)})
  it('blocks mismatched passwords and enforces the visible password policy',()=>{expect(root).toContain('if (password !== confirm)');expect(root).toContain('As senhas não coincidem.');for(const requirement of ['10 caracteres','Letra maiúscula','Letra minúscula','Número','Caractere especial'])expect(root).toContain(requirement)})
  it('updates only the authenticated Supabase user and confirms success afterwards',()=>{expect(root).toContain('auth.updateUser({ password })');expect(root.indexOf("setStep('success')")).toBeGreaterThan(root.indexOf('auth.updateUser({ password })'));expect(root).toContain('Senha criada com sucesso.');expect(root).toContain('ENTRAR NO MINHA RUAH');expect(root).toContain("auth.signOut().then(()=>go('/minha-ruah/entrar'))")})
  it('handles invalid, expired and consumed links without showing the form',()=>{expect(callback).toContain("params.get('error_description')");expect(callback).toContain("params.get('error_code')");expect(root).toContain('Este link não é mais válido.');expect(root).toContain('já ter sido utilizado')})
  it('keeps recovery separate from first access',()=>{expect(root).toContain('/minha-ruah/redefinir-senha`');expect(root).toContain("path === '/minha-ruah/redefinir-senha'");expect(root).not.toContain("callbackFlow!=='recovery'");expect(root).toContain('<ActivateCompletePage recovery />')})
  it('keeps the legacy activation route for already-sent invite links',()=>{expect(root).toContain("path === '/minha-ruah/criar-senha'||path === '/minha-ruah/ativar'")})
  it('keeps an already activated customer protected from invite and password reset',()=>{expect(administrativeInvite).toContain("prepareError.message?.includes('account_already_active')");expect(claim).toContain("account.status === 'active'");expect(contextMigration).toContain("status='pending_verification'");expect(contextMigration).not.toContain("status='active'")})
  it('keeps the password form usable on mobile',()=>{expect(portalCss).toContain('Mobile-first (390px');expect(portalCss).toMatch(/@media\s*\(max-width:390px\)/);expect(portalCss).toContain('min-height:44px')})
  it('never trusts a callback-provided destination',()=>{expect(callback).toContain("['redirect','redirect_to','return_to','next']");expect(callback).not.toMatch(/location\.(assign|replace)\s*\(/)})
})
