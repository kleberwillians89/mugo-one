import{readFileSync}from'node:fs'
import{describe,expect,it}from'vitest'

const component=readFileSync(new URL('./CollectionSummaryImageCard.tsx',import.meta.url),'utf8')
const css=readFileSync(new URL('./CollectionSummaryImageCard.css',import.meta.url),'utf8')
const downloadLib=readFileSync(new URL('../lib/download-image.ts',import.meta.url),'utf8')
const brandMark=readFileSync(new URL('./OrganizationBrandMark.tsx',import.meta.url),'utf8')

describe('CollectionSummaryImageCard — universal, só o que os dados têm, nada inventado',()=>{
  it('recebe o grupo já pronto (client_name, sales, total) e a marca (brand) já resolvida — não busca dados sozinho, não filtra nada por conta própria',()=>{
    expect(component).toContain('export type CollectionSummaryGroup={client_name:string;sales:CollectionSummaryLine[];total:number}')
    expect(component).not.toContain('fetchCollectionsPending')
    expect(component).not.toMatch(/payment_status/)
  })
  it('zero campo de perfume/frasco/volume — item é só {id, itemLabel, amount}, universal para qualquer vertical',()=>{
    expect(component).toContain('export type CollectionSummaryLine={id:string;itemLabel:string;amount:number}')
    for(const forbidden of['perfume_name','perfume_brand','sale.sale_type','sale.volume_ml','perfume_id'])
      expect(component).not.toContain(forbidden)
  })
  it('itens numerados 01, 02, 03… com padStart(2,\'0\'), na mesma ordem em que chegam',()=>{
    expect(component).toContain("String(index+1).padStart(2,'0')")
    expect(component).toContain('group.sales.map((sale,index)=>')
  })
  it('cada item mostra a descrição genérica do item (itemLabel) e o valor em BRL — nenhum campo vertical',()=>{
    expect(component).toContain('{sale.itemLabel}')
    expect(component).toContain('brl(sale.amount)')
  })
  it('nome do cliente e contagem de pendências aparecem no cabeçalho',()=>{
    expect(component).toContain('<h2>{group.client_name}</h2>')
    expect(component).toContain("{count} pendência{count===1?'':'s'} em aberto")
  })
  it('total no rodapé usa group.total (já somado só com pendentes por quem monta o grupo) — não recalcula por conta própria',()=>{
    expect(component).toContain('<strong>{brl(group.total)}</strong>')
    expect(component).not.toMatch(/reduce\(/)
  })
  it('rodapé institucional usa a marca da ORGANIZAÇÃO (brand.companyName), nunca um nome fixo — sem qualquer afirmação de envio/pagamento',()=>{
    expect(component).toContain('{brand.companyName.toUpperCase()} • Conferência de pendências em aberto')
    expect(component.toLowerCase()).not.toContain('pago')
    expect(component.toLowerCase()).not.toContain('enviado')
  })
  it('logo vem de OrganizationBrandMark (marca real da organização, fallback neutro Mugô One) — nunca um arquivo/alt fixo de uma organização específica',()=>{
    expect(component).toContain('<OrganizationBrandMark brand={brand} print={false}/>')
    expect(component).not.toMatch(/src="\/[a-z-]+\.svg"/)
    expect(brandMark).toContain("src={brand.logoUrl ?? '/mugo-logo.png'}")
  })
  it('largura fixa em CSS no tamanho FÍSICO real de exportação (1080px) — não um card pequeno para depois ampliar; formato retrato, estética clara/dourada',()=>{
    expect(css).toContain('.collection-summary-image{width:1080px')
    expect(css).toMatch(/background:#faf6ee/)
    expect(css).toMatch(/'Playfair Display'/)
  })
  it('altura é automática (sem height/max-height fixos em nenhuma regra) — cresce conforme a quantidade de itens, nunca corta uma cobrança longa',()=>{
    const containerRule=css.slice(css.indexOf('.collection-summary-image{'),css.indexOf('}')+1)
    expect(containerRule).not.toContain('height:')
    expect(css).not.toContain('max-height')
  })
  it('exporta COLLECTION_IMAGE_PIXEL_RATIO=2 — densidade real (retina) sobre o nó já em 1080px, não 3 (risco de canvas gigante em listas longas/celulares)',()=>{
    expect(component).toContain('export const COLLECTION_IMAGE_PIXEL_RATIO=2')
  })
  it('divisórias em px inteiros (crisp em qualquer pixelRatio inteiro, sem sub-pixel/serrilhado)',()=>{
    expect(css).toMatch(/border-bottom:2px solid #d8c9a3/)
    expect(css).toMatch(/border-bottom:1px solid #ece5d6/)
    expect(css).toMatch(/border-top:4px solid #c7a969/)
  })
})

describe('CollectionSummaryImageCard — invariantes de escrita (item "Invariantes obrigatórias")',()=>{
  it('componente é puramente visual: nenhum RPC, nenhuma chamada ao supabase, nenhum write, nenhum hook próprio (brand chega pronto — sem correr contra a captura de imagem)',()=>{
    for(const forbidden of ['supabase','registerCollectionPayment','logCollectionMessageCopied','sendCollectionMessage','.rpc(','useEffect','useState'])
      expect(component).not.toContain(forbidden)
  })
  it('nenhuma menção a estoque/físico/logística/Ruah em todo o componente ou seu CSS',()=>{
    for(const forbidden of ['inventory_items','inventory_movements','inventory_purchase_entries','inventory_allocations','physical_ml','operational_code','RUAH-P','shipment','preparation_batch','ruah'])
      expect((component+css).toLowerCase()).not.toContain(forbidden.toLowerCase())
  })
})

describe('OrganizationBrandMark — captura de imagem nunca corre contra um fetch assíncrono',()=>{
  it('a variante usada dentro de um card exportado recebe brand pronto (prop obrigatória), sem chamar useOrganizationBrand sozinha',()=>{
    const pureComponent=brandMark.slice(brandMark.indexOf('export function OrganizationBrandMark'),brandMark.indexOf('export function AutoOrganizationBrandMark'))
    expect(pureComponent).not.toContain('useOrganizationBrand()')
    expect(pureComponent).toContain('brand: OrganizationBrand }')
  })
  it('fallback é o logo neutro do próprio produto (/mugo-logo.png, já usado no rodapé do app), nunca uma marca de organização específica — nenhum src/alt fixo de uma organização',()=>{
    expect(brandMark).toContain("companyName: 'Mugô One'")
    expect(brandMark).not.toMatch(/src=["'/]ruah/i)
    expect(brandMark).not.toMatch(/alt=["']RUAH/i)
  })
})

describe('download-image.ts — geração 100% local, sem backend/upload/storage',()=>{
  it('usa html-to-image (toBlob) sobre o próprio nó do DOM — nada de canvas manual nem serviço externo',()=>{
    expect(downloadLib).toContain("from'html-to-image'")
    expect(downloadLib).toContain('toBlob(node,')
  })
  it('baixa localmente via Blob + <a download>, mesmo padrão já usado por exportCsv — nunca faz upload; link é limpo do DOM depois do click',()=>{
    expect(downloadLib).toContain('URL.createObjectURL(blob)')
    expect(downloadLib).toContain("link.download=name")
    expect(downloadLib).toContain('link.click()')
    expect(downloadLib).toContain('link.remove()')
    expect(downloadLib).toContain('URL.revokeObjectURL(url)')
  })
  it('pixelRatio é parametrizável e o padrão é uma densidade real (2), não 1 — a resolução física do PNG deve ser maior por padrão',()=>{
    expect(downloadLib).toContain('pixelRatio=2')
  })
  it('espera document.fonts.ready antes de capturar — evita fallback de fonte/inconsistência visual na exportação',()=>{
    const beforeToBlob=downloadLib.slice(0,downloadLib.indexOf('toBlob('))
    expect(beforeToBlob).toContain('await document.fonts.ready')
  })
  it('fundo explícito na captura é o off-white aprovado do card (EXPORT_BACKGROUND_COLOR=#faf6ee), nunca branco puro nem transparente',()=>{
    expect(downloadLib).toContain("export const EXPORT_BACKGROUND_COLOR='#faf6ee'")
    expect(downloadLib).toContain('backgroundColor:EXPORT_BACKGROUND_COLOR')
    expect(downloadLib).not.toContain("'#ffffff'")
  })
  it('revogação da blob URL é adiada (setTimeout), não imediata após o click — click síncrono seguido de revoke imediato pode cancelar o download em alguns navegadores',()=>{
    expect(downloadLib).toContain('setTimeout(()=>URL.revokeObjectURL(url)')
  })
  it('nunca chama supabase, faz fetch para o backend ou referencia bucket (o comentário do arquivo já documenta "sem storage" como propósito, não como código)',()=>{
    for(const forbidden of ['supabase','bucket','fetch('])
      expect(downloadLib.toLowerCase()).not.toContain(forbidden.toLowerCase())
  })
})
