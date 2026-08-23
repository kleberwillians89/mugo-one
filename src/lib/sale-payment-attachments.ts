import{supabase}from'./supabase'
import{authenticatedOrganization}from'./records'

export const SALE_ATTACHMENT_BUCKET='sale-payment-attachments',SALE_ATTACHMENT_MAX_BYTES=10*1024*1024
export type SalePaymentAttachment={id:string;sale_id:string;storage_path:string;original_file_name:string;mime_type:string;file_size:number;notes:string|null;uploaded_by:string|null;uploaded_by_name:string;created_at:string}
const allowed:Record<string,{mime:string;signature:(bytes:Uint8Array)=>boolean}>={
 pdf:{mime:'application/pdf',signature:b=>String.fromCharCode(...b.slice(0,5))==='%PDF-'},
 jpg:{mime:'image/jpeg',signature:b=>b[0]===0xff&&b[1]===0xd8&&b[2]===0xff},
 jpeg:{mime:'image/jpeg',signature:b=>b[0]===0xff&&b[1]===0xd8&&b[2]===0xff},
 png:{mime:'image/png',signature:b=>[0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a].every((v,i)=>b[i]===v)},
 webp:{mime:'image/webp',signature:b=>String.fromCharCode(...b.slice(0,4))==='RIFF'&&String.fromCharCode(...b.slice(8,12))==='WEBP'},
}
export async function validateSaleAttachment(file:File){
 if(!file.size||file.size>SALE_ATTACHMENT_MAX_BYTES)throw new Error(file.size>SALE_ATTACHMENT_MAX_BYTES?'O arquivo excede o limite de 10 MB.':'O arquivo está vazio.')
 const extension=file.name.split('.').pop()?.toLowerCase()??'',rule=allowed[extension]
 if(!rule||file.type!==rule.mime)throw new Error('Formato não permitido. Use PDF, JPG, PNG ou WEBP.')
 const bytes=new Uint8Array(await file.slice(0,16).arrayBuffer())
 if(!rule.signature(bytes))throw new Error('O conteúdo do arquivo não corresponde ao formato informado.')
 return{extension:extension==='jpeg'?'jpg':extension,mimeType:rule.mime}
}
export async function listSalePaymentAttachments(saleId:string){await authenticatedOrganization();const{data,error}=await supabase!.rpc('sale_payment_attachments_list',{p_sale_id:saleId});if(error)throw new Error(error.message);return(data??[])as SalePaymentAttachment[]}
export async function uploadSalePaymentAttachment(saleId:string,file:File,notes=''){
 await authenticatedOrganization();await validateSaleAttachment(file);const body=new FormData();body.set('sale_id',saleId);body.set('file',file);if(notes)body.set('notes',notes)
 const{data,error}=await supabase!.functions.invoke('sale-payment-attachment-upload',{body});if(error)throw new Error(error.message)
 if(data?.error)throw new Error(data.error.message)
 return data.data as SalePaymentAttachment
}
export async function saleAttachmentSignedUrl(attachment:SalePaymentAttachment,download=false){await authenticatedOrganization();const{data,error}=await supabase!.storage.from(SALE_ATTACHMENT_BUCKET).createSignedUrl(attachment.storage_path,60,download?{download:attachment.original_file_name}:undefined);if(error)throw new Error(error.message);return data.signedUrl}
export async function deleteSalePaymentAttachment(attachment:SalePaymentAttachment){await authenticatedOrganization();const{error}=await supabase!.rpc('sale_payment_attachment_delete',{p_attachment_id:attachment.id});if(error)throw new Error(error.message);await supabase!.storage.from(SALE_ATTACHMENT_BUCKET).remove([attachment.storage_path])}
