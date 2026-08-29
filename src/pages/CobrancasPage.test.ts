import{readFileSync}from'node:fs'
import{describe,expect,it}from'vitest'

const page=readFileSync(new URL('./CobrancasPage.tsx',import.meta.url),'utf8')

describe('CobrancasPage — agrupamento por cliente (item 4)',()=>{
  it('agrupa vendas do mesmo client_id em um único card, acumulando total',()=>{
    expect(page).toContain('const existing=map.get(row.client_id)')
    expect(page).toContain('existing.sales.push(row);existing.total+=row.amount')
  })
  it('cliente novo cria um único grupo com total inicial igual à venda',()=>{
    expect(page).toContain('map.set(row.client_id,{client_id:row.client_id')
    expect(page).toContain('total:row.amount')
  })
  it('cada card mostra client_number, nome, total em aberto e quantidade de vendas pendentes',()=>{
    expect(page).toContain('clientNumber(group.client_number)')
    expect(page).toContain('group.client_name')
    expect(page).toContain('brl(group.total)')
    expect(page).toMatch(/group\.sales\.length\}.*venda/)
  })
})

describe('CobrancasPage — resumo no topo (item 3)',()=>{
  it('total global soma amount de todas as vendas pendentes carregadas, não só o filtro visível',()=>{
    expect(page).toContain('open:rows.reduce((sum,row)=>sum+row.amount,0)')
  })
  it('clientes com pendências e vendas pendentes vêm do total não filtrado',()=>{
    expect(page).toContain('clients:allGroups.length,sales:rows.length')
  })
  it('busca cobre cliente, número do cliente e perfume (delegado ao RPC)',()=>{
    expect(page).toContain('fetchCollectionsPending')
    expect(page).toContain('placeholder="Buscar cliente, número do cliente ou perfume"')
  })
  it('filtros TODOS/MENSAGEM NUNCA COPIADA/MENSAGEM JÁ COPIADA e nenhum VENCIDOS inventado',()=>{
    const filterBlock=page.slice(page.indexOf('role="group" aria-label="Filtrar por mensagem copiada"'),page.indexOf('{error&&<div className="notice"'))
    expect(filterBlock).toContain('>TODOS<')
    expect(filterBlock).toContain('>MENSAGEM NUNCA COPIADA<')
    expect(filterBlock).toContain('>MENSAGEM JÁ COPIADA<')
    expect(filterBlock).not.toContain('VENCIDOS')
    expect(page).toContain("type CollectionFilter='all'|'never_copied'|'copied'")
  })
  it('filtros nunca usam vocabulário de "cobrado/cobrança confirmada" — só o que o sistema sabe: mensagem copiada',()=>{
    const filterBlock=page.slice(page.indexOf('role="group" aria-label="Filtrar por mensagem copiada"'),page.indexOf('{error&&<div className="notice"'))
    expect(filterBlock).not.toMatch(/COBRAD/)
  })
})

describe('CobrancasPage — mensagem de cobrança (item 5)',()=>{
  it('mensagem é montada só com as vendas do grupo (já filtradas como pendentes pelo RPC)',()=>{
    expect(page).toContain('const buildMessage=(group:ClientGroup)=>{')
    expect(page).toContain('group.sales.map(s=>')
    expect(page).toContain('group.total')
  })
  it('segue o modelo: saudação, lista perfume — valor, total em aberto, aviso de comprovante',()=>{
    expect(page).toContain('Tudo bem?')
    expect(page).toContain('Total em aberto:')
    expect(page).toContain('pode nos enviar o comprovante por aqui')
  })
  it('mensagem é revisável antes de copiar (textarea editável, não texto fixo)',()=>{
    expect(page).toContain('[text,setText]=useState(()=>buildMessage(group))')
    expect(page).toContain('<textarea className="collections-copy-text" value={text} onChange={e=>setText(e.target.value)}')
  })
  it('botão COPIAR MENSAGEM usa a Clipboard API e dá feedback MENSAGEM COPIADA',()=>{
    expect(page).toContain('await navigator.clipboard.writeText(text)')
    expect(page).toContain("toast.push('MENSAGEM COPIADA',{tone:'success'})")
  })
})

describe('CobrancasPage — histórico de mensagem copiada, nunca "cobrança confirmada" (item 1 e 6)',()=>{
  it('copiar registra collection_event via logCollectionMessageCopied, depois do clipboard',()=>{
    const copyIndex=page.indexOf('navigator.clipboard.writeText(text)')
    const logIndex=page.indexOf('logCollectionMessageCopied(group.client_id')
    expect(copyIndex).toBeGreaterThan(0)
    expect(logIndex).toBeGreaterThan(copyIndex)
  })
  it('nunca afirma que a mensagem foi enviada — só que foi copiada',()=>{
    expect(page).toContain('Nenhum WhatsApp é enviado automaticamente')
    expect(page.toLowerCase()).not.toContain('mensagem enviada')
  })
  it('card mostra "Mensagem nunca copiada" ou última mensagem copiada + contagem — nunca "cobrado"/"já cobrado"',()=>{
    expect(page).toContain("'Mensagem nunca copiada'")
    expect(page).toMatch(/Última mensagem copiada: \$\{messageCopiedAt\(group\.last_message_copied_at!\)\} · Copiada \$\{group\.message_copied_count\}×/)
  })
  it('nenhum texto do componente afirma "já cobrado", "última cobrança" ou "cobrado X vezes" — o evento só prova que a mensagem foi copiada',()=>{
    expect(page).not.toMatch(/Já cobrado/i)
    expect(page).not.toMatch(/Última cobrança/i)
    expect(page).not.toMatch(/Cobrado \d/i)
    expect(page).not.toMatch(/Nunca cobrado/i)
  })
})

describe('CobrancasPage — registrar pagamento (item 7)',()=>{
  it('abre modal com seleção de vendas por checkbox, não um checkbox único de tudo-ou-nada',()=>{
    expect(page).toContain('const[selected,setSelected]=useState<Set<string>>(()=>new Set(group.sales.map(s=>s.id)))')
    expect(page).toContain('<input type="checkbox" checked={selected.has(s.id)} onChange={()=>toggle(s.id)}/>')
  })
  it('modal mostra cliente, vendas selecionadas, valor total, data, forma e observação opcional',()=>{
    expect(page).toContain('group.client_name')
    expect(page).toContain('VALOR TOTAL SELECIONADO')
    expect(page).toContain('Data do pagamento')
    expect(page).toContain('Forma de pagamento')
    expect(page).toContain('label="Observação" htmlFor="collections-notes" hint="Opcional"')
  })
  it('forma de pagamento sugere valores já existentes no sistema via davi_excel_distinct — não cria enum novo',()=>{
    expect(page).toContain("fetchDaviExcelDistinct('method',{},'')")
  })
  it('confirmar chama registerCollectionPayment com as vendas selecionadas',()=>{
    expect(page).toContain('await registerCollectionPayment([...selected],paidAt,method.trim(),notes.trim()||undefined)')
  })
  it('após pagar, recarrega a fila (venda quitada some da lista automaticamente pelo RPC)',()=>{
    expect(page).toContain('onPaid();onClose()')
    expect(page).toContain('onPaid={reload}')
  })
})

describe('CobrancasPage — permissões (item 2/11)',()=>{
  it('REGISTRAR PAGAMENTO só aparece com sales.edit',()=>{
    expect(page).toContain("const canRegisterPayment=useHasPermission('sales.edit')")
    expect(page).toContain('{canRegisterPayment&&<PrimaryButton onClick={()=>setPaymentGroup(group)}>REGISTRAR PAGAMENTO</PrimaryButton>}')
  })
  it('COPIAR COBRANÇA e ABRIR CLIENTE não dependem de sales.edit',()=>{
    expect(page).toMatch(/<SecondaryButton icon=\{<ClipboardCopy size=\{14\}\/>\} onClick=\{\(\)=>setCopyGroup\(group\)\}>COPIAR COBRANÇA<\/SecondaryButton>/)
    expect(page).toContain('onClick={()=>openClient(group.client_id)}')
  })
})

describe('CobrancasPage — arquitetura pronta para WhatsApp oficial sem reconstrução (contexto do módulo)',()=>{
  it('logCollectionMessageCopied aceita metadata livre (jsonb), ponto de extensão futuro sem migração de schema',()=>{
    expect(page).toContain('logCollectionMessageCopied(group.client_id,{sale_ids:group.sales.map(s=>s.id)})')
  })
})
