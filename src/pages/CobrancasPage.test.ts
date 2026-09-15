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
  it('ordena os clientes alfabeticamente para a rotina de cobrança',()=>{
    expect(page).toContain("a.client_name.localeCompare(b.client_name,'pt-BR',{sensitivity:'base'})")
    expect(page).not.toContain('sort((a,b)=>b.total-a.total)')
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

describe('CobrancasPage — mensagem de cobrança (item 5, template "Bi biiiiiiii")',()=>{
  it('mensagem usa group.total (dinâmico, formatado em BRL via brl()) — nenhum valor hardcoded',()=>{
    expect(page).toContain('const buildMessage=(group:ClientGroup)=>')
    expect(page).toContain('💰 Total: ${brl(group.total)}')
    expect(page).not.toMatch(/R\$\s*\d/)
  })
  it('não lista mais os itens individuais (perfume — valor) — o novo template só traz o total',()=>{
    const buildMessageFn=page.slice(page.indexOf('const buildMessage'),page.indexOf('function CopyMessageModal'))
    expect(buildMessageFn).not.toContain('group.sales.map')
    expect(buildMessageFn).not.toContain('perfume_name')
  })
  it('segue exatamente o texto aprovado: saudação "Bi biiiiiiii", reserva do pedido, total, PIX/CNPJ, opção de cartão, pedido de comprovante, encerramento',()=>{
    expect(page).toContain('Bi biiiiiiii 🚗💨✨')
    expect(page).toContain('O carrinho da cobrança da Ruah passando por aqui!')
    expect(page).toContain('Seu pedido está reservado e só falta o sinal verde para seguirmos com a separação. 🤍')
    expect(page).toContain('Confere pra mim se está tudo certinho?')
    expect(page).toContain('🔑 PIX (CNPJ) — GI Cosméticos LTDA')
    expect(page).toContain('67.819.967/0001-70')
    expect(page).toContain('💳 Prefere cartão? Me fala em quantas vezes quer parcelar que preparo o link.')
    expect(page).toContain('Depois do pagamento, me envia o comprovante por aqui para eu agilizar a separação. 📦✨')
    expect(page).toContain('Obrigada por escolher a Ruah Parfums! 🤍')
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

describe('CobrancasPage — baixar imagem do pedido (1 clique, sem preview/modal)',()=>{
  it('botão BAIXAR IMAGEM DO PEDIDO só aparece quando o cliente tem vendas pendentes (guard explícito, não implícito)',()=>{
    expect(page).toContain("{group.sales.length>0&&<SecondaryButton icon={<Download size={14}/>} loading={downloadGroup?.client_id===group.client_id} disabled={!!downloadGroup&&downloadGroup.client_id!==group.client_id} onClick={()=>setDownloadGroup(group)}>BAIXAR IMAGEM DO PEDIDO</SecondaryButton>}")
  })
  it('clicar no botão não abre modal — monta CollectionImageDownload direto na página, fora da tela',()=>{
    expect(page).toContain('{downloadGroup&&<CollectionImageDownload group={downloadGroup} onDone={()=>setDownloadGroup(null)}/>}')
    expect(page).toContain('<div className="collections-image-offscreen" aria-hidden="true"><CollectionSummaryImageCard ref={nodeRef} group={group}/></div>')
  })
  it('a imagem usa exatamente o mesmo group já montado (só vendas pending — mesma fonte do card, da mensagem e do pagamento)',()=>{
    expect(page).toContain('function CollectionImageDownload({group,onDone}:{group:ClientGroup;onDone:()=>void})')
  })
  it('não recarrega nem refiltra dados para gerar a imagem — reaproveita o group já em memória, sem nova consulta',()=>{
    const componentFn=page.slice(page.indexOf('function CollectionImageDownload'),page.indexOf('function RegisterPaymentModal'))
    expect(componentFn).not.toContain('fetchCollectionsPending')
    expect(componentFn).not.toMatch(/\.rpc\(/)
  })
  it('nome do arquivo: cobranca-{slug do cliente}-{data}.png',()=>{
    expect(page).toContain("const name=`cobranca-${slugify(group.client_name)}-${new Date().toISOString().slice(0,10)}.png`")
  })
  it('captura usa COLLECTION_IMAGE_PIXEL_RATIO (densidade sobre um nó já no tamanho físico real — nunca um valor calculado tipo 1080/480, que é o padrão antigo de "card pequeno ampliado")',()=>{
    expect(page).toContain('await downloadNodeAsPng(nodeRef.current,name,COLLECTION_IMAGE_PIXEL_RATIO)')
    expect(page).not.toMatch(/1080\s*\/\s*480/)
  })
  it('importa a largura/densidade de exportação do próprio componente do card (fonte única), não reimplementa nem hardcoda de novo na página',()=>{
    expect(page).toContain("import{COLLECTION_IMAGE_PIXEL_RATIO,CollectionSummaryImageCard}from'../components/CollectionSummaryImageCard'")
  })
  it('sucesso e falha da captura sempre liberam o botão (onDone chamado nos dois casos, guardado por cancelled)',()=>{
    const componentFn=page.slice(page.indexOf('function CollectionImageDownload'),page.indexOf('function RegisterPaymentModal'))
    expect(componentFn).toContain('if(!cancelled)onDone()')
  })
  it('container de captura fica fora da tela (position:fixed off-canvas), nunca visível nem sobrepondo a página',()=>{
    const css=readFileSync(new URL('./CobrancasPage.css',import.meta.url),'utf8')
    expect(css).toContain('.collections-image-offscreen{position:fixed;top:-10000px;left:-10000px}')
  })
})

describe('CobrancasPage — qualidade da exportação não trunca listas longas',()=>{
  it('nenhum limite de altura/overflow no card ou no offscreen que pudesse cortar uma cobrança com muitos itens (ex.: Larissa, 36 pedidos)',()=>{
    const css=readFileSync(new URL('./CobrancasPage.css',import.meta.url),'utf8')
    expect(css).not.toMatch(/\.collections-image-offscreen[^}]*(max-height|overflow)/)
  })
  it('lista de itens nunca é fatiada/paginada — .map roda sobre TODAS as vendas do group, sem slice/limit',()=>{
    const componentFn=readFileSync(new URL('../components/CollectionSummaryImageCard.tsx',import.meta.url),'utf8')
    expect(componentFn).toContain('group.sales.map((sale,index)=>')
    expect(componentFn).not.toMatch(/\.slice\(|\.filter\(.*\.length|MAX_ITEMS/)
  })
})

describe('CobrancasPage — baixar imagem não exige sales.edit (item Permissões)',()=>{
  it('BAIXAR IMAGEM DO PEDIDO não está condicionado a canRegisterPayment — basta sales.view para abrir a página',()=>{
    const footerBlock=page.slice(page.indexOf('<footer>'),page.indexOf('</footer>'))
    expect(footerBlock).toContain('BAIXAR IMAGEM DO PEDIDO</SecondaryButton>}')
    expect(footerBlock.indexOf('BAIXAR IMAGEM DO PEDIDO')).toBeLessThan(footerBlock.indexOf('canRegisterPayment'))
  })
  it('REGISTRAR PAGAMENTO continua exigindo canRegisterPayment (sales.edit) — o botão de imagem não afrouxou esse gate',()=>{
    expect(page).toContain('{canRegisterPayment&&<PrimaryButton onClick={()=>setPaymentGroup(group)}>REGISTRAR PAGAMENTO</PrimaryButton>}')
  })
})

describe('CobrancasPage — invariantes de estoque/logística (item "Invariantes obrigatórias")',()=>{
  it('nenhuma menção a estoque físico/logística em toda a página, incluindo o fluxo de imagem',()=>{
    for(const forbidden of ['inventory_items','inventory_movements','inventory_purchase_entries','inventory_allocations','physical_ml','operational_code','RUAH-P','shipment','preparation_batch'])
      expect(page.toLowerCase()).not.toContain(forbidden.toLowerCase())
  })
  it('mantém somente as escritas esperadas, incluindo preparação segura do envio ManyChat',()=>{
    const rpcCalls=[...page.matchAll(/await (\w+)\(/g)].map((match)=>match[1])
    expect(new Set(rpcCalls)).toEqual(new Set(['logCollectionMessageCopied','downloadNodeAsPng','renderNodeAsPngBlob','uploadCollectionImage','registerCollectionPayment','sendManychatMessage']))
  })
})
