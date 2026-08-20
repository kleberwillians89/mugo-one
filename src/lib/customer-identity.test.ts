import {describe,expect,it} from 'vitest'
import fs from 'node:fs'

const migration=fs.readFileSync('supabase/migrations/202608200005_customer_public_identity.sql','utf8')
const root=fs.readFileSync('src/portal/CustomerPortalRoot.tsx','utf8')
const edge=fs.readFileSync('supabase/functions/customer-registration-start/index.ts','utf8')

describe('Minha RUAH public identity security',()=>{
  it('never matches historical clients by name',()=>{expect(migration).not.toMatch(/where[^;]*name\s*=/i)})
  it('requires aal2 in resolver and finalization',()=>{expect((migration.match(/aal2/g)??[]).length).toBeGreaterThanOrEqual(2)})
  it('routes duplicate and conflicting contacts to human review',()=>{expect(migration).toContain('cardinality(email_ids)>1');expect(migration).toContain("email_ids[1]<>phone_ids[1]");expect(migration).toContain("return 'review_required'")})
  it('protects one authenticated identity per request and catches link conflicts',()=>{expect(migration).toContain('unique(auth_user_id)');expect(migration).toContain('unique_violation')})
  it('does not accept a client id from public registration',()=>{expect(edge).not.toMatch(/body\.client_id/);expect(edge).toContain('RUAH_ORGANIZATION_ID')})
  it('uses generic public responses and public registration does not request CPF',()=>{expect(edge).toContain('const generic=');const registration=root.slice(root.indexOf('function RegistrationPage'),root.indexOf('function RecoveryPage'));expect(registration).not.toContain('CPF')})
  it('uses native phone MFA and blocks the portal before aal2',()=>{expect(root).toContain("factorType:'phone'");expect(root).toContain("aal!=='aal2'")})
})
