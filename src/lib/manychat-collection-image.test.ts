import{readFileSync}from'node:fs'
import{describe,expect,it}from'vitest'

const migration=readFileSync('supabase/migrations/202609150003_manychat_collection_images.sql','utf8')
const edge=readFileSync('supabase/functions/collection-image-upload/index.ts','utf8')
const records=readFileSync('src/lib/records.ts','utf8')
const page=readFileSync('src/pages/CobrancasPage.tsx','utf8')
const image=readFileSync('src/lib/download-image.ts','utf8')

describe('imagem da cobrança para ManyChat',()=>{
 it('usa bucket privado dedicado e URL assinada temporária',()=>{expect(migration).toContain("'collection-images','collection-images',false");expect(edge).toContain("createSignedUrl(path,7*24*60*60)");expect(edge).not.toContain('getPublicUrl')})
 it('valida sessão, tenant, sales.view, cliente e vendas pendentes antes do upload',()=>{for(const value of['organization_members','has_org_permission','sales.view','collections_pending_sales_operational','collection_changed'])expect(edge).toContain(value)})
 it('aceita somente PNG real e não expõe service role no frontend',()=>{expect(edge).toContain('[137,80,78,71,13,10,26,10]');expect(edge).toContain("file.type!=='image/png'");expect(records).not.toContain('SUPABASE_SERVICE_ROLE_KEY')})
 it('renderNodeAsPngBlob/uploadCollectionImage/collection-image-upload continuam existindo como infra dormente (categoria B — ver docs/ACTIVE_LEGACY_COLLECTIONS_AUDIT.md), mas CobrancasPage não os conecta mais entre si — o envio agora é texto puro pelo Communication Hub (sendCollectionMessage), o download de imagem usa downloadNodeAsPng (local, sem upload)',()=>{
  expect(image).toContain('renderNodeAsPngBlob')
  expect(records).toContain('export async function uploadCollectionImage')
  expect(page).not.toContain('renderNodeAsPngBlob')
  expect(page).not.toContain('uploadCollectionImage')
  expect(page).not.toContain('sendManychatMessage')
  expect(page).toContain('downloadNodeAsPng(nodeRef.current')
  expect(page).toContain('sendCollectionMessage(')
 })
})
