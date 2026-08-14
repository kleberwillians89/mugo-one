import {readFileSync} from 'node:fs'
import {describe,expect,it} from 'vitest'

const sql=readFileSync(new URL('../../supabase/migrations/202608140001_final_operational_pass.sql',import.meta.url),'utf8')
const records=readFileSync(new URL('./records.ts',import.meta.url),'utf8')

describe('migration operacional final',()=>{
  it('restringe os RPCs de conferência e destinatário a authenticated',()=>{
    expect(sql).toContain('revoke all on function public.update_shipment_item_check(uuid,uuid,boolean,boolean,text) from public,anon;')
    expect(sql).toContain('grant execute on function public.update_shipment_item_check(uuid,uuid,boolean,boolean,text) to authenticated;')
    expect(sql).toContain('revoke all on function public.refresh_shipment_recipient(uuid) from public,anon;')
    expect(sql).toContain('grant execute on function public.refresh_shipment_recipient(uuid) to authenticated;')
  })
  it('revalida tenant e bloqueia alterações depois da conferência',()=>{
    expect(sql).toContain("not public.has_org_role(shipment.organization_id,array['admin','manager','operator']::public.member_role[])")
    expect(sql).toContain("shipment.conference_completed_at is not null then raise exception 'conference_already_completed'")
  })
  it('protege autoria inicial e conclusão contra update falsificado',()=>{
    expect(sql).toContain('revoke insert,update,delete on public.shipments from authenticated;')
    expect(sql).toContain("new.conference_owner_user_id<>auth.uid() then raise exception 'conference_owner_must_be_authenticated_user'")
    expect(sql).toContain('new.conference_owner_name_snapshot:=actor_name')
    expect(sql).toContain('new.conference_started_at:=now()')
    expect(sql).toContain("raise exception 'conference_completion_immutable'")
    expect(sql).toContain("raise exception 'conference_items_required'")
    expect(sql).toContain("raise exception 'conference_items_incomplete'")
    expect(sql).toContain('new.conference_completed_at:=now()')
  })
  it('preserva fallback do conferente sem profile e ignora contatos vazios',()=>{
    expect(sql).toContain("from public.profiles where id=auth.uid()),'Usuário RUAH')")
    expect(sql).toContain("coalesce(nullif(btrim(c.phone),''),nullif(btrim(c.whatsapp_phone),''))")
    expect(sql).toContain("coalesce(nullif(btrim(c.cpf),''),nullif(btrim(c.cnpj),''))")
  })
  it('prova que o write real valida o estoque e mantém multilote bloqueado',()=>{
    expect(records).toContain("supabase!.rpc('confirm_ai_sales_batch'")
    expect(sql).toContain('perfume:=public.validate_ai_batch_inventory(p_organization_id,inventory_item);')
    expect(sql).toContain("raise exception 'multi_perfume_batch_not_supported'")
    expect(sql).toContain('inventory_item_id,perfume_name')
  })
  it('não escolhe cliente homônimo arbitrariamente e rejeita client_id excluído',()=>{
    expect(sql).toContain('select count(*) into client_match_count')
    expect(sql).toContain('if client_match_count=1 then select id into client')
    expect(sql).toContain("client_match_count>1 then raise exception 'client_resolution_ambiguous'")
    expect(sql).not.toContain('normalized_name=normalized and deleted_at is null limit 1')
    expect(sql).toContain('id=client and organization_id=p_organization_id and deleted_at is null')
  })
  it('é transacional para execução manual no SQL Editor',()=>{
    expect(sql.trimStart().indexOf('begin;')).toBeGreaterThanOrEqual(0)
    expect(sql.trimEnd().endsWith('commit;')).toBe(true)
  })
})
