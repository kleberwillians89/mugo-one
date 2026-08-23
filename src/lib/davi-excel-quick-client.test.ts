import {describe,expect,it} from 'vitest'
import {readFileSync} from 'node:fs'

const grid=readFileSync('src/components/DaviExcelNewRows.tsx','utf8')
const modal=readFileSync('src/components/DaviQuickClientModal.tsx','utf8')
const records=readFileSync('src/lib/records.ts','utf8')
const combo=readFileSync('src/components/ui/EntityCombobox.tsx','utf8')
const sql=readFileSync('supabase/migrations/202608220008_davi_excel_quick_client.sql','utf8')

describe('cadastro rápido de cliente no Davi Excel',()=>{
  it('oferece CTA dentro do autocomplete somente sem correspondência exata',()=>{expect(grid).toContain('CADASTRAR “${query}”');expect(grid).toContain('shouldOfferCreate');expect(grid).toContain('!options.some(option=>exact(query,option.label))');expect(combo).toContain('shouldOfferCreate(query.trim(),options)')})
  it('abre modal compacto com nome preenchido, telefone, email e CPF',()=>{expect(grid).toContain('<DaviQuickClientModal name={quickClient.name}');expect(modal).toContain('NOVA CLIENTE');expect(modal).toContain("useState({name,phone:'',email:'',cpf:''})");expect(modal).toContain('SALVAR CLIENTE');expect(modal).toContain('phoneMask');expect(modal).toContain('cpfMask')})
  it('cria cliente real e devolve id/nome à célula sem salvar venda',()=>{expect(records).toContain("rpc('davi_excel_create_client'");expect(sql).toContain("jsonb_build_object('id',created.id,'name',created.name)");expect(grid).toContain('client:option,clientText:client.name');expect(modal).not.toContain('createSale');expect(sql).not.toContain('insert into public.sales')})
  it('preserva rascunho e devolve o foco para DATA; cancelar volta a CLIENTE',()=>{expect(grid).toContain("focusCell(returnRowId,'date')");expect(grid).toContain("focusCell(returnRowId,'client')");expect(grid).not.toContain('setDrafts([fresh()])')})
  it('detecta duplicidade por nome, telefone, email e CPF e só força nome parecido',()=>{for(const field of ['normalized_name','normalized_phone','normalized_whatsapp','normalized_email','normalized_cpf'])expect(sql).toContain(field);expect(sql).toContain("'force_allowed',not hard_duplicate");expect(modal).toContain('USAR CLIENTE EXISTENTE');expect(modal).toContain('CADASTRAR MESMO ASSIM')})
  it('protege tenant e clients.create no backend e registra autoria/origem canônica',()=>{expect(sql).toContain("has_org_permission(p_organization_id,'clients.create')");expect(sql).toContain('c.organization_id=p_organization_id');expect(sql).toContain("'davi_excel','davi_excel'");expect(sql).toContain('created_by');expect(sql).toContain('uid');expect(records).toContain('Você não tem permissão para cadastrar clientes.')})
  it('não cria Minha RUAH, email, shipment ou venda automaticamente',()=>{for(const forbidden of ['client_accounts','auth.users','functions.invoke','shipments','shipment_items','insert into public.sales']){expect(sql.toLowerCase()).not.toContain(forbidden);expect(modal.toLowerCase()).not.toContain(forbidden)}})
  it('paste oferece cadastro e resolve todas as linhas com o mesmo nome normalizado',()=>{expect(grid).toContain('+ CADASTRAR CLIENTE');expect(grid).toContain('normalizeClient(row.clientText)===normalizeClient(name)');expect(grid).toContain('rowKeys');expect(grid).toContain('keys.has(row.key)')})
  it('não altera o vínculo canônico da venda, que continua exigindo client_id',()=>{expect(grid).toContain('clientId:row.client!.id');expect(grid).toContain("if(!row.client)return");expect(sql).not.toContain('client_name text')})
})
