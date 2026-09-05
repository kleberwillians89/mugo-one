import{readFileSync}from'node:fs'
import{describe,expect,it}from'vitest'
import{CADASTRAL_FIELDS}from'../../scripts/emily-client-reconciliation.mjs'

const migration=readFileSync('supabase/migrations/202609050001_client_cadastral_safe_apply.sql','utf8')

describe('RPC de aplicação segura do cruzamento cadastral (clients)',()=>{
 it('é uma RPC administrativa (service_role/ator explícito), exige clients.edit e nunca depende de auth.uid()',()=>{
  // Chamada por script via service_role (não pela sessão do usuário no app),
  // então auth.uid() seria sempre null — por isso p_actor_id é explícito e
  // verificado contra organization_members/organization_member_permissions.
  expect(migration).toContain("if p_actor_id is null then raise exception 'authentication_required'")
  expect(migration).toContain("public.has_org_permission_for_actor(p_organization_id,p_actor_id,'clients.edit')")
  expect(migration).toContain("raise exception 'permission_denied'")
  const applyBody=migration.slice(migration.indexOf('create or replace function public.apply_client_cadastral_safe_batch'),migration.indexOf('revoke all on function public.apply_client_cadastral_safe_batch'))
  const rollbackBody=migration.slice(migration.indexOf('create or replace function public.rollback_client_cadastral_safe_batch'),migration.indexOf('revoke all on function public.rollback_client_cadastral_safe_batch'))
  expect(applyBody).not.toMatch(/auth\.uid\(\)/)
  expect(rollbackBody).not.toMatch(/auth\.uid\(\)/)
 })
 it('trava cada cliente com FOR UPDATE e revalida tenant/soft-delete/merge antes de aplicar',()=>{
  const applyFn=migration.slice(migration.indexOf('create or replace function public.apply_client_cadastral_safe_batch'),migration.indexOf('revoke all on function public.apply_client_cadastral_safe_batch'))
  expect(applyFn).toContain('for update')
  expect(applyFn).toContain("raise exception 'client_not_found")
  expect(applyFn).toContain("raise exception 'client_deleted")
  expect(applyFn).toContain("raise exception 'client_merged")
 })
 it('aborta o lote inteiro se o cliente mudou desde o dry-run (updated_at ou qualquer campo proposto)',()=>{
  expect(migration).toContain("raise exception 'stale_client")
  expect(migration).toContain("raise exception 'stale_field:cpf")
  expect(migration).toContain("raise exception 'stale_field:phone")
  expect(migration).toContain("raise exception 'stale_field:email")
  expect(migration).toContain("raise exception 'stale_field:postal_code")
  expect(migration).toContain("raise exception 'stale_field:%:%'")
 })
 it('nunca aplica se criaria ambiguidade nova em cpf, telefone ou e-mail',()=>{
  expect(migration).toContain("raise exception 'cpf_would_create_ambiguity")
  expect(migration).toContain("raise exception 'phone_would_create_ambiguity")
  expect(migration).toContain("raise exception 'email_would_create_ambiguity")
  expect(migration).toMatch(/normalized_cpf=new_normalized_cpf/)
  expect(migration).toMatch(/normalized_whatsapp=new_normalized_phone/)
  expect(migration).toMatch(/normalized_email=new_normalized_email/)
 })
 it('só aceita os 10 campos cadastrais aprovados — nunca nome, status, client_number ou has_gift',()=>{
  expect(migration).toContain("allowed_fields constant text[] := array['cpf','phone','email','postal_code','address_line','address_number','complement','district','city','state']")
  expect(migration).toContain("raise exception 'field_not_approved")
  expect(migration).not.toMatch(/allowed_fields[^;]*'name'/)
  expect(migration).not.toMatch(/allowed_fields[^;]*'status'/)
  expect(migration).not.toMatch(/allowed_fields[^;]*'client_number'/)
  expect(migration).not.toMatch(/allowed_fields[^;]*'has_gift'/)
 })
 it('cada client_id só pode aparecer uma vez no lote',()=>{
  expect(migration).toContain("raise exception 'duplicate_client_id'")
 })
 it('recalcula o fingerprint do lote no servidor e rejeita qualquer payload adulterado',()=>{
  expect(migration).toContain('client_cadastral_safe_batch_fingerprint')
  expect(migration).toContain("raise exception 'manifest_fingerprint_mismatch'")
 })
 it('fingerprint do servidor usa exatamente a mesma ordem de campos que o script de dry-run',()=>{
  const fingerprintFn=migration.slice(migration.indexOf('create or replace function public.client_cadastral_safe_batch_fingerprint'),migration.indexOf('revoke all on function public.client_cadastral_safe_batch_fingerprint'))
  const positions=CADASTRAL_FIELDS.map(field=>fingerprintFn.indexOf(`proposed_changes,${field},after`))
  expect(positions.every(pos=>pos>=0)).toBe(true)
  for(let index=1;index<positions.length;index++)expect(positions[index]).toBeGreaterThan(positions[index-1])
 })
 it('é idempotente via import_batches (mesmo file_hash+fingerprint não aplica de novo nem duplica audit)',()=>{
  expect(migration).toContain("status='completed' for update")
  expect(migration).toContain("'idempotent',true")
  expect(migration).toContain("client_cadastral_idempotency_conflict")
 })
 it('audita batch_id, source_row, match_method, before e after por cliente, sem sobrescrever o objeto inteiro',()=>{
  expect(migration).toContain("'client_cadastral_safe_update'")
  expect(migration).toMatch(/'batch_id',batch_id,'source_row',item->>'source_row','match_method',item->>'match_method'/)
  expect(migration).toContain("'before',audit_before,'after',audit_after")
  expect(migration).toMatch(/cpf = case when item->'proposed_changes' \? 'cpf' then item#>>'\{proposed_changes,cpf,after\}' else cpf end/)
 })
 it('nunca toca sales, inventory, shipments, perfumes ou allocation — só public.clients e as tabelas de auditoria/lote',()=>{
  expect(migration).not.toMatch(/insert into public\.sales|update public\.sales|delete from public\.sales/i)
  expect(migration).not.toMatch(/inventory_(items|movements|allocations|purchase_entries)/i)
  expect(migration).not.toMatch(/public\.shipments|public\.shipment_items/i)
  expect(migration).not.toMatch(/public\.perfumes/i)
  expect(migration).toContain('sales_touched\',false')
  expect(migration).toContain('client_id_reassigned\',false')
 })
 it('rollback só reverte se o valor atual ainda for o "after" gravado por este batch, e é idempotente',()=>{
  const rollbackFn=migration.slice(migration.indexOf('create or replace function public.rollback_client_cadastral_safe_batch'))
  expect(rollbackFn).toContain("raise exception 'client_changed_since_batch")
  expect(rollbackFn).toContain("raise exception 'batch_not_found'")
  expect(rollbackFn).toContain("'client_cadastral_safe_batch_rolled_back'")
  expect(rollbackFn).toContain("'idempotent',true,'reverted',0")
  expect(rollbackFn).toContain('for update')
 })
 it('nega execução a public/anon/authenticated e concede só a service_role (RPC administrativa de script, não do app)',()=>{
  expect(migration).toContain('revoke all on function public.apply_client_cadastral_safe_batch(uuid,uuid,text,text,text,jsonb) from public,anon,authenticated')
  expect(migration).toContain('grant execute on function public.apply_client_cadastral_safe_batch(uuid,uuid,text,text,text,jsonb) to service_role')
  expect(migration).toContain('revoke all on function public.rollback_client_cadastral_safe_batch(uuid,uuid,uuid) from public,anon,authenticated')
  expect(migration).toContain('grant execute on function public.rollback_client_cadastral_safe_batch(uuid,uuid,uuid) to service_role')
  expect(migration).toContain('grant execute on function public.has_org_permission_for_actor(uuid,uuid,text) to service_role')
 })
})
