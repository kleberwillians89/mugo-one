import {context,json} from '../_shared/security.ts'

// Writes prose only. Every number in the input is already computed by
// confirm_ai_sales_batch_multi / confirm_ai_sales_batch and persisted; the
// model must restate them, never recompute or invent new ones.
Deno.serve(async req=>{
  const ctx=await context(req,{allowSingleOrganizationFallback:true});if('response'in ctx)return ctx.response
  const aggregates=ctx.body.aggregates as Record<string,unknown>|undefined
  if(!aggregates||typeof aggregates!=='object')return json({error:{code:'invalid_payload',message:'Aggregates são obrigatórios.'}},400,req)
  const key=Deno.env.get('OPENAI_API_KEY')
  if(!key)return json({error:{code:'assistant_unavailable',message:'O resumo assistido não está disponível agora.'}},503,req)
  try{
    const response=await fetch('https://api.openai.com/v1/responses',{method:'POST',signal:AbortSignal.timeout(20_000),headers:{authorization:`Bearer ${key}`,'content-type':'application/json'},body:JSON.stringify({model:Deno.env.get('OPENAI_MODEL')||'gpt-5-mini',reasoning:{effort:'low'},input:[{role:'system',content:'Você recebe agregados JÁ CALCULADOS de uma importação de vendas concluída. Escreva um parágrafo curto em português (máximo 4 frases) resumindo o resultado. Use SOMENTE os números fornecidos, exatamente como estão — nunca some, arredonde diferente, recalcule ou invente qualquer valor. Não mencione tecnicalidades de banco de dados.'},{role:'user',content:JSON.stringify(aggregates)}],text:{format:{type:'text'}}})})
    if(!response.ok)return json({error:{code:'assistant_failed',message:'Não foi possível gerar o resumo agora.'}},502,req)
    const body=await response.json(),text=body.output?.flatMap((x:Record<string,unknown>)=>Array.isArray(x.content)?x.content:[]).find((x:Record<string,unknown>)=>x.type==='output_text')?.text
    if(!text)return json({error:{code:'assistant_empty',message:'O resumo veio vazio.'}},502,req)
    return json({data:{summary:String(text).trim()}},200,req)
  }catch{
    return json({error:{code:'assistant_failed',message:'Não foi possível gerar o resumo agora.'}},502,req)
  }
})
