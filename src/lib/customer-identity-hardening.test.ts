import{describe,expect,it}from'vitest'
import{readFileSync}from'node:fs'

const sql=readFileSync('supabase/migrations/202608210001_customer_identity_hardening.sql','utf8')
const finalize=sql.slice(sql.indexOf('create or replace function public.customer_identity_finalize'),sql.indexOf('revoke all on function public.customer_identity_finalize'))

describe('Minha RUAH identity hardening migration',()=>{
  it('normalizes e-mail through the existing contacts trigger pattern without changing email',()=>{expect(sql).toContain('add column if not exists normalized_email text');expect(sql).toContain("new.normalized_email:=nullif(lower(btrim(coalesce(new.email,''))),'')");expect(sql).toContain('before insert or update of phone,whatsapp_phone,cpf,postal_code,email,state');expect(sql).not.toMatch(/set\s+email\s*=/i)})
  it('creates partial lookup indexes but never makes contacts unique',()=>{expect(sql).toContain('clients_org_normalized_email_hardening_idx');expect(sql).toContain('clients_org_normalized_whatsapp_hardening_idx');expect(sql.match(/where normalized_(?:email|whatsapp) is not null and deleted_at is null and merged_into_id is null/g)).toHaveLength(2);expect(sql).not.toMatch(/create unique index[^;]*normalized_(email|whatsapp)/i)})
  it('prevalidates and protects both client-account invariants',()=>{expect(sql).toContain('group by auth_user_id having count(*)>1');expect(sql).toContain('group by organization_id,client_id having count(*)>1');expect(sql).toContain('unique index if not exists client_accounts_auth_user_uidx');expect(sql).toContain('unique index if not exists client_accounts_org_client_hardening_uidx')})
  it('resolves only the authenticated request inside its organization',()=>{expect(finalize).toContain('where auth_user_id=auth.uid()');expect(finalize).toContain('where organization_id=r.organization_id');expect(finalize).not.toMatch(/p_client_id/);expect(finalize).not.toMatch(/limit\s+1/i)})
  it('accepts only eligible active clients and rejects merged or deleted records',()=>{expect(finalize.match(/deleted_at is null/g)).toHaveLength(2);expect(finalize.match(/merged_into_id is null/g)).toHaveLength(2);expect(finalize.match(/status='active'/g)??[]).toHaveLength(3)})
  it('uses normalized email first, phone as evidence, and never links by name',()=>{expect(finalize.indexOf('normalized_email=')).toBeLessThan(finalize.indexOf('normalized_whatsapp='));const lookups=finalize.slice(finalize.indexOf('select coalesce(array_agg(id order by id)'),finalize.indexOf("target:=coalesce"));expect(lookups).not.toMatch(/normalized_name|name\s*=/)})
  it('routes ambiguity and cross-contact conflicts to review',()=>{expect(finalize).toContain('cardinality(email_ids)>1');expect(finalize).toContain('cardinality(phone_ids)>1');expect(finalize).toContain('email_ids[1]<>phone_ids[1]');expect(finalize).toContain("'identity_conflict'")})
  it('serializes the request and returns linked idempotently',()=>{expect(finalize).toContain('for update');expect(finalize).toContain("r.status='linked'");expect(finalize).toContain("return 'linked'");expect(finalize.indexOf("r.status='linked'")).toBeLessThan(finalize.indexOf('normalized_email='))})
  it('uses unique violations only as a final defensive review path',()=>{expect(finalize).toContain('exception when unique_violation');expect(finalize).toContain("'unique_link_conflict'");expect(finalize).toContain("return 'review_required'")})
})

type Candidate={id:string;organization:string;email:string|null;whatsapp:string|null;eligible:boolean}
const resolve=(organization:string,email:string,phone:string,clients:Candidate[])=>{
  const eligible=clients.filter(c=>c.organization===organization&&c.eligible)
  const emails=eligible.filter(c=>c.email===email).map(c=>c.id),phones=eligible.filter(c=>c.whatsapp===phone).map(c=>c.id)
  if(emails.length>1||phones.length>1||(emails.length===1&&phones.length===1&&emails[0]!==phones[0]))return'review_required'
  return emails[0]??phones[0]??'new_client'
}

describe.each([10,50,100])('synthetic identity resolution volume: %i requests',(volume)=>{
  it('has zero ambiguous arbitrary links and preserves tenant isolation',()=>{const clients=Array.from({length:volume},(_,i)=>({id:`c${i}`,organization:i%2?'org-b':'org-a',email:`u${i}@qa.test`,whatsapp:`55${String(i).padStart(11,'0')}`,eligible:true}));const results=clients.map(c=>resolve(c.organization,c.email!,c.whatsapp!,clients));expect(new Set(results).size).toBe(volume);expect(results.every((id,i)=>id===`c${i}`)).toBe(true);expect(resolve('org-a','u1@qa.test',clients[1].whatsapp!,clients)).toBe('new_client')})
  it('routes duplicate and conflicting evidence to review and no-match to creation',()=>{const clients:Candidate[]=[{id:'a',organization:'org',email:'same@qa.test',whatsapp:'5511',eligible:true},{id:'b',organization:'org',email:'same@qa.test',whatsapp:'5522',eligible:true}];expect(resolve('org','same@qa.test','5511',clients)).toBe('review_required');expect(resolve('org','none@qa.test','5533',clients)).toBe('new_client')})
})

describe('synthetic concurrency invariants',()=>{
  it('keeps repeated finalization for the same auth identity idempotent',async()=>{const accounts=new Map<string,string>();const finalizeSynthetic=async(authId:string,clientId:string)=>{const linked=accounts.get(authId);if(linked)return linked===clientId?'linked':'review_required';accounts.set(authId,clientId);return'linked'};const results=await Promise.all([finalizeSynthetic('auth-a','client-a'),finalizeSynthetic('auth-a','client-a')]);expect(results).toEqual(['linked','linked']);expect(accounts.size).toBe(1)})
  it('does not allow two auth identities to claim the same client',async()=>{const claimedClients=new Set<string>();const finalizeSynthetic=async(clientId:string)=>{if(claimedClients.has(clientId))return'review_required';claimedClients.add(clientId);return'linked'};const results=await Promise.all([finalizeSynthetic('client-a'),finalizeSynthetic('client-a')]);expect(results).toEqual(['linked','review_required']);expect(claimedClients.size).toBe(1)})
})
