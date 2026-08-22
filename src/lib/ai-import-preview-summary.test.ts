import {describe,expect,it} from 'vitest'
import {readFileSync} from 'node:fs'
import {buildAiImportPreviewSummary} from './ai-import-preview-summary'
import type {AiSalesBatchPreview,AiSalesBatchSale} from './records'

const sale=(client:string,clientId:string|null,perfume:string,ml:number,amount:number,extra:Partial<AiSalesBatchSale>={}):AiSalesBatchSale=>({client_name:client,client_id:clientId,perfume_name:perfume,sale_type:'SPLIT',volume_ml:ml,amount,client_match_status:clientId?'found':'new',client:null,suggestions:[],missing_shipping_fields:[],possible_duplicate:false,...extra})
const preview=(sales:AiSalesBatchSale[]):AiSalesBatchPreview=>({source_format:'tsv',perfume:'Lote',bottle_number:null,original_volume_ml:null,quote_per_ml:null,recrimping_fee:null,apc_volume_ml:null,apc_extra:null,deadline_raw:null,deadline_day_month:null,shipping_deadline_date:null,business_days:null,announced_balance_ml:null,sale_date:'2026-08-22',fingerprint:'batch',duplicate_batch:null,perfume_match_status:'found',perfume_id:null,inventory_item_id:null,perfume_matches:[],inventory:null,sales,totals:{sales:sales.length,volume_ml:0,amount:0,calculated_balance_ml:null,volume_consistent:true},summary:{clients:0,found:0,new:0,review:0,shipping_ready:0,shipping_incomplete:0},raw_text:'',groups:[{perfume:'Balenciaga',raw_perfume_name:'Balenciaga',normalized_perfume_name:'balenciaga',display_name:'Balenciaga',brand:null,bottle_number:null,inventory_item_id:'item-a',perfume_id:'perfume-a',perfume_match_status:'found',perfume_matches:[],inventory:{perfume:'Balenciaga'},sales:[],availability_rows:0,totals:{sales:0,volume_ml:0,amount:0}},{perfume:'Delina',raw_perfume_name:'Delina',normalized_perfume_name:'delina',display_name:'Delina',brand:null,bottle_number:null,inventory_item_id:'item-b',perfume_id:'perfume-b',perfume_match_status:'found',perfume_matches:[],inventory:{perfume:'Delina'},sales:[],availability_rows:0,totals:{sales:0,volume_ml:0,amount:0}}]})

const nine=[
  sale('Julia Castro','c1','Balenciaga',3,203.7),sale('Mariana ZTB','c2','Balenciaga',3,203.7),sale('Daniela Toledo','c3','Balenciaga',3,203.7),
  sale('Fernanda','c4','Balenciaga',5,250),sale('Fernanda','c4','Delina',5,250),sale('Ana','c5','Delina',2,180),sale('Bia','c6','Delina',2,180),sale('Caio','c7','Delina',2,180),sale('Julia C.','c1','Delina',2,179.2),
]

describe('resumo de conferência da importação',()=>{
  const summary=buildAiImportPreviewSummary(preview(nine))
  it('A: 9 linhas válidas produzem 9 vendas',()=>expect(summary.sales).toBe(9))
  it('B/E: 9 vendas para 7 IDs canônicos contam 7 clientes únicos',()=>expect(summary.clients).toBe(7))
  it('C: soma o volume de todas as vendas do batch',()=>expect(summary.volumeMl).toBe(27))
  it('D: soma o campo financeiro canônico amount',()=>expect(summary.amount).toBe(1830.3))
  it('F: agrupa vendas, ml e valor por cliente',()=>expect(summary.byClient.find(item=>item.key==='id:c4')).toMatchObject({label:'Fernanda',sales:2,volumeMl:10,amount:500}))
  it('G: agrupa apenas perfumes resolvidos',()=>{expect(summary.byPerfume).toHaveLength(2);expect(summary.byPerfume.find(item=>item.key==='id:perfume-a')).toMatchObject({sales:4,volumeMl:14,amount:861.1})})
  it('H: linhas marcadas como não importáveis não contaminam nenhum total',()=>{const withInvalid=preview([...nine,sale('Inválida',null,'Delina',999,99999,{is_importable:false})]);expect(buildAiImportPreviewSummary(withInvalid)).toMatchObject({sales:9,clients:7,volumeMl:27,amount:1830.3})})
  it('prefere e-mail/CPF normalizados a nome quando ainda não existe client_id',()=>{const rows=[sale('Nome A',null,'Delina',1,10,{client_email:'CLIENTE@EMAIL.COM'}),sale('Nome diferente',null,'Delina',1,10,{client_email:'cliente@email.com'})];expect(buildAiImportPreviewSummary(preview(rows)).clients).toBe(1)})
  it('não inventa número de pedido quando a fonte não fornece um',()=>{expect(summary.orders[0].label).toBe('Venda 01');const numbered=buildAiImportPreviewSummary(preview([sale('A','1','Delina',1,10,{order_number:'1234'})]));expect(numbered.orders[0].label).toBe('Pedido #1234')})
})

describe('segurança operacional da revisão',()=>{
  const component=readFileSync('src/components/AiSalesBatchImport.tsx','utf8'),css=readFileSync('src/enhancements.css','utf8')
  it('I: pendências continuam bloqueando o botão de confirmação',()=>expect(component).toContain('disabled={!!busy||blockers.length>0}'))
  it('J: o preview não cria shipment, remessa ou etiqueta',()=>expect(component).not.toMatch(/createShipment|confirmShipment|createLabel|superfrete/i))
  it('K: o preview não aplica baixa ou ajuste de estoque',()=>expect(component).not.toMatch(/adjustInventory|inventory_apply|physical_ml\s*[-+]=/i))
  it('L: mobile 390 usa cards sem overflow horizontal',()=>{expect(css).toContain('@media(max-width:390px)');expect(css).toContain('.batch-review-metrics');expect(css).toContain('grid-template-columns:1fr');expect(css).not.toMatch(/\.batch-review-(?:card-list|metrics)[^{]*\{[^}]*min-width:\s*\d{3,}px/)})
})
