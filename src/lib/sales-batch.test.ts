import {describe,expect,it} from 'vitest'
import {classifyClientMatches,missingShippingFields,parseDaviSalesBatch} from '../../supabase/functions/_shared/sales-batch-domain'

const example=`Fève Nectar — Place de la Rêverie
(Frasco 1)
▪️ Cotação: R$ 46,90/ml (+ R$ 9,00 recravação)
▪️ APC: 25ml + R$ 50,00 (Frasco original com 50ml)
📦 Disponibilidade para envio: até 04/09 (15 dias úteis)
🚨 03mls disponíveis. 🚨
03ml: R$ 149,70
05ml: R$ 243,50
08ml: R$ 384,20
10ml: R$ 478,00
12ml: R$ 571,80
15ml: R$ 712,50
APC : R$ 1.222,50
APC: Tatiana Carvalho
03ml: Luciana Alves
03ml: Mariana ZTB
05ml: Melani Nunes
03ml: Claudia Fernanda
05ml: Fernanda VT
03ml: Endrigo Rodrigues`

describe('parser determinístico da lista do Davi',()=>{
  const parsed=parseDaviSalesBatch(example)
  it('extrai metadados comerciais',()=>expect(parsed).toMatchObject({perfume:'Fève Nectar — Place de la Rêverie',bottle_number:1,original_volume_ml:50,quote_per_ml:46.9,recrimping_fee:9,apc_volume_ml:25,apc_extra:50,deadline_day_month:'04/09',business_days:15,announced_balance_ml:3}))
  it('extrai as sete vendas e nomes sem confundir tabela de preços',()=>expect(parsed.sales.map(x=>x.client_name)).toEqual(['Tatiana Carvalho','Luciana Alves','Mariana ZTB','Melani Nunes','Claudia Fernanda','Fernanda VT','Endrigo Rodrigues']))
  it('confere 47 ml, saldo 3 ml e R$ 2.308,30',()=>expect(parsed.totals).toEqual({sales:7,volume_ml:47,amount:2308.3,calculated_balance_ml:3,volume_consistent:true}))
  it('não transforma saldo anunciado em estoque inicial',()=>expect(parsed.original_volume_ml).toBe(50))
})

describe('enriquecimento determinístico de clientes',()=>{
  const complete={id:'1',name:'Luciana Alves',cpf:'1',phone:'2',postal_code:'3',address_line:'Rua',address_number:'4',district:'Centro',city:'SP',state:'SP'}
  it('reaproveita match exato único e cadastro completo',()=>{expect(classifyClientMatches('Luciana Alves',[complete]).status).toBe('found');expect(missingShippingFields(complete)).toEqual([])})
  it.each([['cpf','CPF'],['phone','telefone'],['address_line','endereço']])('sinaliza ausência de %s sem inventar dado',(field,label)=>expect(missingShippingFields({...complete,[field]:null})).toContain(label))
  it('classifica cliente novo sem fusão automática',()=>expect(classifyClientMatches('Mariana ZTB',[complete]).status).toBe('new'))
  it('exige humano diante de nome ambíguo',()=>expect(classifyClientMatches('Fernanda',[{name:'Fernanda VT'},{name:'Fernanda Alves'}]).status).toBe('review'))
})
