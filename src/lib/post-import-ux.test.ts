import {readFileSync} from 'node:fs'
import {describe,expect,it} from 'vitest'

const component=readFileSync(new URL('../components/AiSalesBatchImport.tsx',import.meta.url),'utf8')
const records=readFileSync(new URL('./records.ts',import.meta.url),'utf8')
const edgeFn=readFileSync(new URL('../../supabase/functions/summarize-ai-batch-import/index.ts',import.meta.url),'utf8')
const clientPage=readFileSync(new URL('../pages/ClientDetailsPage.tsx',import.meta.url),'utf8')
const salePage=readFileSync(new URL('../pages/SaleDetailsPage.tsx',import.meta.url),'utf8')

describe('resumo nunca envia chaves técnicas cruas para a IA',()=>{
  it('summarizeAiBatchImport recebe frases prontas, não o objeto de aggregates cru',()=>{
    expect(component).toContain('summarizeAiBatchImport(buildAiImportSummarySentences(built))')
    expect(component).not.toMatch(/summarizeAiBatchImport\(built\)/)
  })
  it('records.ts tipa summarizeAiBatchImport como lista de frases',()=>{
    expect(records).toContain('export async function summarizeAiBatchImport(sentences:string[])')
    expect(records).toContain("body:{organization_id:organizationId,sentences}")
  })
  it('edge function não recebe mais um blob de aggregates; exige um array de frases',()=>{
    expect(edgeFn).toContain('const sentences=ctx.body.sentences as unknown')
    expect(edgeFn).not.toContain('ctx.body.aggregates')
    expect(edgeFn).toContain("input.join('\\n')".replace("input","sentences"))
  })
  it('prompt do sistema proíbe explicitamente nomes técnicos',()=>{
    expect(edgeFn).toMatch(/NÃO use nomes de campos, códigos, identificadores/)
  })
})

describe('resumo determinístico sempre disponível, mesmo sem IA',()=>{
  it('fallback usa buildAiImportSummarySentences, nunca fica em branco nem mostra chaves',()=>{
    expect(component).toContain('aiText??buildAiImportSummarySentences(summary).join(\' \')')
  })
})

describe('gramática corrigida no bloco de sucesso',()=>{
  it('usa countedLabel em vez de texto plural fixo',()=>{
    expect(component).toContain("countedLabel(summary.sales_created,'venda registrada','vendas registradas')")
    expect(component).toContain("countedLabel(summary.total_ml_sold,'ml vendido','ml vendidos')")
    expect(component).not.toContain('vendas registradas</h3>')
  })
})

describe('cliente 360: alerta de cadastro incompleto',()=>{
  it('usa o helper compartilhado, cobrindo também número/cidade/estado',()=>{
    expect(clientPage).toContain("import { missingShippingClientFields } from '../lib/client-completeness'")
    expect(clientPage).toContain('const missingFields=missingShippingClientFields(client)')
  })
  it('bloqueia "Preparar envio" quando o cadastro está incompleto',()=>{
    expect(clientPage).toContain('disabled={!selected.length||preparing||missingFields.length>0}')
    expect(clientPage).toContain('if(!selected.length||missingFields.length)return')
    expect(clientPage).toContain('NÃO É POSSÍVEL CRIAR O ENVIO AINDA')
  })
  it('criação da venda não é bloqueada por isso — só a etapa logística',()=>{
    expect(clientPage).not.toMatch(/missingFields\.length[\s\S]{0,80}(deleteClient|blockSale|preventSale)/)
  })
})

describe('venda 360: aviso discreto, fora do hero',()=>{
  it('usa o mesmo helper compartilhado de completude',()=>{
    expect(salePage).toContain("import { missingShippingClientFields } from '../lib/client-completeness'")
    expect(salePage).toContain('const missingFields=sale.clients?missingShippingClientFields(sale.clients):[]')
  })
  it('o aviso fica na seção de contato/cliente, não dentro do header/hero',()=>{
    const heroStart=salePage.indexOf('<header className="ficha-head')
    const heroEnd=salePage.indexOf('</header>')
    const noticeIndex=salePage.indexOf('DADOS DE ENVIO INCOMPLETOS')
    expect(noticeIndex).toBeGreaterThan(heroEnd)
    expect(noticeIndex).toBeGreaterThan(heroStart)
  })
  it('botão "Preparar envio" fica desabilitado quando incompleto',()=>{
    expect(salePage).toContain('disabled={missingFields.length>0}')
    expect(salePage).toContain('if(!sale.client_id||!allocation||missingFields.length>0)return')
  })
  it('CTA leva para o Cliente 360 para completar o cadastro',()=>{
    expect(salePage).toContain('Completar cadastro do cliente')
    expect(salePage).toContain('const goToClient=()=>{if(!sale.client_id)return;history.pushState')
  })
})

describe('atualização sem F5',()=>{
  it('Cliente 360 recarrega o snapshot completo após salvar o cadastro (recalcula missingFields no mesmo render)',()=>{
    expect(clientPage).toContain('onSaved={()=>fetchClient360(clientId).then(setData)}')
  })
})
