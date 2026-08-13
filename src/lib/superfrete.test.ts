import {describe,expect,it} from 'vitest'
import {canBuyLabel,canQuoteShipment,missingLabelFields,missingQuoteFields,shipmentStatusLabels} from './superfrete'

const complete={recipient_name:'Maria',recipient_document:'12345678901',recipient_email:'maria@example.test',recipient_phone:'11999999999',recipient_postal_code:'01001-000',recipient_address:'Rua A',recipient_number:'10',recipient_district:'Centro',recipient_city:'São Paulo',recipient_state:'SP',package_weight:0.4,package_height:10,package_width:12,package_length:18,service_id:'1'}
describe('regras SuperFrete no CRM',()=>{
  it('permite cotação apenas antes da seleção',()=>{expect(canQuoteShipment('draft')).toBe(true);expect(canQuoteShipment('awaiting_customer_approval')).toBe(false)})
  it('cotação exige CEP e dimensões, mas não CPF',()=>{expect(missingQuoteFields({...complete,recipient_document:''})).toEqual([]);expect(missingQuoteFields({...complete,recipient_postal_code:'1'})).toContain('CEP do destinatário')})
  it('emissão bloqueia CPF, endereço, CEP e contato ausentes',()=>{const missing=missingLabelFields({...complete,recipient_document:'',recipient_address:'',recipient_phone:'',recipient_postal_code:''});expect(missing).toEqual(expect.arrayContaining(['CPF/CNPJ','endereço','telefone','CEP do destinatário']))})
  it('somente aprovado e completo pode comprar',()=>{expect(canBuyLabel('customer_approved',[])).toBe(true);expect(canBuyLabel('customer_approved',['CPF/CNPJ'])).toBe(false);expect(canBuyLabel('awaiting_customer_approval',[])).toBe(false)})
  it('não expõe strings externas como rótulo operacional',()=>{expect(shipmentStatusLabels.label_released).toBe('Pronto para postar');expect(shipmentStatusLabels.released).toBeUndefined()})
})
