import {describe,expect,it} from 'vitest'
import {readFileSync} from 'node:fs'

const read=(path:string)=>readFileSync(path,'utf8')
const focusTrap=read('src/components/ui/hooks/useFocusTrap.ts')
const custody=read('supabase/migrations/202608230002_custody_original_quantity.sql')
const sale=read('src/pages/SaleDetailsPage.tsx')
const publicUrl=read('supabase/functions/_shared/public-app-url.ts')
const invite=read('supabase/functions/customer-account-invite/index.ts')
const registration=read('supabase/functions/customer-registration-start/index.ts')
const claim=read('supabase/functions/customer-claim-start/index.ts')
const recovery=read('src/portal/CustomerPortalRoot.tsx')

describe('estabilidade dos inputs operacionais',()=>{
  it('não reinicializa o focus trap quando callbacks inline mudam durante a digitação',()=>{
    expect(focusTrap).toContain('const onCloseRef = useRef(onClose)')
    expect(focusTrap).toContain('onCloseRef.current = onClose')
    expect(focusTrap).toContain('onCloseRef.current()')
    expect(focusTrap).toContain('}, [active, containerRef])')
    expect(focusTrap).not.toContain('setTimeout')
  })
})

describe('custódia manual após original_quantity_ml obrigatório',()=>{
  it('grava quantidade atual e original com o mesmo volume inicial válido',()=>{
    expect(custody).toContain('quantity_ml,original_quantity_ml,status')
    expect(custody).toContain('v_sale.volume_ml,v_sale.volume_ml')
    expect(custody).not.toMatch(/original_quantity_ml[^\n]*default|original_quantity_ml[^\n]*\b0\b/)
  })
  it('preserva idempotência, tenant, confirmação humana e auditoria',()=>{
    expect(custody).toContain('where id=p_sale_id and deleted_at is null')
    expect(custody).toContain('for update')
    expect(custody).toContain("status in('reserved','shipping','shipped')")
    expect(custody).toContain("raise exception 'product_already_confirmed_for_shipping'")
    expect(custody).toContain("has_org_role(v_sale.organization_id")
    expect(custody).toContain("'legacy_custody_confirmed'")
    expect(custody).toContain("'stock_managed',false")
  })
  it('não movimenta estoque físico nem inicia logística',()=>{
    for(const forbidden of ['update public.inventory_items','physical_ml','insert into public.shipments','post_shipment','superfrete','checkout'])expect(custody.toLowerCase()).not.toContain(forbidden)
  })
  it('mantém Venda 360 renderizada e não expõe erro SQL da confirmação',()=>{
    expect(sale).toContain('[loadError,setLoadError]')
    expect(sale).toContain('[operationError,setOperationError]')
    expect(sale).toContain('Não foi possível confirmar a custódia. Nenhuma alteração foi realizada. Tente novamente.')
    expect(sale).not.toContain("catch(reason){setError(reason instanceof Error?reason.message:'Não foi possível confirmar o produto.')")
  })
})

describe('URL pública consistente entre os fluxos Minha RUAH',()=>{
  it('invite, reinvite e first access usam o mesmo resolver canônico',()=>{
    for(const source of [invite,registration,claim])expect(source).toContain('firstAccessRedirectUrl()')
    expect(publicUrl).toContain("DEPLOYED_PUBLIC_APP_URL='https://crm.ruahparfums.com.br'")
    expect(publicUrl).toContain("raw===LEGACY_INVALID_PUBLIC_APP_URL?DEPLOYED_PUBLIC_APP_URL:raw")
    expect(publicUrl).toContain('[DEPLOYED_PUBLIC_APP_URL,VERCEL_PUBLIC_APP_URL].includes(url.origin)')
  })
  it('recovery permanece baseado na origem correta que abriu o frontend',()=>{
    expect(recovery).toContain('redirectTo:`${location.origin}/minha-ruah/redefinir-senha`')
  })
  it('nenhum gerador ou template contém o hostname inválido como destino literal',()=>{
    for(const source of [publicUrl,invite,registration,claim,read('supabase/functions/_shared/customer-invite.ts')])expect(source).not.toContain('https://crmruahparfums.com.br')
  })
})
