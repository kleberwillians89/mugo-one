import{readFileSync}from'node:fs'
import{describe,expect,it}from'vitest'

const component=readFileSync(new URL('./CollectionSummaryImageCard.tsx',import.meta.url),'utf8')
const css=readFileSync(new URL('./CollectionSummaryImageCard.css',import.meta.url),'utf8')
const downloadLib=readFileSync(new URL('../lib/download-image.ts',import.meta.url),'utf8')

describe('CollectionSummaryImageCard — só o que os dados têm, nada inventado',()=>{
  it('recebe o grupo já pronto (client_name, sales, total) — não busca dados sozinho, não filtra nada por conta própria',()=>{
    expect(component).toContain('export type CollectionSummaryGroup={client_name:string;sales:CollectionSaleRow[];total:number}')
    expect(component).not.toContain('fetchCollectionsPending')
    expect(component).not.toMatch(/payment_status/)
  })
  it('itens numerados 01, 02, 03… com padStart(2,\'0\'), na mesma ordem em que chegam (sale_date asc, id asc — já garantido pela RPC/agrupamento)',()=>{
    expect(component).toContain("String(index+1).padStart(2,'0')")
    expect(component).toContain('group.sales.map((sale,index)=>')
  })
  it('cada item mostra perfume, tipo, volume em ml e valor em BRL',()=>{
    expect(component).toContain('sale.perfume_name??\'Perfume\'')
    expect(component).toContain("sale.sale_type??'—'")
    expect(component).toContain('sale.volume_ml??\'—\'')
    expect(component).toContain('brl(sale.amount)')
  })
  it('marca do perfume aparece quando existe (perfumes.brand_house) — some sem quebrar o layout quando o perfume não tem marca cadastrada',()=>{
    expect(component).toContain('{sale.perfume_brand&&<span className="collection-summary-item-brand">{sale.perfume_brand}</span>}')
  })
  it('nome do cliente e contagem de pedidos em aberto aparecem no cabeçalho',()=>{
    expect(component).toContain('<h2>{group.client_name}</h2>')
    expect(component).toContain("{count} pedido{count===1?'':'s'} em aberto")
  })
  it('total no rodapé usa group.total (já somado só com pendentes por quem monta o grupo) — não recalcula por conta própria',()=>{
    expect(component).toContain('<strong>{brl(group.total)}</strong>')
    expect(component).not.toMatch(/reduce\(/)
  })
  it('rodapé institucional presente, sem qualquer afirmação de envio/pagamento',()=>{
    expect(component).toContain('RUAH PARFUMS • Conferência de pedidos em aberto')
    expect(component.toLowerCase()).not.toContain('pago')
    expect(component.toLowerCase()).not.toContain('enviado')
  })
  it('logo RUAH no topo',()=>{
    expect(component).toContain('src="/ruah-brand.svg"')
  })
  it('largura fixa em CSS para exportação consistente, formato retrato, estética clara/dourada',()=>{
    expect(css).toContain('.collection-summary-image{width:480px')
    expect(css).toMatch(/background:#faf6ee/)
    expect(css).toMatch(/'Playfair Display'/)
  })
})

describe('CollectionSummaryImageCard — invariantes de escrita (item "Invariantes obrigatórias")',()=>{
  it('componente é puramente visual: nenhum RPC, nenhuma chamada ao supabase, nenhum write',()=>{
    for(const forbidden of ['supabase','registerCollectionPayment','logCollectionMessageCopied','.rpc(','useEffect','useState'])
      expect(component).not.toContain(forbidden)
  })
  it('nenhuma menção a estoque/físico/logística em todo o componente ou seu CSS',()=>{
    for(const forbidden of ['inventory_items','inventory_movements','inventory_purchase_entries','inventory_allocations','physical_ml','operational_code','RUAH-P','shipment','preparation_batch'])
      expect((component+css).toLowerCase()).not.toContain(forbidden.toLowerCase())
  })
})

describe('download-image.ts — geração 100% local, sem backend/upload/storage',()=>{
  it('usa html-to-image (toBlob) sobre o próprio nó do DOM — nada de canvas manual nem serviço externo',()=>{
    expect(downloadLib).toContain("from'html-to-image'")
    expect(downloadLib).toContain('toBlob(node,')
  })
  it('baixa localmente via Blob + <a download>, mesmo padrão já usado por exportCsv — nunca faz upload',()=>{
    expect(downloadLib).toContain('URL.createObjectURL(blob)')
    expect(downloadLib).toContain("link.download=name")
    expect(downloadLib).toContain('link.click()')
    expect(downloadLib).toContain('URL.revokeObjectURL(url)')
  })
  it('pixelRatio é parametrizável (permite exportar maior que o tamanho exibido em tela)',()=>{
    expect(downloadLib).toContain('pixelRatio=1')
  })
  it('nunca chama supabase, faz fetch para o backend ou referencia bucket (o comentário do arquivo já documenta "sem storage" como propósito, não como código)',()=>{
    for(const forbidden of ['supabase','bucket','fetch('])
      expect(downloadLib.toLowerCase()).not.toContain(forbidden.toLowerCase())
  })
})
