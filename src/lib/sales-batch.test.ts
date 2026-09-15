import {describe,expect,it} from 'vitest'
import {classifyClientMatches,countSaleCandidateLines,isTabularSalesBatch,missingShippingFields,normalizePerfumeName,parseDaviSalesBatch,parseShippingAvailability,perfumeIdentity} from '../../supabase/functions/_shared/sales-batch-domain'

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

describe('disponibilidade determinística',()=>{
  it('interpreta previsão sem inventar confirmação física',()=>expect(parseShippingAvailability('Disponibilidade para envio: até 11/09 (15 dias úteis)','2026-08-22')).toEqual({shipping_availability_text:'até 11/09 (15 dias úteis)',shipping_availability_kind:'expected_by_date',shipping_available_date:'2026-09-11',shipping_lead_business_days:15,shipping_availability_review_required:false}))
  it('interpreta pronta entrega, início e dias úteis',()=>{expect(parseShippingAvailability('Disponibilidade para envio: pronta entrega','2026-08-22').shipping_availability_kind).toBe('available_now');expect(parseShippingAvailability('Envio a partir de 11/09','2026-08-22')).toMatchObject({shipping_availability_kind:'available_from_date',shipping_available_date:'2026-09-11'});expect(parseShippingAvailability('Disponível em 5 dias úteis','2026-08-21')).toMatchObject({shipping_availability_kind:'lead_time',shipping_available_date:'2026-08-28'})})
  it('manda data passada incoerente para revisão sem trocar ano',()=>expect(parseShippingAvailability('Disponibilidade para envio: até 11/07','2026-08-22')).toMatchObject({shipping_available_date:null,shipping_availability_review_required:true}))
})

describe('parser determinístico da lista do Davi',()=>{
  const parsed=parseDaviSalesBatch(example)
  it('extrai metadados comerciais',()=>expect(parsed).toMatchObject({perfume:'Fève Nectar — Place de la Rêverie',bottle_number:1,original_volume_ml:50,quote_per_ml:46.9,recrimping_fee:9,apc_volume_ml:25,apc_extra:50,deadline_day_month:'04/09',business_days:15,announced_balance_ml:3}))
  it('extrai as sete vendas e nomes sem confundir tabela de preços',()=>expect(parsed.sales.map(x=>x.client_name)).toEqual(['Tatiana Carvalho','Luciana Alves','Mariana ZTB','Melani Nunes','Claudia Fernanda','Fernanda VT','Endrigo Rodrigues']))
  it('confere 47 ml, saldo 3 ml e R$ 2.308,30',()=>expect(parsed.totals).toEqual({sales:7,volume_ml:47,amount:2308.3,calculated_balance_ml:3,total_operation_ml:50,volume_consistent:true}))
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

describe('LA CAUTIVA — formato operacional com frasco sem parênteses',()=>{
  const laCautiva=`LA CAUTIVA — FUEGUIA 1833
Frasco 1.

▪️ Cotação: R$ 35,90/ml (+ R$ 9,00 recravação)
▪️ APC: 50ml + R$ 50,00 (frasco original de 100ml)
📦 Liberação para envio: a partir de 14/09 (prazo estimado: 05 dias úteis)
💳 Parcelamento em até 6x sem juros.

🚨 FRASCO FECHADO. 🚨
03ml — R$ 116,70
05ml — R$ 188,50
08ml — R$ 296,20
10ml — R$ 368,00
12ml — R$ 439,80
15ml — R$ 547,50
APC — R$ 1.845,00

50ml: Vi Coimbra
03ml: Erica Freitas
03ml: Aline Rangel
08ml: Tatiana Carvalho
03ml: Luciana Alves
03ml: Jenni
05ml: Elaine Sampaio
03ml: Fernanda Abreu
03ml: Fernanda VT
03ml: Cecilia Dutra
03ml: Mariana ZTB
03ml: Viviane Messias
05ml: Larissa Simões
03ml: Isadora Rodrigues
02ml: Rilly Andretta`
  it('reconhece frasco, capacidade, prazo e todas as vendas',()=>expect(parseDaviSalesBatch(laCautiva)).toMatchObject({perfume:'LA CAUTIVA — FUEGUIA 1833',bottle_number:1,original_volume_ml:100,business_days:5,pricing_consistent:true,pricing_issues:[],totals:{sales:15,volume_ml:100,amount:3766,calculated_balance_ml:0,volume_consistent:true}}))
  it('classifica 50ml como APC e soma exatamente os R$ 50 adicionais',()=>expect(parseDaviSalesBatch(laCautiva).sales[0]).toMatchObject({client_name:'Vi Coimbra',sale_type:'APC',volume_ml:50,amount:1845}))
  it('calcula tamanho sem preço publicado com cotação mais recravação',()=>expect(parseDaviSalesBatch(laCautiva).sales.at(-1)).toMatchObject({client_name:'Rilly Andretta',sale_type:'SPLIT',volume_ml:2,amount:80.8}))
  it('calcula os 6 ml restantes mesmo que esse tamanho não esteja no anúncio',()=>expect(parseDaviSalesBatch(`${laCautiva}\n06ml: Cliente do restante`).sales.at(-1)).toMatchObject({client_name:'Cliente do restante',sale_type:'SPLIT',volume_ml:6,amount:224.4}))
  it.each(['Cotação R$ 35,90/ml','Cotação — R$ 35,90 por ml','Valor do ML: R$ 35,90'])('reconhece a cotação escrita como “%s”',label=>expect(parseDaviSalesBatch(laCautiva.replace('Cotação: R$ 35,90/ml',label)).quote_per_ml).toBe(35.9))
  it.each([1,2,14])('reconhece Frasco %s sem misturar a identidade do perfume',bottle=>expect(parseDaviSalesBatch(laCautiva.replace('Frasco 1.',`Frasco ${bottle}.`)).bottle_number).toBe(bottle))
  it('recusa dois números de frasco diferentes na mesma mensagem',()=>expect(()=>parseDaviSalesBatch(`${laCautiva}\nFrasco 2.`)).toThrow('multiple_bottle_numbers'))
  it('aponta divergência no APC quando os R$ 50 não foram somados',()=>{const parsed=parseDaviSalesBatch(laCautiva.replace('APC — R$ 1.845,00','APC — R$ 1.795,00'));expect(parsed.pricing_consistent).toBe(false);expect(parsed.pricing_issues).toContainEqual({sale_type:'APC',volume_ml:50,announced_amount:1795,expected_amount:1845})})
  it('aponta divergência em qualquer tamanho de SPLIT',()=>{const parsed=parseDaviSalesBatch(laCautiva.replace('03ml — R$ 116,70','03ml — R$ 107,70'));expect(parsed.pricing_consistent).toBe(false);expect(parsed.pricing_issues).toContainEqual({sale_type:'SPLIT',volume_ml:3,announced_amount:107.7,expected_amount:116.7})})
})

describe('MESSY SEXY — chamada inicial de disponibilidade',()=>{
  const messySexy=`MESSY SEXY JUST ROLLED OUT OF BED — WHAT WE DO IS SECRET
Frasco 1.

▪️ Cotação: R$ 41,90/ml (+ R$ 9,00 recravação)
▪️ APC: 25ml + R$ 50,00 (frasco original de 50ml)
📦 Liberação para envio: a partir de 25/09 (prazo estimado: 15 dias úteis)
💳 Parcelamento em até 6x sem juros.

🚨 50mls disponíveis. 🚨
03ml — R$ 134,70
05ml — R$ 218,50
08ml — R$ 344,20
10ml — R$ 428,00
12ml — R$ 511,80
15ml — R$ 637,50
APC — R$ 1.097,50

APC: FERNANDA VT
10ML: VI COIMBRA
03ML: CIDA MAMÃO
03ML: MARIANA BELOTO
03ML: ANA LUIZA NEVES
03ML: VIVIANE MESSIAS
03ML: LARISSA SIMÕES`
  const parsed=parseDaviSalesBatch(messySexy)
  it('reconhece perfume, marca, frasco, valores e as sete vendas',()=>{expect(parsed).toMatchObject({perfume:'MESSY SEXY JUST ROLLED OUT OF BED — WHAT WE DO IS SECRET',bottle_number:1,original_volume_ml:50,quote_per_ml:41.9,pricing_consistent:true,totals:{sales:7,volume_ml:50,amount:2199}});expect(perfumeIdentity(parsed.perfume).brand).toBe('WHAT WE DO IS SECRET')})
  it('trata 50 ml repetidos como oferta inicial e registra saldo final zero',()=>expect(parsed).toMatchObject({announced_balance_ml:50,remaining_available_ml:0,totals:{calculated_balance_ml:0,total_operation_ml:50,volume_consistent:true}}))
})

describe('texto tabular copiado de planilha',()=>{
  const row=(client:string,type:string,ml:number,perfume:string,value:string,status='',method='',paid='')=>[client,'8/13/2026','9/4/2026','',type,String(ml),perfume,value,status,method,paid,''].join('\t')
  const feve=[row('TATIANA CARVALHO','APC',25,'FÈVE NECTAR - PLACE DE LA RÊVERIE','R$ 1.222,50','PAGO','PIX','8/13/2026'),row('LUCIANA ALVES','SPLIT',3,'FÈVE NECTAR - PLACE DE LA RÊVERIE','R$ 149,70'),row('MARIANA ZTB','SPLIT',3,'FÈVE NECTAR - PLACE DE LA RÊVERIE','R$ 149,70','AGUARDANDO'),row('MELANI NUNES','SPLIT',5,'FÈVE NECTAR - PLACE DE LA RÊVERIE','R$ 243,50'),row('CLAUDIA FERNANDA','SPLIT',3,'FÈVE NECTAR - PLACE DE LA RÊVERIE','R$ 149,70'),row('FERNANDA VT','SPLIT',5,'FÈVE NECTAR - PLACE DE LA RÊVERIE','R$ 243,50'),row('ENDRIGO RODRIGUES','SPLIT',3,'FÈVE NECTAR - PLACE DE LA RÊVERIE','R$ 149,70'),row('ERICA FREITAS','SPLIT',3,'FÈVE NECTAR - PLACE DE LA RÊVERIE','R$ 149,70')]
  it('detecta TSV antes do parser livre',()=>expect(isTabularSalesBatch(feve.join('\n'))).toBe(true))
  it('reconhece as oito vendas Fève, datas M/D/YYYY e totais reais',()=>{const parsed=parseDaviSalesBatch(feve.join('\n'));expect(parsed.source_format).toBe('tsv');expect(parsed.sales).toHaveLength(8);expect(parsed.totals).toMatchObject({sales:8,volume_ml:50,amount:2458});expect(parsed.sales[0]).toMatchObject({sale_date:'2026-08-13',shipping_deadline_date:'2026-09-04',payment_status_raw:'PAGO',payment_method_raw:'PIX'})})
  it('agrupa múltiplos perfumes sem deduplicar clientes repetidos',()=>{const parsed=parseDaviSalesBatch([...feve,row('LUCIANA ALVES','SPLIT',4,'BLOCKADE - MIND GAMES','R$ 200,00'),row('ANA PAULA','SPLIT',2,'BLONDE AMBER - CLIVE CHRISTIAN','R$ 99,90')].join('\n'));expect(parsed.groups?.map(group=>group.perfume)).toEqual(['BLOCKADE - MIND GAMES','BLONDE AMBER - CLIVE CHRISTIAN','FÈVE NECTAR - PLACE DE LA RÊVERIE']);expect(parsed.sales).toHaveLength(10)})
  it('preserva identidade, marca e frasco separadamente',()=>{const parsed=parseDaviSalesBatch(row('BEATRIZ','APC',50,'BLOCKADE - MIND GAMES (FRASCO 2)','R$ 2.000,00'));expect(parsed.groups?.[0]).toMatchObject({raw_perfume_name:'BLOCKADE - MIND GAMES (FRASCO 2)',display_name:'BLOCKADE - MIND GAMES',normalized_perfume_name:'blockade mind games',brand:'MIND GAMES',bottle_number:2})})
  it('não mistura dois frascos do mesmo perfume em um único lote',()=>{const parsed=parseDaviSalesBatch([row('ANA','SPLIT',3,'BLOCKADE - MIND GAMES (FRASCO 1)','R$ 100,00'),row('BIA','SPLIT',5,'BLOCKADE - MIND GAMES (FRASCO 2)','R$ 150,00')].join('\n'));expect(parsed.groups).toHaveLength(2);expect(parsed.groups?.map(group=>group.bottle_number)).toEqual([1,2])})
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

describe('listas reais — novos frascos e APC com volume diferente do anúncio',()=>{
  const cityOfStars=`CITY OF STARS — LOUIS VUITTON
Frasco 2.
▪️ Cotação: R$ 29,90/ml (+ R$ 9,00 recravação)
▪️ APC: 50ml + R$ 50,00 (frasco original de 100ml)
📦 Liberação para envio: a partir de 25/09 (prazo estimado: 15 dias úteis)
🚨 FRASCO FECHADO. 🚨
03ml — R$ 98,70
05ml — R$ 158,50
08ml — R$ 248,20
10ml — R$ 308,00
12ml — R$ 367,80
15ml — R$ 457,50
APC — R$ 1.545,00
55ml: Rute Bonjardim
10ml: Erica Freitas
05ml: Priscilla Duque
05ml: Julia Castro
05ml: Mariana Castelo
05ml: Tonia Schauffer
03ml: Cida Mamão
03ml: Germana
03ml: Igor Barros
03ml: Larissa Simões
03ml: Viviane Messias`
  const omnia=`OMNIA OMNIBUS UBIQUE — MEMO PARIS
Frasco 2.
▪️ Cotação: R$ 37,90/ml (+ R$ 9,00 recravação)
▪️ APC: 40ml + R$ 50,00 (frasco original de 75ml)
📦 Liberação para envio: a partir de 25/09 (prazo estimado: 15 dias úteis)
🚨 FRASCO FECHADO. 🚨
03ml — R$ 122,70
05ml — R$ 198,50
08ml — R$ 312,20
10ml — R$ 388,00
12ml — R$ 463,50
15ml — R$ 577,50
APC — R$ 1.566,00
APC 37ml: Tonia Schauffer
08ml: Juliana Chicrala
05ml: Priscilla Duque
05ml: Ligia Baruffaldi
03ml: Ana Paula Vital
03ml: Anna Julia Veloso
03ml: Cecilia Teixeira
03ml: Luciana Alves
03ml: Munique Mello
03ml: Daniela Toledo
02ml: Vi Coimbra`

  it('aceita o Frasco 2 de City of Stars independentemente do Frasco 1 histórico',()=>{
    const parsed=parseDaviSalesBatch(cityOfStars)
    expect(parsed).toMatchObject({perfume:'CITY OF STARS — LOUIS VUITTON',bottle_number:2,pricing_consistent:true,totals:{sales:11,volume_ml:100,calculated_balance_ml:0}})
    expect(parsed.sales[0]).toMatchObject({client_name:'Rute Bonjardim',sale_type:'SPLIT',volume_ml:55,amount:1653.5})
  })

  it('aceita APC 37ml, preserva o volume real e recalcula o valor',()=>{
    const parsed=parseDaviSalesBatch(omnia)
    expect(parsed).toMatchObject({perfume:'OMNIA OMNIBUS UBIQUE — MEMO PARIS',bottle_number:2,pricing_consistent:false,totals:{sales:11,volume_ml:75,calculated_balance_ml:0}})
    expect(parsed.pricing_issues).toContainEqual({sale_type:'SPLIT',volume_ml:12,announced_amount:463.5,expected_amount:463.8})
    expect(parsed.sales[0]).toMatchObject({client_name:'Tonia Schauffer',sale_type:'APC',volume_ml:37,amount:1452.3})
  })
})

describe('enriquecimento determinístico de clientes',()=>{
  const complete={id:'1',name:'Luciana Alves',cpf:'1',phone:'2',postal_code:'3',address_line:'Rua',address_number:'4',district:'Centro',city:'SP',state:'SP'}
  it('reaproveita match exato único e cadastro completo',()=>{expect(classifyClientMatches('Luciana Alves',[complete]).status).toBe('found');expect(missingShippingFields(complete)).toEqual([])})
  it.each([['cpf','CPF'],['phone','telefone'],['address_line','endereço']])('sinaliza ausência de %s sem inventar dado',(field,label)=>expect(missingShippingFields({...complete,[field]:null})).toContain(label))
  it('classifica cliente novo sem fusão automática',()=>expect(classifyClientMatches('Mariana ZTB',[complete]).status).toBe('new'))
  it('exige humano diante de nome ambíguo',()=>expect(classifyClientMatches('Fernanda',[{name:'Fernanda VT'},{name:'Fernanda Alves'}]).status).toBe('review'))
})
