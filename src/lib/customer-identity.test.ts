import {describe,expect,it} from 'vitest'
import fs from 'node:fs'

const migration=fs.readFileSync('supabase/migrations/202608200005_customer_public_identity.sql','utf8')
const launch=fs.readFileSync('supabase/migrations/202608200006_customer_portal_launch_aal1.sql','utf8')
const root=fs.readFileSync('src/portal/CustomerPortalRoot.tsx','utf8')
const edge=fs.readFileSync('supabase/functions/customer-registration-start/index.ts','utf8')

describe('Minha RUAH public identity security',()=>{
  it('never matches historical clients by name',()=>{expect(migration).not.toMatch(/where[^;]*name\s*=/i)})
  it('launch resolver accepts authenticated AAL1 but still derives identity only from auth.uid()',()=>{const resolver=launch.slice(launch.indexOf('create or replace function public.current_customer_client'),launch.indexOf('grant execute on function public.current_customer_client'));expect(resolver).toContain('auth.uid() is not null');expect(resolver).toContain('ca.auth_user_id=auth.uid()');expect(resolver).toContain("ca.status='active'");expect(resolver).not.toContain('aal2');expect(resolver).not.toMatch(/p_client_id/)})
  it('denies anonymous execution and permits only authenticated callers',()=>{expect(launch).toContain('revoke all on function public.current_customer_client() from public,anon');expect(launch).toContain('grant execute on function public.current_customer_client() to authenticated')})
  it('finalizes public identity at AAL1 only from the caller request and never from frontend client_id',()=>{const finalize=launch.slice(launch.indexOf('create or replace function public.customer_identity_finalize'),launch.indexOf('revoke all on function public.customer_identity_finalize'));expect(finalize).toContain('if auth.uid() is null');expect(finalize).toContain('where auth_user_id=auth.uid()');expect(finalize).not.toMatch(/p_client_id/);expect(finalize).not.toContain("mfa_verified_at=now()")})
  it('routes duplicate and conflicting contacts to human review',()=>{expect(migration).toContain('cardinality(email_ids)>1');expect(migration).toContain("email_ids[1]<>phone_ids[1]");expect(migration).toContain("return 'review_required'")})
  it('protects one authenticated identity per request and catches link conflicts',()=>{expect(migration).toContain('unique(auth_user_id)');expect(migration).toContain('unique_violation')})
  it('does not accept a client id from public registration',()=>{expect(edge).not.toMatch(/body\.client_id/);expect(edge).toContain('RUAH_ORGANIZATION_ID')})
  it('uses generic public responses and public registration does not request CPF',()=>{expect(edge).toContain('const generic=');const registration=root.slice(root.indexOf('function RegistrationPage'),root.indexOf('function RecoveryPage'));expect(registration).not.toContain('CPF')})
  it('preserves native phone MFA behind a launch flag that defaults to optional',()=>{expect(root).toContain("factorType:'phone'");expect(root).toContain("publicEnv.customerMfaRequired&&aal!=='aal2'");expect(fs.readFileSync('.env.example','utf8')).toContain('VITE_CUSTOMER_MFA_REQUIRED=false')})
  it('never renders the internal provider identifier to the customer',()=>{expect(root).not.toContain('MFA_PROVIDER_NOT_CONFIGURED')})
  it('has explicit friendly states for unavailable provider, invalid code, expiry and rate limits',()=>{
    expect(root).toContain('Estamos finalizando a segurança do seu acesso.')
    expect(root).toContain('Esse código não confere.')
    expect(root).toContain('Esse código expirou.')
    expect(root).toContain('Muitas tentativas foram feitas.')
  })
  it('normalizes Brazilian phone input to E.164 and masks the destination',()=>{expect(root).toContain('`+55${digits}`');expect(root).toContain("digits.slice(-4)")})
  it('reuses an existing phone factor before enrolling another',()=>{expect(root).toContain("item.status==='verified'");expect(root.indexOf("item.status==='verified'")).toBeLessThan(root.indexOf("mfa.enroll"))})
  it('checks refreshed assurance before MFA-specific finalization',()=>{const mfa=root.slice(root.indexOf('function MfaPage'),root.indexOf('function PortalLoginPage'));expect(mfa).toContain("currentLevel!=='aal2'");expect(mfa.indexOf("currentLevel!=='aal2'")).toBeLessThan(mfa.indexOf('finalizeCustomerIdentity'))})
  it('keeps review accounts out of the private app and finalizes identity before rendering it',()=>{expect(root.indexOf('if(review)return')).toBeLessThan(root.indexOf('return <CustomerPortalApp'));expect(root).toContain('if(!identityReady)return <IdentityLaunchGate')})
})
