import {describe,expect,it} from 'vitest'
import {checkoutPayload,emissionAction,mapSuperFreteStatus} from '../../supabase/functions/_shared/superfrete-domain'

describe('orquestração idempotente SuperFrete',()=>{
  it('cria carrinho somente sem pedido existente',()=>expect(emissionAction(null,null)).toBe('create_cart'))
  it('continua checkout do carrinho já persistido sem recriar cart',()=>expect(emissionAction('order-1','cart_created')).toBe('checkout_existing'))
  it('sincroniza pedido já liberado em vez de comprar novamente',()=>expect(emissionAction('order-1','released')).toBe('sync_existing'))
  it.each(['cart_uncertain','checkout_uncertain','checkout_started'])('bloqueia retry automático em %s',(status)=>expect(emissionAction('order-1',status)).toBe('blocked_uncertain'))
  it('constrói checkout apenas com o pedido persistido',()=>expect(checkoutPayload('order-1')).toEqual({orders:['order-1']}))
  it('recusa checkout sem pedido',()=>expect(()=>checkoutPayload('')).toThrow('order_id_required'))
})

describe('mapeamento de status externo',()=>{
  it.each([['pending','unchanged'],['released','label_released'],['posted','posted'],['delivered','delivered'],['cancelled','cancelled'],['canceled','cancelled']])('%s → %s',(external,internal)=>expect(mapSuperFreteStatus(external)).toBe(internal))
  it('mantém status desconhecido isolado do frontend',()=>expect(mapSuperFreteStatus('future_status')).toBe('unchanged'))
})
