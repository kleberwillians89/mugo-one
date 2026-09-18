import{readFileSync}from'node:fs'
import{describe,expect,it}from'vitest'

const page=readFileSync(new URL('./CobrancasPage.tsx',import.meta.url),'utf8')

describe('CobrancasPage — agrupamento por cliente e detecção de vencida',()=>{
  it('agrupa vendas do mesmo client_id em um único card, acumulando total',()=>{
    expect(page).toContain('const existing=map.get(row.client_id)')
    expect(page).toContain('existing.sales.push(withItem);existing.total+=row.amount')
  })
  it('ordena os clientes alfabeticamente para a rotina de cobrança',()=>{
    expect(page).toContain("a.client_name.localeCompare(b.client_name,'pt-BR',{sensitivity:'base'})")
  })
  it('vencida é derivada de due_date < hoje (dado real, vindo do RPC universal) — nunca um segundo status inventado',()=>{
    expect(page).toContain("const rowOverdue=Boolean(row.due_date&&row.due_date<today)")
    expect(page).toContain('if(rowOverdue)existing.overdue=true')
  })
  it('situação (para escolher o template certo) é initial/due_today/overdue, derivada só de due_date — sem Automation Scheduler novo',()=>{
    expect(page).toContain("group.situation=group.overdue?'overdue':group.due_date===today?'due_today':'initial'")
  })
})

describe('CobrancasPage — universal: colunas de perfume/frasco/split removidas',()=>{
  it('CollectionSaleRow não tem mais perfume — resumo do item vem de fetchSaleItemsSummaries (mesmo mecanismo de Vendas/Planilha)',()=>{
    expect(page).toContain("import{fetchSaleItemsSummaries,itemsSummaryLabel}from'../lib/sale-items'")
    expect(page.toLowerCase()).not.toMatch(/perfume_name|perfume_brand|\bsale_type\b|volume_ml/)
  })
  it('busca cobre só cliente e número do cliente — nunca perfume',()=>{
    expect(page).toContain('placeholder="Buscar cliente ou número do cliente"')
    expect(page.toLowerCase()).not.toContain('perfume')
  })
  it('sem qualquer resíduo de ManyChat/WhatsApp direto, RUAH, CNPJ ou PIX hardcoded — envio passa pelo Communication Hub (sendCollectionMessage)',()=>{
    for(const forbidden of['sendmanychatmessage','manychat','ruah','67.819.967','gi cosméticos'])
      expect(page.toLowerCase()).not.toContain(forbidden)
    expect(page).toContain('sendCollectionMessage(group.client_id,saleIds,templateId,\'email\')')
  })
})

describe('CobrancasPage — fluxo único "Cobrar" abre direto na prévia (item 15-16 do briefing)',()=>{
  it('o template já vem escolhido por padrão/situação — defaultTemplateFor, nunca uma pergunta separada antes da prévia',()=>{
    expect(page).toContain('defaultTemplateFor')
    expect(page).toContain('const initialTemplate=useMemo(()=>defaultTemplateFor(templates,group.situation),[templates,group.situation])')
  })
  it('botão do card é só "COBRAR" — sem estágios extras (template→canal→enviar) antes de ver a prévia',()=>{
    expect(page).toContain('<PrimaryButton icon={<Send size={14}/>} onClick={()=>setCobrarGroup(group)}>COBRAR</PrimaryButton>')
  })
  it('canal é sempre e-mail, mostrado como informação (não uma decisão) — WhatsApp/SMS não existem ainda como opção real',()=>{
    expect(page).toContain('<div><span>Canal</span><strong>E-mail</strong></div>')
  })
  it('mensagem é renderizada com dados REAIS do cliente/venda (renderCollectionTemplate), nunca fictícios, no fluxo de envio real',()=>{
    expect(page).toContain('renderCollectionTemplate(group.client_id,saleIds,templateId)')
  })
})

describe('CobrancasPage — editar é sempre só para este envio (item 17 do briefing)',()=>{
  it('editar alterna para um textarea local — nenhuma chamada de update/template dispara a partir daqui',()=>{
    const modalFn=page.slice(page.indexOf('function CobrarModal'),page.indexOf('function CollectionImageDownload'))
    expect(modalFn).not.toContain('updateCollectionMessageTemplate')
    expect(modalFn).toContain('setEditing(true)')
    expect(modalFn).toContain('<textarea className="collections-copy-text" value={text} onChange={e=>setText(e.target.value)}')
  })
  it('aviso explícito de que a alteração vale só para este envio, o modelo original não muda',()=>{
    expect(page).toContain('Esta alteração vale só para este envio — o modelo original não muda.')
  })
})

describe('CobrancasPage — copiar mensagem funciona sem provider (item 18 do briefing)',()=>{
  it('botão Copiar mensagem está sempre disponível no rodapé, nunca condicionado a canSend/provider',()=>{
    expect(page).toContain('<SecondaryButton loading={copying} onClick={()=>void copy()}>Copiar mensagem</SecondaryButton>')
  })
  it('copiar usa a Clipboard API e registra collection_event, sem depender do Communication Hub',()=>{
    expect(page).toContain('await navigator.clipboard.writeText(text)')
    expect(page).toContain('await logCollectionMessageCopied(group.client_id,{sale_ids:saleIds,template_id:templateId})')
  })
})

describe('CobrancasPage — provider não configurado nunca mostra erro técnico (item 19 do briefing)',()=>{
  it('provider_not_configured vira "E-mail ainda não está conectado.", nunca o código técnico como texto principal',()=>{
    expect(page).toContain("sendOutcome.errorCode==='provider_not_configured'?'E-mail ainda não está conectado.'")
  })
  it('oferece Configurar e-mail (só para quem pode) e Copiar mensagem como saídas — nunca deixa o usuário travado',()=>{
    expect(page).toContain("errorCode==='provider_not_configured'&&canConfigureComms&&<SecondaryButton onClick={goToCommunications}>Configurar e-mail</SecondaryButton>")
    expect(page).toContain('<SecondaryButton onClick={()=>void copy()}>Copiar mensagem</SecondaryButton>')
  })
  it('sucesso só fecha o modal quando o status realmente é sent — nunca finge sucesso',()=>{
    expect(page).toContain("if(result.status==='sent'){toast.push('Cobrança enviada.',{tone:'success'});onSent();onClose()}")
  })
})

describe('CobrancasPage — tela principal simplificada (item 14 do briefing)',()=>{
  it('3 cards: A receber, Vencidas, Recebidas no mês',()=>{
    expect(page).toContain('<span>A RECEBER</span><strong>{brl(totals.open)}</strong>')
    expect(page).toContain('<span>VENCIDAS</span><strong>{brl(totals.overdue)}</strong>')
    expect(page).toContain('<span>RECEBIDAS NO MÊS</span><strong>{brl(totals.paidThisMonth)}</strong>')
  })
  it('4 filtros: Pendentes, Vencidas, Pagas, Todas',()=>{
    const filterBlock=page.slice(page.indexOf('role="group" aria-label="Filtrar cobranças"'),page.indexOf('{error&&<div className="notice"'))
    expect(filterBlock).toContain('>PENDENTES<')
    expect(filterBlock).toContain('>VENCIDAS<')
    expect(filterBlock).toContain('>PAGAS<')
    expect(filterBlock).toContain('>TODAS<')
  })
  it('aba Pagas usa uma consulta separada dos últimos pagamentos, nunca reaproveita a lista de pendentes',()=>{
    expect(page).toContain("filter==='paid'?")
    expect(page).toContain('fetchRecentlyPaidCollections')
  })
})

describe('CobrancasPage — wizard de configuração (item 12 do briefing)',()=>{
  it('banner "Configure como você recebe pagamentos" só aparece sem settings e para quem pode configurar', () => {
    expect(page).toContain('{!settingsConfigured&&canConfigure&&')
    expect(page).toContain('Configure como você recebe pagamentos.')
  })
  it('o mesmo wizard é oferecido direto no card quando não há template nenhum — nunca uma tela vazia sem saída',()=>{
    expect(page).toContain('{noTemplates&&canConfigure')
    expect(page).toContain('<PrimaryButton onClick={()=>setWizardOpen(true)}>Configurar cobranças</PrimaryButton>')
  })
  it('templates nunca ficam vazios por conta própria — ensureCollectionTemplatesSeeded roda no carregamento da página',()=>{
    expect(page).toContain('ensureCollectionTemplatesSeeded(canConfigure).then(setTemplates)')
  })
})

describe('CobrancasPage — permissões',()=>{
  it('REGISTRAR PAGAMENTO só aparece com sales.edit',()=>{
    expect(page).toContain("const canRegisterPayment=useHasPermission('sales.edit')")
    expect(page).toContain('{canRegisterPayment&&<SecondaryButton onClick={()=>setPaymentGroup(group)}>REGISTRAR PAGAMENTO</SecondaryButton>}')
  })
  it('ENVIAR COBRANÇA (dentro do modal) só aparece com collections.send — copiar nunca depende dela',()=>{
    expect(page).toContain("const canSend=useHasPermission('collections.send')")
    expect(page).toContain('{canSend&&<PrimaryButton loading={sending} disabled={loading||!templateId} onClick={()=>void send()} icon={<Send size={15}/>}>Enviar cobrança</PrimaryButton>}')
  })
  it('ABRIR CLIENTE não depende de nenhuma permissão de cobrança',()=>{
    expect(page).toContain('onClick={()=>openClient(group.client_id)}')
  })
})

describe('CobrancasPage — baixar imagem (1 clique, sem preview/modal)',()=>{
  it('clicar no botão não abre modal — monta CollectionImageDownload direto na página, fora da tela',()=>{
    expect(page).toContain('{downloadGroup&&<CollectionImageDownload group={downloadGroup} onDone={()=>setDownloadGroup(null)}/>}')
    expect(page).toContain('<div className="collections-image-offscreen" aria-hidden="true">')
  })
  it('a imagem usa a marca real da organização (useOrganizationBrand), nunca um logo fixo',()=>{
    expect(page).toContain("import{useOrganizationBrand}from'../components/OrganizationBrandMark'")
    expect(page).toContain('const brand=useOrganizationBrand()')
  })
  it('não recarrega nem refiltra dados para gerar a imagem — reaproveita o group já em memória, sem nova consulta',()=>{
    const componentFn=page.slice(page.indexOf('function CollectionImageDownload'),page.indexOf('function RegisterPaymentModal'))
    expect(componentFn).not.toContain('fetchCollectionsPending')
    expect(componentFn).not.toMatch(/\.rpc\(/)
  })
  it('captura usa COLLECTION_IMAGE_PIXEL_RATIO (densidade sobre um nó já no tamanho físico real)',()=>{
    expect(page).toContain('await downloadNodeAsPng(nodeRef.current,name,COLLECTION_IMAGE_PIXEL_RATIO)')
  })
  it('container de captura fica fora da tela (position:fixed off-canvas), nunca visível nem sobrepondo a página',()=>{
    const css=readFileSync(new URL('./CobrancasPage.css',import.meta.url),'utf8')
    expect(css).toContain('.collections-image-offscreen{position:fixed;top:-10000px;left:-10000px}')
  })
})

describe('CobrancasPage — registrar pagamento (fonte de verdade intocada)',()=>{
  it('confirmar chama registerCollectionPayment (collections_register_payment, intocado)',()=>{
    expect(page).toContain('await registerCollectionPayment([...selected],paidAt,method.trim(),notes.trim()||undefined)')
  })
  it('após pagar, recarrega a fila e a aba Pagas',()=>{
    expect(page).toContain('onPaid();onClose()')
    expect(page).toContain('onPaid={reload}')
  })
})

describe('CobrancasPage — invariantes de estoque/logística',()=>{
  it('nenhuma menção a estoque físico/logística em toda a página, incluindo o fluxo de imagem',()=>{
    for(const forbidden of['inventory_items','inventory_movements','inventory_purchase_entries','inventory_allocations','physical_ml','operational_code','RUAH-P','shipment','preparation_batch'])
      expect(page.toLowerCase()).not.toContain(forbidden.toLowerCase())
  })
})
