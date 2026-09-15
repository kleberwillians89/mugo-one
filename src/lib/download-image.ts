import{toBlob}from'html-to-image'

/** Fundo aprovado do card de cobrança (off-white) — usado como fallback explícito na exportação, nunca transparência nem branco puro, mesmo que algum navegador falhe em aplicar o CSS do nó a tempo. */
export const EXPORT_BACKGROUND_COLOR='#faf6ee'

/**
 * Rasteriza um nó do DOM já visível na tela (ainda que fora da área
 * visível — só precisa estar no layout) e baixa como PNG — sem upload,
 * sem backend, sem storage. pixelRatio multiplica a resolução FÍSICA do
 * PNG por cima do tamanho real do nó (ex.: nó de 1080px de largura com
 * pixelRatio=2 gera um PNG de 2160px) — o nó deve já estar no tamanho
 * real desejado; isto nunca substitui renderizar grande, só adiciona
 * densidade (equivalente a uma captura em tela retina).
 *
 * `await document.fonts.ready` roda antes da captura: sem isto, um peso
 * de fonte que ainda não tinha sido solicitado na página (ex.: Playfair
 * Display 600 se esta for a primeira tela a usá-lo) pode não estar
 * pronto no instante exato do toBlob, e o PNG sai com a fonte de
 * fallback do sistema — inconsistente com o que a tela mostrava.
 */
export async function renderNodeAsPngBlob(node:HTMLElement,pixelRatio=2){
 await document.fonts.ready
 const blob=await toBlob(node,{pixelRatio,backgroundColor:EXPORT_BACKGROUND_COLOR,cacheBust:true})
 if(!blob)throw new Error('Não foi possível gerar a imagem.')
 return blob
}

export async function downloadNodeAsPng(node:HTMLElement,name:string,pixelRatio=2){
 const blob=await renderNodeAsPngBlob(node,pixelRatio)
 const url=URL.createObjectURL(blob)
 const link=document.createElement('a')
 link.href=url
 link.download=name
 document.body.appendChild(link)
 link.click()
 link.remove()
 // Revoga em seguida, mas não no mesmo tick: alguns navegadores (Safari
 // incluído) cancelam o download se a blob URL for revogada antes de o
 // navegador terminar de iniciar a gravação do arquivo.
 setTimeout(()=>URL.revokeObjectURL(url),1000)
}
