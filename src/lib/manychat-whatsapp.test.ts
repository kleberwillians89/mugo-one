import{readFileSync}from'node:fs'
import{describe,expect,it,vi}from'vitest'
import{constantTimeEqual,formatBrl,normalizeBrazilianPhone,sendManychatFlow,withInFlightKey}from'../../supabase/functions/_shared/manychat'

const migration=readFileSync(new URL('../../supabase/migrations/202609030002_manychat_whatsapp_mvp.sql',import.meta.url),'utf8')
const sendEdge=readFileSync(new URL('../../supabase/functions/manychat-send/index.ts',import.meta.url),'utf8')
const balanceEdge=readFileSync(new URL('../../supabase/functions/whatsapp-customer-balance/index.ts',import.meta.url),'utf8')
const records=readFileSync(new URL('./records.ts',import.meta.url),'utf8')
const collections=readFileSync(new URL('../pages/CobrancasPage.tsx',import.meta.url),'utf8')
const clientDetails=readFileSync(new URL('../pages/ClientDetailsPage.tsx',import.meta.url),'utf8')
const config=readFileSync(new URL('../../supabase/config.toml',import.meta.url),'utf8')
const response=(status:number,body:unknown)=>new Response(JSON.stringify(body),{status,headers:{'content-type':'application/json'}})

describe('ManyChat send — contrato oficial e telefone',()=>{
  it('normaliza telefone brasileiro para E.164 e recusa formato inválido',()=>{
    expect(normalizeBrazilianPhone('(11) 99999-9999')).toBe('+5511999999999')
    expect(normalizeBrazilianPhone('+55 11 99999-9999')).toBe('+5511999999999')
    expect(normalizeBrazilianPhone('123')).toBeNull()
  })
  it('localiza contato por phone e inicia sendFlow com subscriber_id + flow_ns',async()=>{
    const fetcher=vi.fn().mockResolvedValueOnce(response(200,{status:'success',data:{id:'123'}})).mockResolvedValueOnce(response(200,{status:'success'}))
    await expect(sendManychatFlow({apiKey:'secret',flowNs:'content123',phone:'11999999999',name:'Larissa Silva',fetcher})).resolves.toMatchObject({subscriber_id:'123'})
    expect(String(fetcher.mock.calls[0][0])).toContain('/fb/subscriber/findBySystemField?phone=%2B5511999999999')
    expect(String(fetcher.mock.calls[1][0])).toBe('https://api.manychat.com/fb/sending/sendFlow')
    expect(JSON.parse(String(fetcher.mock.calls[1][1]?.body))).toEqual({subscriber_id:123,flow_ns:'content123'})
  })
  it('cria contato WhatsApp quando a busca confirma ausência e depois inicia o flow',async()=>{
    const fetcher=vi.fn().mockResolvedValueOnce(response(404,{status:'error',message:'Subscriber not found'})).mockResolvedValueOnce(response(200,{status:'success',data:[]})).mockResolvedValueOnce(response(200,{status:'success',data:{id:'456'}})).mockResolvedValueOnce(response(200,{status:'success'}))
    await sendManychatFlow({apiKey:'secret',flowNs:'access',phone:'11999999999',name:'Maria da Silva',fetcher})
    expect(String(fetcher.mock.calls[2][0])).toBe('https://api.manychat.com/fb/subscriber/createSubscriber')
    expect(JSON.parse(String(fetcher.mock.calls[2][1]?.body))).toEqual({first_name:'Maria',last_name:'da Silva',whatsapp_phone:'+5511999999999'})
  })
  it('trata data vazio com HTTP 200 como contato ausente e cria o contato WhatsApp',async()=>{
    const fetcher=vi.fn().mockResolvedValueOnce(response(200,{status:'success',data:[]})).mockResolvedValueOnce(response(200,{status:'success',data:[]})).mockResolvedValueOnce(response(200,{status:'success',data:{id:'789'}})).mockResolvedValueOnce(response(200,{status:'success'}))
    await expect(sendManychatFlow({apiKey:'secret',flowNs:'collection',phone:'11999999999',name:'Adriana Rezende',fetcher})).resolves.toMatchObject({subscriber_id:'789'})
    expect(String(fetcher.mock.calls[2][0])).toBe('https://api.manychat.com/fb/subscriber/createSubscriber')
  })
  it('recupera contato WhatsApp existente por nome e confirma o telefone exato antes de enviar',async()=>{
    const fetcher=vi.fn().mockResolvedValueOnce(response(200,{status:'success',data:[]})).mockResolvedValueOnce(response(200,{status:'success',data:[{id:'654',whatsapp_phone:'+5511999999999'}]})).mockResolvedValueOnce(response(200,{status:'success'}))
    await expect(sendManychatFlow({apiKey:'secret',flowNs:'collection',phone:'11999999999',name:'Adriana Rezende',fetcher})).resolves.toMatchObject({subscriber_id:'654'})
    expect(String(fetcher.mock.calls[1][0])).toContain('/fb/subscriber/findByName?name=Adriana%20Rezende')
    expect(fetcher).toHaveBeenCalledTimes(3)
  })
  it('aceita resposta de contato em lista quando o ManyChat a devolve nesse formato',async()=>{
    const fetcher=vi.fn().mockResolvedValueOnce(response(200,{status:'success',data:[{id:'987'}]})).mockResolvedValueOnce(response(200,{status:'success'}))
    await expect(sendManychatFlow({apiKey:'secret',flowNs:'collection',phone:'11999999999',name:'Adriana Rezende',fetcher})).resolves.toMatchObject({subscriber_id:'987'})
    expect(fetcher).toHaveBeenCalledTimes(2)
  })
  it('mapeia ManyChat indisponível e token inválido para erros controlados',async()=>{
    await expect(sendManychatFlow({apiKey:'x',flowNs:'x',phone:'11999999999',name:'A',fetcher:vi.fn().mockRejectedValue(new Error('offline'))})).rejects.toMatchObject({code:'manychat_unavailable',httpStatus:503})
    await expect(sendManychatFlow({apiKey:'x',flowNs:'x',phone:'11999999999',name:'A',fetcher:vi.fn().mockResolvedValue(response(401,{status:'error'}))})).rejects.toMatchObject({code:'manychat_token_invalid'})
  })
  it('preserva status e motivo sanitizado quando o ManyChat recusa iniciar o fluxo',async()=>{
    const fetcher=vi.fn().mockResolvedValueOnce(response(200,{status:'success',data:{id:'123'}})).mockResolvedValueOnce(response(400,{status:'error',message:'Validation error for cliente@example.com +5511999999999'})).mockResolvedValueOnce(response(200,{status:'success',data:{flows:[{ns:'incorreto'}]}}))
    await expect(sendManychatFlow({apiKey:'x',flowNs:'incorreto',phone:'11999999999',name:'Cliente',fetcher})).rejects.toMatchObject({code:'manychat_send_failed',providerStatus:400,providerReason:'Validation error for [email] [telefone]'})
  })
  it('distingue flow_ns inexistente de outra recusa do sendFlow',async()=>{
    const fetcher=vi.fn().mockResolvedValueOnce(response(200,{status:'success',data:{id:'123'}})).mockResolvedValueOnce(response(400,{status:'error',message:'Validation error'})).mockResolvedValueOnce(response(200,{status:'success',data:{flows:[{ns:'outro-flow'}]}}))
    await expect(sendManychatFlow({apiKey:'x',flowNs:'incorreto',phone:'11999999999',name:'Cliente',fetcher})).rejects.toMatchObject({code:'manychat_flow_not_found',httpStatus:422})
  })
  it('não transforma erro 400 desconhecido em criação de contato',async()=>{
    const fetcher=vi.fn().mockResolvedValue(response(400,{status:'error',message:'Invalid phone'}))
    await expect(sendManychatFlow({apiKey:'x',flowNs:'x',phone:'11999999999',name:'A',fetcher})).rejects.toMatchObject({code:'manychat_lookup_failed'})
    expect(fetcher).toHaveBeenCalledTimes(1)
  })
  it('coalesce cliques simultâneos para a mesma chave',async()=>{
    let release!:()=>void;const pending=new Promise<void>(resolve=>{release=resolve}),operation=vi.fn(async()=>{await pending;return'sent'})
    const first=withInFlightKey('client:collection',operation),second=withInFlightKey('client:collection',operation)
    expect(operation).toHaveBeenCalledTimes(1);release();await expect(Promise.all([first,second])).resolves.toEqual(['sent','sent'])
  })
})

describe('manychat-send — fronteira segura CRM → ManyChat',()=>{
  it('frontend envia somente client_id e message_type; nunca tenant, key, telefone ou valor',()=>{
    const call=records.slice(records.indexOf('export async function sendManychatMessage'),records.indexOf('export type CustomerIdentityReview'))
    expect(call).toContain("functions.invoke('manychat-send'")
    expect(call).toContain('body:{client_id:clientId,message_type:messageType}')
    expect(call).not.toContain('organization_id')
    expect(call).not.toMatch(/api.?key|phone|amount|total/i)
  })
  it('backend exige sessão, permissão, cliente do tenant, telefone único e secrets backend',()=>{
    expect(sendEdge).toContain('await context(req,{allowSingleOrganizationFallback:true})')
    expect(sendEdge).toContain("messageType==='collection'?'sales.view':'clients.view'")
    expect(sendEdge).toContain(".eq('organization_id',ctx.organizationId)")
    expect(sendEdge).toContain("code:'ambiguous_phone'")
    expect(sendEdge).toContain('matchedIds.size!==1||!matchedIds.has(clientId)')
    for(const secret of ['MANYCHAT_API_KEY','MANYCHAT_COLLECTION_FLOW_ID','MANYCHAT_ACCESS_FLOW_ID'])expect(sendEdge).toContain(secret)
  })
  it('cobrança e ativação usam flow separado sem tocar pagamento ou estoque',()=>{
    expect(sendEdge).toContain("Deno.env.get(messageType==='collection'?'MANYCHAT_COLLECTION_FLOW_ID':'MANYCHAT_ACCESS_FLOW_ID')")
    expect(sendEdge).not.toMatch(/payment_status|paid_at|inventory_|stock|estoque/i)
  })
  it('devolve diagnóstico seguro quando o provedor recusa o fluxo',()=>{
    expect(sendEdge).toContain('provider_status:providerStatus')
    expect(sendEdge).toContain('provider_reason:providerReason')
    expect(sendEdge).toContain('O flow_ns existe; confira se a automação está publicada')
  })
})

describe('balance — mesma fonte canônica da CobrancasPage',()=>{
  it('a regra pending existe uma vez na função canônica e tela/balance consomem essa função',()=>{
    const sql=migration.split('\n').map(line=>line.replace(/--.*$/,'')).join('\n')
    expect((sql.match(/payment_status='pending'/g)??[])).toHaveLength(1)
    expect((sql.match(/collections_pending_sales_canonical\(/g)??[]).length).toBeGreaterThanOrEqual(3)
    expect(migration).toContain("from public.collections_pending_sales_canonical(p_organization_id) pending")
  })
  it('telefone inexistente e duplicado têm resultados controlados',()=>{
    expect(migration).toContain("return jsonb_build_object('status','not_found')")
    expect(migration).toContain("return jsonb_build_object('status','ambiguous')")
    expect(balanceEdge).toContain("data?.status==='not_found'")
    expect(balanceEdge).toContain("data?.status==='ambiguous'")
  })
  it('cliente sem cobrança retorna count 0 e total 0 pela agregação coalesce',()=>{
    expect(migration).toContain("select count(*)::integer,coalesce(sum(pending.amount),0)")
  })
  it('secret ausente/incorreto é recusado e JWT público só é desligado neste webhook autenticado por secret próprio',()=>{
    expect(constantTimeEqual('correto','correto')).toBe(true)
    expect(constantTimeEqual('correto','errado')).toBe(false)
    expect(balanceEdge).toContain("Deno.env.get('MANYCHAT_RUAH_WEBHOOK_SECRET')")
    expect(balanceEdge).toContain("req.headers.get('x-ruah-webhook-secret')")
    expect(config).toContain('[functions.whatsapp-customer-balance]\nverify_jwt = false')
  })
  it('resposta é mínima e formata BRL exatamente',()=>{
    expect(formatBrl(12323.3)).toBe('R$ 12.323,30')
    expect(balanceEdge).toContain("{ok:true,customer_name:firstName")
    for(const forbidden of ['cpf','address','email','inventory','client_id'])expect(balanceEdge.toLowerCase()).not.toContain(forbidden)
  })
  it('RPC do saldo é service_role-only e tenant vem do backend',()=>{
    expect(migration).toContain('revoke all on function public.whatsapp_customer_balance_v1(uuid,text) from public,anon,authenticated')
    expect(migration).toContain('grant execute on function public.whatsapp_customer_balance_v1(uuid,text) to service_role')
    expect(balanceEdge).toContain("Deno.env.get('RUAH_ORGANIZATION_ID')")
  })
})

describe('UX mínima',()=>{
  it('Cobranças oferece ENVIAR WHATSAPP com enviando, sucesso e trava de clique',()=>{
    for(const text of ['ENVIAR WHATSAPP','ENVIANDO...','WHATSAPP ENVIADO'])expect(collections).toContain(text)
    expect(collections).toContain("sendManychatMessage(group.client_id,'collection')")
    expect(collections).toContain('disabled={Boolean(whatsappSending)||whatsappSent.has(group.client_id)}')
  })
  it('Cliente 360 oferece ENVIAR ACESSO WHATSAPP com os mesmos estados',()=>{
    expect(clientDetails).toContain('ENVIAR ACESSO WHATSAPP')
    expect(clientDetails).toContain("sendManychatMessage(clientId,'access')")
    expect(clientDetails).toContain('disabled={accessSending||accessSent}')
  })
})
