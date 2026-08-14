import {context,json} from '../_shared/security.ts'

// Writes prose only. Every sentence in the input is already computed and
// worded by the frontend from persisted aggregates (buildAiImportSummarySentences);
// the model only combines them into one natural paragraph. It never sees a
// raw field name, JSON key or UUID, so it has nothing code-shaped to echo
// back into the paraphrase.
Deno.serve(async req=>{
  const ctx=await context(req,{allowSingleOrganizationFallback:true});if('response'in ctx)return ctx.response
  const sentences=ctx.body.sentences as unknown
  if(!Array.isArray(sentences)||sentences.length===0||sentences.some(s=>typeof s!=='string'))return json({error:{code:'invalid_payload',message:'Frases do resumo são obrigatórias.'}},400,req)
  const key=Deno.env.get('OPENAI_API_KEY')
  if(!key)return json({error:{code:'assistant_unavailable',message:'O resumo assistido não está disponível agora.'}},503,req)
  try{
    const response=await fetch('https://api.openai.com/v1/responses',{method:'POST',signal:AbortSignal.timeout(20_000),headers:{authorization:`Bearer ${key}`,'content-type':'application/json'},body:JSON.stringify({model:Deno.env.get('OPENAI_MODEL')||'gpt-5-mini',reasoning:{effort:'low'},input:[{role:'system',content:'Você recebe frases curtas em português, já corretas e prontas, descrevendo o resultado de uma importação de vendas. Combine-as em UM parágrafo natural e curto (máximo 4 frases), mantendo exatamente os números e fatos de cada frase. NÃO invente, some, arredonde ou recalcule nenhum número. NÃO use nomes de campos, códigos, identificadores ou qualquer termo técnico — apenas as frases fornecidas, reescritas de forma fluida.'},{role:'user',content:sentences.join('\n')}],text:{format:{type:'text'}}})})
    if(!response.ok)return json({error:{code:'assistant_failed',message:'Não foi possível gerar o resumo agora.'}},502,req)
    const body=await response.json(),text=body.output?.flatMap((x:Record<string,unknown>)=>Array.isArray(x.content)?x.content:[]).find((x:Record<string,unknown>)=>x.type==='output_text')?.text
    if(!text)return json({error:{code:'assistant_empty',message:'O resumo veio vazio.'}},502,req)
    return json({data:{summary:String(text).trim()}},200,req)
  }catch{
    return json({error:{code:'assistant_failed',message:'Não foi possível gerar o resumo agora.'}},502,req)
  }
})
