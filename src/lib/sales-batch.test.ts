import {describe,expect,it} from 'vitest'
import {classifyClientMatches,countSaleCandidateLines,isTabularSalesBatch,missingShippingFields,normalizePerfumeName,parseDaviSalesBatch,perfumeIdentity} from '../../supabase/functions/_shared/sales-batch-domain'

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

describe('formatos reais de WhatsApp',()=>{
  const header=`*Thays — Fueguia 1833*\r\n(Frasco 1)\r\n▪️ Cotação: R$ 46,90/ml\r\n▪️ APC: 25ml + R$ 50,00 (Frasco original com 50ml)\r\n03ml: R$ 149,70\r\n05ml: R$ 243,50\r\nAPC: R$ 1.222,50\r\n`
  it.each(['03ml: Luciana Alves','3ml: Luciana Alves','03 ml: Luciana Alves','3 ml - Luciana Alves','05ML: Melani Nunes','05mls — Melani Nunes'])('reconhece %s',line=>expect(parseDaviSalesBatch(header+line).sales).toHaveLength(1))
  it.each(['APC: Tatiana Carvalho','APC : Tatiana Carvalho','APC - Tatiana Carvalho'])('reconhece %s',line=>expect(parseDaviSalesBatch(header+line).sales[0]).toMatchObject({client_name:'Tatiana Carvalho',sale_type:'APC',volume_ml:25,amount:1222.5}))
  it('remove markdown, bullets, NBSP e caracteres invisíveis sem alterar o nome',()=>{const parsed=parseDaviSalesBatch(`${header}🚨 *03\u00a0ml:\u200b José da Silva* 🚨\n_05ml: Ana Paula D'Ávila_`);expect(parsed.sales.map(x=>x.client_name)).toEqual(['José da Silva',"Ana Paula D'Ávila"])})
  it('não converte tabela de preço em venda',()=>{const parsed=parseDaviSalesBatch(`${header}03ml: R$ 149,70\nAPC: R$ 1.222,50`);expect(parsed.sales).toHaveLength(0);expect(countSaleCandidateLines(`${header}03ml: R$ 149,70\nAPC: R$ 1.222,50`)).toBe(0)})
  it('conta candidatas sem registrar conteúdo sensível',()=>expect(countSaleCandidateLines('🔗 https://exemplo.com\n*03ml: Duda Lazzarini*\nAPC : Fernanda VT')).toBe(2))
})

describe('texto tabular copiado de planilha',()=>{
  const row=(client:string,type:string,ml:number,perfume:string,value:string,status='',method='',paid='')=>[client,'8/13/2026','9/4/2026','',type,String(ml),perfume,value,status,method,paid,''].join('\t')
  const feve=[row('TATIANA CARVALHO','APC',25,'FÈVE NECTAR - PLACE DE LA RÊVERIE','R$ 1.222,50','PAGO','PIX','8/13/2026'),row('LUCIANA ALVES','SPLIT',3,'FÈVE NECTAR - PLACE DE LA RÊVERIE','R$ 149,70'),row('MARIANA ZTB','SPLIT',3,'FÈVE NECTAR - PLACE DE LA RÊVERIE','R$ 149,70','AGUARDANDO'),row('MELANI NUNES','SPLIT',5,'FÈVE NECTAR - PLACE DE LA RÊVERIE','R$ 243,50'),row('CLAUDIA FERNANDA','SPLIT',3,'FÈVE NECTAR - PLACE DE LA RÊVERIE','R$ 149,70'),row('FERNANDA VT','SPLIT',5,'FÈVE NECTAR - PLACE DE LA RÊVERIE','R$ 243,50'),row('ENDRIGO RODRIGUES','SPLIT',3,'FÈVE NECTAR - PLACE DE LA RÊVERIE','R$ 149,70'),row('ERICA FREITAS','SPLIT',3,'FÈVE NECTAR - PLACE DE LA RÊVERIE','R$ 149,70')]
  it('detecta TSV antes do parser livre',()=>expect(isTabularSalesBatch(feve.join('\n'))).toBe(true))
  it('reconhece as oito vendas Fève, datas M/D/YYYY e totais reais',()=>{const parsed=parseDaviSalesBatch(feve.join('\n'));expect(parsed.source_format).toBe('tsv');expect(parsed.sales).toHaveLength(8);expect(parsed.totals).toMatchObject({sales:8,volume_ml:50,amount:2458});expect(parsed.sales[0]).toMatchObject({sale_date:'2026-08-13',shipping_deadline_date:'2026-09-04',payment_status_raw:'PAGO',payment_method_raw:'PIX'})})
  it('agrupa múltiplos perfumes sem deduplicar clientes repetidos',()=>{const parsed=parseDaviSalesBatch([...feve,row('LUCIANA ALVES','SPLIT',4,'BLOCKADE - MIND GAMES','R$ 200,00'),row('ANA PAULA','SPLIT',2,'BLONDE AMBER - CLIVE CHRISTIAN','R$ 99,90')].join('\n'));expect(parsed.groups?.map(group=>group.perfume)).toEqual(['BLOCKADE - MIND GAMES','BLONDE AMBER - CLIVE CHRISTIAN','FÈVE NECTAR - PLACE DE LA RÊVERIE']);expect(parsed.sales).toHaveLength(10)})
  it('preserva identidade, marca e frasco separadamente',()=>{const parsed=parseDaviSalesBatch(row('BEATRIZ','APC',50,'BLOCKADE - MIND GAMES (FRASCO 2)','R$ 2.000,00'));expect(parsed.groups?.[0]).toMatchObject({raw_perfume_name:'BLOCKADE - MIND GAMES (FRASCO 2)',display_name:'BLOCKADE - MIND GAMES',normalized_perfume_name:'blockade mind games',brand:'MIND GAMES',bottle_number:2})})
  it('ignora disponibilidade comercial e tabs finais',()=>{const parsed=parseDaviSalesBatch([...feve,row('DISPONÍVEL PARA VENDA','SPLIT',11,'QUILOMBO - FUEGUIA 1833','R$ 447,90')].join('\n'));expect(parsed.sales).toHaveLength(8);expect(parsed.availability_rows).toBe(1)})
  it('não cria cliente nem venda para "disponível para venda", mas preserva ml e valor reais para o resumo',()=>{
    const parsed=parseDaviSalesBatch([...feve,row('DISPONÍVEL PARA VENDA','SPLIT',11,'FÈVE NECTAR - PLACE DE LA RÊVERIE','R$ 447,90')].join('\n'))
    expect(parsed.sales.some(s=>s.client_name==='DISPONÍVEL PARA VENDA')).toBe(false)
    expect(parsed.availability_ml).toBe(11);expect(parsed.availability_amount).toBe(447.9)
    const feveGroup=parsed.groups?.find(g=>g.perfume==='FÈVE NECTAR - PLACE DE LA RÊVERIE')
    expect(feveGroup).toMatchObject({availability_rows:1,availability_ml:11,availability_amount:447.9,totals:{sales:8,volume_ml:50,amount:2458}})
  })
  it('soma disponibilidade comercial real: 162 vendas + saldo separado bate com a lista completa',()=>{
    const rows=Array.from({length:162},(_,i)=>row(`CLIENTE ${i+1}`,i%2===0?'SPLIT':'APC',3,'FÈVE NECTAR - PLACE DE LA RÊVERIE',(256.22).toFixed(2).replace('.',',')))
    const parsed=parseDaviSalesBatch([...rows,row('DISPONÍVEL PARA VENDA','SPLIT',37,'FÈVE NECTAR - PLACE DE LA RÊVERIE','1185,30')].join('\n'))
    expect(parsed.sales).toHaveLength(162)
    expect(parsed.availability_ml).toBe(37);expect(parsed.availability_amount).toBe(1185.3)
    const grossTotal=Math.round((parsed.totals.amount+(parsed.availability_amount??0))*100)/100
    expect(grossTotal).toBe(Math.round((parsed.totals.amount+1185.3)*100)/100)
  })
  it('ignora cabeçalho e linha sem campos mínimos',()=>{const parsed=parseDaviSalesBatch(['CLIENTE\tVENDA\tPRAZO\t\tTIPO\tML\tPERFUME\tVALOR',...feve,'TOTAL\t\t\t\t\t50\t\tR$ 2.458,00'].join('\n'));expect(parsed.sales).toHaveLength(8)})
})

describe('normalização segura de perfumes',()=>{
  it.each([['FÈVE NECTAR - PLACE DE LA RÊVERIE','Fève Nectar — Place de la Rêverie'],['THAYS - FUEGUIA 1833','thays  —  fueguia 1833'],['BLOCKADE - MIND GAMES (FRASCO 2)','blockade mind games']])('equipara %s', (left,right)=>expect(normalizePerfumeName(left)).toBe(normalizePerfumeName(right)))
  it('não perde o nome reconhecido',()=>expect(perfumeIdentity('  CÈDRE  FIGALIA - ATELIER MATERI  ')).toMatchObject({raw_perfume_name:'CÈDRE FIGALIA - ATELIER MATERI',display_name:'CÈDRE FIGALIA - ATELIER MATERI',brand:'ATELIER MATERI'}))
})

describe('enriquecimento determinístico de clientes',()=>{
  const complete={id:'1',name:'Luciana Alves',cpf:'1',phone:'2',postal_code:'3',address_line:'Rua',address_number:'4',district:'Centro',city:'SP',state:'SP'}
  it('reaproveita match exato único e cadastro completo',()=>{expect(classifyClientMatches('Luciana Alves',[complete]).status).toBe('found');expect(missingShippingFields(complete)).toEqual([])})
  it.each([['cpf','CPF'],['phone','telefone'],['address_line','endereço']])('sinaliza ausência de %s sem inventar dado',(field,label)=>expect(missingShippingFields({...complete,[field]:null})).toContain(label))
  it('classifica cliente novo sem fusão automática',()=>expect(classifyClientMatches('Mariana ZTB',[complete]).status).toBe('new'))
  it('exige humano diante de nome ambíguo',()=>expect(classifyClientMatches('Fernanda',[{name:'Fernanda VT'},{name:'Fernanda Alves'}]).status).toBe('review'))
})
