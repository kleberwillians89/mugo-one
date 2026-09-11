import {describe,expect,it} from 'vitest'
import {canBuyLabel,canQuoteShipment,getLabelUiState,getShipmentNextAction,missingLabelFields,missingQuoteFields,shipmentHumanState,shipmentStatusLabels,type ShipmentActionState} from './superfrete'

const complete={recipient_name:'Maria',recipient_document:'12345678901',recipient_email:'maria@example.test',recipient_phone:'11999999999',recipient_postal_code:'01001-000',recipient_address:'Rua A',recipient_number:'10',recipient_district:'Centro',recipient_city:'São Paulo',recipient_state:'SP',package_weight:0.4,package_height:10,package_width:12,package_length:18,service_id:'1'}
describe('regras SuperFrete no CRM',()=>{
  it('permite cotação apenas antes da seleção',()=>{expect(canQuoteShipment('draft')).toBe(true);expect(canQuoteShipment('awaiting_customer_approval')).toBe(false)})
  it('cotação exige CEP e dimensões, mas não CPF',()=>{expect(missingQuoteFields({...complete,recipient_document:''})).toEqual([]);expect(missingQuoteFields({...complete,recipient_postal_code:'1'})).toContain('CEP do destinatário')})
  it('emissão bloqueia CPF, endereço, CEP e contato ausentes',()=>{const missing=missingLabelFields({...complete,recipient_document:'',recipient_address:'',recipient_phone:'',recipient_postal_code:''});expect(missing).toEqual(expect.arrayContaining(['CPF/CNPJ','endereço','telefone','CEP do destinatário']))})
  it('somente aprovado e completo pode comprar',()=>{expect(canBuyLabel('customer_approved',[])).toBe(true);expect(canBuyLabel('customer_approved',['CPF/CNPJ'])).toBe(false);expect(canBuyLabel('awaiting_customer_approval',[])).toBe(false)})
  it('não expõe strings externas como rótulo operacional',()=>{expect(shipmentStatusLabels.label_released).toBe('Pronto para postar');expect(shipmentStatusLabels.released).toBeUndefined()})
})

describe('próxima ação única da etiqueta',()=>{
  const state=(value:Partial<ShipmentActionState>={}):ShipmentActionState=>({status:'label_pending',superfrete_order_id:'order-1',superfrete_status:'pending',checkout_status:null,print_available:false,print_url:null,label_pdf_url:null,tracking_code:null,...value})
  it('não confunde carrinho pendente com processamento',()=>{const shipment=state({checkout_status:'cart_created',print_url:'https://etiqueta.superfrete.com/antiga'});expect(getShipmentNextAction(shipment)).toBe('checkout');expect(shipmentHumanState(shipment)).toBe('Etiqueta aguardando pagamento')})
  it('sincroniza pedido pago pendente sem criar outro carrinho',()=>expect(getShipmentNextAction(state({checkout_status:'checkout_completed'}))).toBe('sync'))
  it('só imprime status liberado com URL validada',()=>{expect(getShipmentNextAction(state({superfrete_status:'released',print_url:'https://etiqueta.superfrete.com/a.pdf'}))).toBe('sync');expect(getShipmentNextAction(state({superfrete_status:'released',print_url:'https://etiqueta.superfrete.com/a.pdf',print_available:true}))).toBe('print')})
  it('usa rastreio como ação depois da postagem',()=>expect(getShipmentNextAction(state({status:'posted',superfrete_status:'posted',tracking_code:'BR123'}))).toBe('track'))
  it('exige aprovação do time antes de permitir criar etiqueta',()=>expect(getShipmentNextAction(state({status:'awaiting_customer_approval'}))).toBe('approve_team'))
  it('cria pedido somente quando ainda não existe order id',()=>expect(getShipmentNextAction(state({status:'customer_approved',superfrete_order_id:null,superfrete_status:null}))).toBe('create_label'))
  it('mantém copiar rastreio independente do PDF',()=>{const ui=getLabelUiState(state({superfrete_status:'released',tracking_code:'SLG123',print_available:false,print_url:'https://etiqueta.superfrete.com/a.pdf'}));expect(ui).toMatchObject({canSync:true,canPrint:false,canCopyTracking:true,primaryAction:'sync'})})
  it('habilita impressão somente com status, URL e disponibilidade',()=>{expect(getLabelUiState(state({superfrete_status:'released',print_available:true,print_url:null})).canPrint).toBe(false);expect(getLabelUiState(state({superfrete_status:'released',print_available:true,print_url:'https://etiqueta.superfrete.com/a.pdf'})).canPrint).toBe(true)})
  it('mantém sincronização como ação principal com rastreio sem PDF',()=>expect(getLabelUiState(state({superfrete_status:'released',tracking_code:'SLG123',print_available:false}))).toMatchObject({primaryAction:'sync',canCopyTracking:true,canPrint:false}))
  it('permite PDF pronto mesmo antes do rastreio ser propagado',()=>expect(getLabelUiState(state({superfrete_status:'released',print_available:true,print_url:'https://etiqueta.superfrete.com/a.pdf'}))).toMatchObject({primaryAction:'print',canCopyTracking:false,canPrint:true}))
  it.each(['canceled','cancelled','cancelado','cancelada'])('prioriza etiqueta cancelada (%s) sobre checkout, rastreio e arquivo pendente',(superfrete_status)=>{const ui=getLabelUiState(state({superfrete_status,checkout_status:'released',print_available:false,print_url:null,label_pdf_url:null,tracking_code:'SLGELOHB123'}));expect(ui).toMatchObject({title:'ETIQUETA CANCELADA',isCancelled:true,primaryAction:'none',canSync:false,canPrint:false,canCopyTracking:true});expect(ui.description).not.toContain('preparad')})
})
