import{createClient}from'https://esm.sh/@supabase/supabase-js@2'
import{corsHeaders,json}from'./http.ts'

const max=10*1024*1024,rules:Record<string,{mime:string;valid:(b:Uint8Array)=>boolean}>={pdf:{mime:'application/pdf',valid:b=>new TextDecoder().decode(b.slice(0,5))==='%PDF-'},jpg:{mime:'image/jpeg',valid:b=>b[0]===255&&b[1]===216&&b[2]===255},jpeg:{mime:'image/jpeg',valid:b=>b[0]===255&&b[1]===216&&b[2]===255},png:{mime:'image/png',valid:b=>[137,80,78,71,13,10,26,10].every((v,i)=>b[i]===v)},webp:{mime:'image/webp',valid:b=>new TextDecoder().decode(b.slice(0,4))==='RIFF'&&new TextDecoder().decode(b.slice(8,12))==='WEBP'}}
Deno.serve(async req=>{
 if(req.method==='OPTIONS')return new Response(null,{status:204,headers:corsHeaders(req)})
 if(req.method!=='POST')return json({error:{code:'method_not_allowed',message:'Método não permitido.'}},405,req)
 const authorization=req.headers.get('authorization'),url=Deno.env.get('SUPABASE_URL'),anon=Deno.env.get('SUPABASE_ANON_KEY')
 if(!authorization?.startsWith('Bearer ')||!url||!anon)return json({error:{code:'unauthorized',message:'Autenticação necessária.'}},401,req)
 const client=createClient(url,anon,{global:{headers:{Authorization:authorization}}}),{data:{user}}=await client.auth.getUser()
 if(!user)return json({error:{code:'unauthorized',message:'Sessão inválida.'}},401,req)
 let form:FormData;try{form=await req.formData()}catch{return json({error:{code:'invalid_form',message:'Envio inválido.'}},400,req)}
 const file=form.get('file'),saleId=String(form.get('sale_id')??''),notes=String(form.get('notes')??'')
 if(!(file instanceof File)||!/^[0-9a-f-]{36}$/i.test(saleId))return json({error:{code:'invalid_input',message:'Venda e arquivo são obrigatórios.'}},400,req)
 if(!file.size||file.size>max)return json({error:{code:'invalid_file_size',message:'O arquivo deve ter no máximo 10 MB.'}},400,req)
 let extension=file.name.split('.').pop()?.toLowerCase()??'';const rule=rules[extension];if(extension==='jpeg')extension='jpg'
 const bytes=new Uint8Array(await file.slice(0,16).arrayBuffer())
 if(!rule||file.type!==rule.mime||!rule.valid(bytes))return json({error:{code:'file_type_not_allowed',message:'Formato ou conteúdo incompatível. Use PDF, JPG, PNG ou WEBP.'}},400,req)
 const id=crypto.randomUUID(),prepared=await client.rpc('sale_payment_attachment_prepare',{p_sale_id:saleId,p_attachment_id:id,p_extension:extension})
 if(prepared.error)return json({error:{code:'forbidden',message:prepared.error.message}},403,req)
 const path=String(prepared.data.storage_path),uploaded=await client.storage.from('sale-payment-attachments').upload(path,file,{contentType:rule.mime,upsert:false})
 if(uploaded.error)return json({error:{code:'upload_failed',message:'Não foi possível armazenar o comprovante.'}},502,req)
 const finalized=await client.rpc('sale_payment_attachment_finalize',{p_sale_id:saleId,p_attachment_id:id,p_storage_path:path,p_file_name:file.name,p_mime_type:rule.mime,p_file_size:file.size,p_notes:notes||null})
 if(finalized.error){await client.storage.from('sale-payment-attachments').remove([path]);return json({error:{code:'metadata_failed',message:'O arquivo não foi vinculado à venda; o upload foi desfeito.'}},500,req)}
 return json({data:finalized.data},201,req)
})
