import {context,json} from '../_shared/security.ts'

Deno.serve(async req=>{
  const ctx=await context(req);if('response'in ctx)return ctx.response
  const text=String(ctx.body.text??'').trim().slice(0,8000)
  if(!text)return json({error:{code:'empty_text',message:'Cole a mensagem ou anotação da venda.'}},400,req)
  const key=Deno.env.get('OPENAI_API_KEY');if(!key)return json({error:{code:'assistant_unavailable',message:'O preenchimento assistido não está disponível agora.'}},503,req)
  const [{data:clients},{data:perfumes},{data:inventory}]=await Promise.all([
    ctx.client.from('clients').select('id,name,phone,whatsapp_phone,email,cpf,postal_code,address_line,address_number,complement,district,city,state').eq('organization_id',ctx.organizationId).is('deleted_at',null),
    ctx.client.from('perfumes').select('id,full_name_raw,normalized_name').eq('organization_id',ctx.organizationId),
    ctx.client.rpc('inventory_operational_rows',{org_id:ctx.organizationId}),
  ])
  const catalog=(perfumes??[]).map(p=>({id:p.id,name:p.full_name_raw,available_ml:Number((inventory??[]).find((i:Record<string,unknown>)=>i.perfume_id===p.id)?.available_ml??0)}))
  const response=await fetch('https://api.openai.com/v1/responses',{method:'POST',headers:{authorization:`Bearer ${key}`,'content-type':'application/json'},body:JSON.stringify({model:'gpt-5-mini',input:[{role:'system',content:'Extraia somente fatos explícitos de uma anotação de venda brasileira. Nunca invente. Use null para ausentes. Retorne JSON válido.'},{role:'user',content:text}],text:{format:{type:'json_schema',name:'sale_draft',strict:true,schema:{type:'object',additionalProperties:false,properties:{client_name:{type:['string','null']},perfume_query:{type:['string','null']},ml:{type:['number','null']},sale_type:{type:['string','null'],enum:['APC','SPLIT',null]},amount:{type:['number','null']},payment_status:{type:['string','null'],enum:['paid','pending','cancelled','unknown',null]},payment_method:{type:['string','null']},paid_at:{type:['string','null']},phone:{type:['string','null']},whatsapp:{type:['string','null']},cpf:{type:['string','null']},email:{type:['string','null']},postal_code:{type:['string','null']},address:{type:['string','null']},number:{type:['string','null']},complement:{type:['string','null']},district:{type:['string','null']},city:{type:['string','null']},state:{type:['string','null']},notes:{type:['string','null']}},required:['client_name','perfume_query','ml','sale_type','amount','payment_status','payment_method','paid_at','phone','whatsapp','cpf','email','postal_code','address','number','complement','district','city','state','notes']}}}})})
  if(!response.ok)return json({error:{code:'assistant_failed',message:'Não foi possível interpretar a anotação agora.'}},502,req)
  const body=await response.json(),raw=body.output?.flatMap((x:Record<string,unknown>)=>Array.isArray(x.content)?x.content:[]).find((x:Record<string,unknown>)=>x.type==='output_text')?.text
  const fields=JSON.parse(String(raw||'{}')),norm=(value:unknown)=>String(value??'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim()
  const clientMatches=(clients??[]).filter(c=>fields.client_name&&norm(c.name).includes(norm(fields.client_name))).slice(0,5)
  const perfumeMatches=catalog.filter(p=>fields.perfume_query&&norm(p.name).includes(norm(fields.perfume_query))).slice(0,8)
  return json({data:{fields,client_matches:clientMatches,perfume_matches:perfumeMatches},meta:{writes:0,requires_human_confirmation:true}},200,req)
})
