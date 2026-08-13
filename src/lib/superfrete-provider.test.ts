import {describe,expect,it} from 'vitest'
import {normalizeQuote,safeProviderError} from '../../supabase/functions/_shared/superfrete-domain'

const httpError=(status:number)=>Object.assign(new Error(`http ${status}`),{status})
describe('classificação segura de falhas do provedor',()=>{
  it('timeout é incerto e impede retry de compra',()=>{const error=safeProviderError(new DOMException('timeout','AbortError'));expect(error.uncertain).toBe(true);expect(error.code).toBe('SUPERFRETE_TIMEOUT')})
  it('5xx é incerto porque a operação pode ter sido processada',()=>expect(safeProviderError(httpError(503)).uncertain).toBe(true))
  it('falha de rede sem resposta é incerta',()=>expect(safeProviderError(new TypeError('network'))).toMatchObject({uncertain:true,code:'SUPERFRETE_NETWORK_ERROR'}))
  it('4xx de validação permite correção sem assumir compra',()=>expect(safeProviderError(httpError(422))).toMatchObject({uncertain:false,code:'SUPERFRETE_HTTP_422'}))
  it('autenticação não inclui detalhes do provedor',()=>expect(safeProviderError(httpError(401))).toMatchObject({uncertain:false,code:'SUPERFRETE_AUTH'}))
  it('rate limit gera erro seguro e permite nova tentativa posterior',()=>expect(safeProviderError(httpError(429))).toMatchObject({uncertain:false,code:'SUPERFRETE_RATE_LIMIT'}))
  it('serviço indisponível não pode ser selecionado',()=>expect(normalizeQuote({id:1,name:'PAC',price:'0',has_error:true})).toMatchObject({available:false,safe_error:'Serviço indisponível para este pacote.'}))
  it('normaliza cotação válida com transportadora e prazo',()=>expect(normalizeQuote({id:1,name:'PAC',price:'25.50',delivery_time:5,company:{name:'Correios'}})).toMatchObject({service_id:'1',price:25.5,delivery_days:5,carrier:'Correios',available:true}))
})
