import {describe,expect,it,vi} from 'vitest'
import {looksLikePdf,officialPrintUrl,probeOfficialPrintFile,safeRedirectUrl} from '../../supabase/functions/_shared/superfrete-print'

const response=(body:string,status=200,headers:Record<string,string>={'content-type':'application/pdf'})=>new Response(body,{status,headers})

describe('saúde do arquivo oficial da SuperFrete',()=>{
  it('distingue URL ausente, inválida e origem não oficial',async()=>{
    expect((await probeOfficialPrintFile('')).reason).toBe('missing_url')
    expect((await probeOfficialPrintFile('não-é-url')).reason).toBe('invalid_url')
    expect((await probeOfficialPrintFile('https://evil.example/a.pdf')).reason).toBe('untrusted_source')
  })
  it('aceita hosts oficiais e rejeita domínios parecidos',()=>{
    expect(officialPrintUrl('https://etiqueta.superfrete.com/a')).not.toBeNull()
    expect(officialPrintUrl('https://cdn.superfrete.com/a')).not.toBeNull()
    expect(officialPrintUrl('https://superfrete.com.evil.example/a')).toBeNull()
  })
  it('aceita PDF por content-type, disposição ou assinatura binária',()=>{
    expect(looksLikePdf(new Headers({'content-type':'application/pdf'}),new Uint8Array())).toBe(true)
    expect(looksLikePdf(new Headers({'content-type':'application/octet-stream','content-disposition':'attachment; filename=label.pdf'}),new Uint8Array())).toBe(true)
    expect(looksLikePdf(new Headers({'content-type':'application/octet-stream'}),new TextEncoder().encode('%PDF-1.7'))).toBe(true)
  })
  it('não confunde HTML 200 com etiqueta',async()=>{
    const fetcher=vi.fn(async()=>response('<html>indisponível</html>',200,{'content-type':'text/html'})) as unknown as typeof fetch
    expect(await probeOfficialPrintFile('https://etiqueta.superfrete.com/a',fetcher)).toMatchObject({available:false,reason:'not_pdf',httpStatus:200})
  })
  it('aceita conteúdo PDF mesmo com cabeçalho genérico',async()=>{
    const fetcher=vi.fn(async()=>response('%PDF-1.7',200,{'content-type':'application/octet-stream'})) as unknown as typeof fetch
    expect(await probeOfficialPrintFile('https://etiqueta.superfrete.com/a',fetcher)).toMatchObject({available:true,reason:'ready'})
  })
  it('mantém indisponível em expiração HTTP e erro externo',async()=>{
    const expired=vi.fn(async()=>response('expired',403,{'content-type':'text/html'})) as unknown as typeof fetch
    const failed=vi.fn(async()=>{throw new Error('timeout')}) as unknown as typeof fetch
    expect(await probeOfficialPrintFile('https://etiqueta.superfrete.com/a',expired)).toMatchObject({available:false,httpStatus:403,reason:'not_pdf'})
    expect((await probeOfficialPrintFile('https://etiqueta.superfrete.com/a',failed)).reason).toBe('external_error')
  })
  it('bloqueia redirecionamento para rede local',()=>{
    expect(safeRedirectUrl('https://cdn.example.com/file.pdf')).toBe(true)
    expect(safeRedirectUrl('http://cdn.example.com/file.pdf')).toBe(false)
    expect(safeRedirectUrl('https://127.0.0.1/file.pdf')).toBe(false)
  })
})
