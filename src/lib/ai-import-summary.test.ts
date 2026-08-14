import {describe,expect,it} from 'vitest'
import {AiImportSummary,buildAiImportSummarySentences} from './ai-import-summary'
import {brl} from './format'

const base:AiImportSummary={
  sales_created:1,clients_created:0,clients_existing:1,
  perfumes_processed:1,perfumes_matched:1,inventory_items_bootstrapped:0,
  total_ml_sold:3,total_amount_sold:89.7,commercial_remaining_ml:0,commercial_remaining_amount:0,
  shipping_incomplete:1,paid_source_count:0,awaiting_source_count:1,unstated_payment_count:0,idempotent:false,
}
const technicalKeys=['total_ml_sold','total_amount_sold','clients_created','clients_existing','shipping_incomplete','perfumes_processed','perfumes_matched','inventory_items_bootstrapped','awaiting_source_count','paid_source_count','unstated_payment_count','commercial_remaining_ml','commercial_remaining_amount','batch_id','fingerprint','idempotent']

describe('resumo humano: reproduz o caso real do print',()=>{
  const sentences=buildAiImportSummarySentences(base)
  it('primeira frase: singular correto, valores exatos, sem chaves técnicas',()=>{
    expect(sentences[0]).toBe(`1 venda foi registrada, totalizando ${brl(89.7)} e 3 ml vendidos.`)
  })
  it('cliente existente com cadastro incompleto vira frase humana',()=>{
    expect(sentences).toContain('O cliente já existia no CRM.')
    expect(sentences).toContain('O cadastro do cliente ainda está incompleto para envio.')
  })
  it('perfume único já no estoque vira frase humana',()=>{
    expect(sentences).toContain('O perfume já estava cadastrado no estoque e foi vinculado à venda.')
  })
  it('nenhuma frase contém nome técnico de campo/coluna/RPC',()=>{
    const joined=sentences.join(' ')
    for(const key of technicalKeys)expect(joined).not.toContain(key)
    expect(joined).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i)
  })
})

describe('gramática: singular/plural corretos em todas as contagens',()=>{
  it('1 venda → singular; 2 vendas → plural',()=>{
    expect(buildAiImportSummarySentences({...base,sales_created:1})[0]).toContain('1 venda foi registrada')
    expect(buildAiImportSummarySentences({...base,sales_created:2})[0]).toContain('2 vendas foram registradas')
  })
  it('1 ml vendido → singular; 3 ml vendidos → plural',()=>{
    expect(buildAiImportSummarySentences({...base,total_ml_sold:1})[0]).toContain('1 ml vendido')
    expect(buildAiImportSummarySentences({...base,total_ml_sold:3})[0]).toContain('3 ml vendidos')
  })
  it('1 cliente → singular; 3 clientes → plural',()=>{
    expect(buildAiImportSummarySentences({...base,clients_existing:1,clients_created:0})).toContain('O cliente já existia no CRM.')
    expect(buildAiImportSummarySentences({...base,clients_existing:3,clients_created:0})).toContain('Os 3 clientes já existiam no CRM.')
  })
  it('1 perfume registrado (bootstrap) → singular; 4 → plural',()=>{
    expect(buildAiImportSummarySentences({...base,inventory_items_bootstrapped:1}).join(' ')).toContain('1 perfume foi registrado')
    expect(buildAiImportSummarySentences({...base,inventory_items_bootstrapped:4}).join(' ')).toContain('4 perfumes foram registrados')
  })
})

describe('não mostra zero desnecessário',()=>{
  it('sem clientes novos, sem estoque criado, sem saldo comercial → nenhuma frase extra sobre esses zeros',()=>{
    const sentences=buildAiImportSummarySentences(base)
    expect(sentences.join(' ')).not.toMatch(/\b0\b/)
    expect(sentences.some(s=>s.includes('novo cliente'))).toBe(false)
    expect(sentences.some(s=>s.includes('registrado a partir das vendas')||s.includes('registrados a partir das vendas'))).toBe(false)
  })
  it('sem nenhum status de pagamento presente, não gera frase de pagamento',()=>{
    const sentences=buildAiImportSummarySentences({...base,paid_source_count:0,awaiting_source_count:0,unstated_payment_count:0})
    expect(sentences.some(s=>s.includes('Na lista original'))).toBe(false)
  })
})

describe('sem IA disponível: resumo determinístico continua legível, nunca um dump de chaves',()=>{
  it('juntar as frases produz um parágrafo coerente em português',()=>{
    const text=buildAiImportSummarySentences(base).join(' ')
    expect(text).toMatch(/^1 venda foi registrada/)
    expect(text.length).toBeGreaterThan(20)
    for(const key of technicalKeys)expect(text).not.toContain(key)
  })
})
