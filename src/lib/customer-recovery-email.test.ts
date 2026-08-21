import {describe,expect,it} from 'vitest'
import {readFileSync} from 'node:fs'

const portal=readFileSync('src/portal/CustomerPortalRoot.tsx','utf8')
const template=readFileSync('docs/minha-ruah-reset-password.html','utf8')

describe('Minha RUAH recovery e-mail handoff',()=>{
  it('keeps Supabase Auth as token and password authority',()=>{expect(portal).toContain('auth.resetPasswordForEmail');expect(portal).toContain('auth.updateUser({ password })');expect(portal).toContain('auth.getSession()');expect(portal).toContain('auth.getUser()');expect(portal).not.toContain('admin.updateUserById')})
  it('uses the canonical recovery destination',()=>{expect(portal).toContain("redirectTo:`${location.origin}/minha-ruah/redefinir-senha`");expect(portal).toContain("path === '/minha-ruah/redefinir-senha'");expect(portal).toContain("path==='/minha-ruah/confirmar-recuperacao'")})
  it('keeps first access and recovery as separate routes',()=>{expect(portal).toContain("path === '/minha-ruah/criar-senha'");expect(portal).toContain("path === '/minha-ruah/redefinir-senha'");expect(portal).toContain("callbackFlow!=='invite'");expect(portal).toContain("callbackFlow!=='recovery'")})
  it('renders recovery-specific fields, actions and friendly states',()=>{for(const copy of ['Nova senha','Confirmar nova senha','REDEFINIR SENHA','Sua senha foi redefinida com sucesso.','Este link de recuperação não é mais válido.','SOLICITAR NOVO LINK','VOLTAR PARA ENTRAR'])expect(portal).toContain(copy)})
  it('provides a premium Portuguese Supabase Reset Password template',()=>{expect(template).toContain('{{ .TokenHash }}');expect(template).toContain('/minha-ruah/confirmar-recuperacao?token_hash=');expect(template).not.toContain('{{ .ConfirmationURL }}');expect(template).toContain('REDEFINIR MINHA SENHA');expect(template).toContain('Redefina sua senha');expect(template).toContain('RUAH PARFUMS');expect(template).not.toMatch(/Reset your password|Supabase Auth|powered by Supabase/i)})
  it('uses only inline e-mail CSS and contains no credential',()=>{expect(template).not.toContain('<link');expect(template).not.toContain('<style');expect(template).not.toMatch(/re_[A-Za-z0-9]{10,}|RESEND_API_KEY|password\s*=/i)})
})
