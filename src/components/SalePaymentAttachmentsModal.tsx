import{useEffect,useRef,useState}from'react'
import{Download,Eye,FileText,Paperclip,Trash2,Upload}from'lucide-react'
import{Modal,useToast}from'./ui'
import{deleteSalePaymentAttachment,listSalePaymentAttachments,saleAttachmentSignedUrl,SalePaymentAttachment,uploadSalePaymentAttachment}from'../lib/sale-payment-attachments'
import{dateTime,shortDate}from'../lib/format'
import'./SalePaymentAttachmentsModal.css'

type SaleSummary={id:string;client_name:string;sale_date:string;perfume_name:string|null;amount:number;payment_status:string}
const bytes=(value:number)=>value>=1024*1024?`${(value/1024/1024).toFixed(1)} MB`:`${Math.ceil(value/1024)} KB`
const type=(mime:string)=>mime==='application/pdf'?'PDF':mime.split('/')[1]?.toUpperCase()??'ARQUIVO'
export function SalePaymentAttachmentsModal({sale,canManage,onClose,onCount}:{sale:SaleSummary;canManage:boolean;onClose:()=>void;onCount:(count:number)=>void}){
 const toast=useToast(),input=useRef<HTMLInputElement>(null),[items,setItems]=useState<SalePaymentAttachment[]>([]),[loading,setLoading]=useState(true),[uploading,setUploading]=useState(false),[preview,setPreview]=useState<{url:string;item:SalePaymentAttachment}|null>(null)
 const load=async()=>{setLoading(true);try{const next=await listSalePaymentAttachments(sale.id);setItems(next);onCount(next.length)}catch(reason){toast.push(reason instanceof Error?reason.message:'Não foi possível carregar os comprovantes.',{tone:'error'})}finally{setLoading(false)}}
 useEffect(()=>{let live=true;listSalePaymentAttachments(sale.id).then(next=>{if(live){setItems(next);onCount(next.length)}}).catch(reason=>{if(live)toast.push(reason instanceof Error?reason.message:'Não foi possível carregar os comprovantes.',{tone:'error'})}).finally(()=>{if(live)setLoading(false)});return()=>{live=false}},[onCount,sale.id,toast])
 const upload=async(file?:File)=>{if(!file||uploading)return;setUploading(true);try{await uploadSalePaymentAttachment(sale.id,file);toast.push('Comprovante anexado.',{tone:'success'});await load()}catch(reason){toast.push(reason instanceof Error?reason.message:'Não foi possível anexar.',{tone:'error'})}finally{setUploading(false);if(input.current)input.current.value=''}}
 const view=async(item:SalePaymentAttachment)=>{try{setPreview({item,url:await saleAttachmentSignedUrl(item)})}catch(reason){toast.push(reason instanceof Error?reason.message:'Não foi possível visualizar.',{tone:'error'})}}
 const download=async(item:SalePaymentAttachment)=>{try{const anchor=document.createElement('a');anchor.href=await saleAttachmentSignedUrl(item,true);anchor.download=item.original_file_name;anchor.rel='noopener';anchor.click()}catch(reason){toast.push(reason instanceof Error?reason.message:'Não foi possível baixar.',{tone:'error'})}}
 const remove=async(item:SalePaymentAttachment)=>{if(!confirm('Excluir este comprovante?'))return;try{await deleteSalePaymentAttachment(item);setItems(current=>{const next=current.filter(value=>value.id!==item.id);onCount(next.length);return next});if(preview?.item.id===item.id)setPreview(null);toast.push('Comprovante excluído.',{tone:'success'})}catch(reason){toast.push(reason instanceof Error?reason.message:'Não foi possível excluir.',{tone:'error'})}}
 return <Modal open onClose={onClose} eyebrow="DAVI EXCEL" title="Comprovantes da venda" size="lg">
  <div className="sale-attachments">
   <header><div><span>CLIENTE</span><strong>{sale.client_name}</strong></div><div><span>DATA</span><strong>{shortDate(sale.sale_date)}</strong></div><div><span>PERFUME</span><strong>{sale.perfume_name??'—'}</strong></div><div><span>VALOR</span><strong>{sale.amount.toLocaleString('pt-BR',{style:'currency',currency:'BRL'})}</strong></div><div><span>PAGAMENTO</span><strong>{sale.payment_status==='paid'?'PAGO':sale.payment_status.toUpperCase()}</strong></div></header>
   {canManage&&<><input ref={input} className="sale-attachment-input" type="file" accept="application/pdf,image/jpeg,image/png,image/webp" capture="environment" onChange={event=>void upload(event.target.files?.[0])}/><button className="sale-attachment-upload" disabled={uploading} onClick={()=>input.current?.click()}><Upload/> {uploading?'ENVIANDO…':'+ ANEXAR COMPROVANTE'}</button><small>PDF, JPG, PNG ou WEBP · máximo 10 MB</small></>}
   <div className="sale-attachment-list" aria-busy={loading}>{!loading&&!items.length&&<p><Paperclip/> Nenhum comprovante anexado.</p>}{items.map(item=><article key={item.id} data-attachment-id={item.id}><FileText/><div><strong>{item.original_file_name}</strong><span>{type(item.mime_type)} · {bytes(item.file_size)}</span><time>{dateTime(item.created_at)}</time><small>Enviado por {item.uploaded_by_name}</small></div><footer><button onClick={()=>void view(item)}><Eye/>VISUALIZAR</button><button onClick={()=>void download(item)}><Download/>BAIXAR</button>{canManage&&<button className="danger" onClick={()=>void remove(item)}><Trash2/>EXCLUIR</button>}</footer></article>)}</div>
   {preview&&<section className="sale-attachment-preview"><strong>PRÉVIA — {preview.item.original_file_name}</strong>{preview.item.mime_type==='application/pdf'?<iframe title={`Prévia de ${preview.item.original_file_name}`} src={preview.url}/>:<img alt={`Prévia de ${preview.item.original_file_name}`} src={preview.url}/>}<button onClick={()=>setPreview(null)}>FECHAR PRÉVIA</button></section>}
  </div>
 </Modal>
}
