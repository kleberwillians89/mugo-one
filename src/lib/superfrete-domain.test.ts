import {describe,expect,it} from 'vitest'
import {checkoutPayload,emissionAction,mapSuperFreteStatus,providerValidation,validDocument,validPhone} from '../../supabase/functions/_shared/superfrete-domain'

describe('orquestração idempotente SuperFrete',()=>{
  it('cria carrinho somente sem pedido existente',()=>expect(emissionAction(null,null)).toBe('create_cart'))
  it('continua checkout do carrinho já persistido sem recriar cart',()=>expect(emissionAction('order-1','cart_created')).toBe('checkout_existing'))
  it('sincroniza pedido já liberado em vez de comprar novamente',()=>expect(emissionAction('order-1','released')).toBe('sync_existing'))
  it.each(['cart_uncertain','checkout_uncertain','checkout_started'])('bloqueia retry automático em %s',(status)=>expect(emissionAction('order-1',status)).toBe('blocked_uncertain'))
  it('constrói checkout apenas com o pedido persistido',()=>expect(checkoutPayload('order-1')).toEqual({orders:['order-1']}))
  it('recusa checkout sem pedido',()=>expect(()=>checkoutPayload('')).toThrow('order_id_required'))
})

describe('validação forte antes da emissão',()=>{
  it('valida CPF e CNPJ e rejeita sequências',()=>{expect(validDocument('529.982.247-25')).toBe(true);expect(validDocument('04.252.011/0001-10')).toBe(true);expect(validDocument('111.111.111-11')).toBe(false);expect(validDocument('123')).toBe(false)})
  it('valida telefone com DDD',()=>{expect(validPhone('(11) 99999-9999')).toBe(true);expect(validPhone('9999')).toBe(false)})
  it('preserva mensagem e erros estruturados do provedor',()=>expect(providerValidation({message:'Bairro obrigatório',errors:{'to.district':['required']}})).toEqual({message:'Bairro obrigatório',validation_errors:{'to.district':['required']}}))
})

describe('mapeamento de status externo',()=>{
  it.each([['pending','unchanged'],['released','label_released'],['posted','posted'],['delivered','delivered'],['cancelled','cancelled'],['canceled','cancelled']])('%s → %s',(external,internal)=>expect(mapSuperFreteStatus(external)).toBe(internal))
  it('mantém status desconhecido isolado do frontend',()=>expect(mapSuperFreteStatus('future_status')).toBe('unchanged'))
})
