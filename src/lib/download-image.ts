import{toBlob}from'html-to-image'

/** Rasteriza um nó do DOM já visível na tela e baixa como PNG — sem upload, sem backend, sem storage. pixelRatio permite exportar em resolução maior que o tamanho exibido na tela (ex.: card de 480px de largura exportado a 1080px). */
export async function downloadNodeAsPng(node:HTMLElement,name:string,pixelRatio=1){
 const blob=await toBlob(node,{pixelRatio,backgroundColor:'#ffffff',cacheBust:true})
 if(!blob)throw new Error('Não foi possível gerar a imagem.')
 const url=URL.createObjectURL(blob)
 const link=document.createElement('a')
 link.href=url
 link.download=name
 link.click()
 URL.revokeObjectURL(url)
}
