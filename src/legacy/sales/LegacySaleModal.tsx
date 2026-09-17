import { FormEvent, useCallback, useState } from 'react'
import { Check, LoaderCircle, Plus, Sparkles, X } from 'lucide-react'
import { ClientModal } from '../../components/RecordModals'
import { DateField } from '../../components/DateField'
import { createSale, parseSaleAssistant, searchClients, searchPerfumes } from '../../lib/records'
import { parseBrazilianMoney } from '../../lib/importer'
import { Divider, EntityCombobox, EntityOption } from '../../components/ui'
import '../../components/RecordModals.css'

/**
 * Formulário legado de venda (perfume/frasco/ML/APC-SPLIT) — isolado
 * aqui (Fase F, ver docs/SALES_CATALOG_MIGRATION_PLAN.md). O botão
 * "Nova venda" ativo abre NewSaleModal (src/components/NewSaleModal.tsx),
 * não este. Preservado, não apagado: `source: 'manual'` continua
 * gravando em `public.sales` com `perfume_id` obrigatório, exatamente
 * como sempre gravou — só não é mais alcançável pela navegação normal.
 */

function Modal({ title, close, children }: { title:string; close:()=>void; children:React.ReactNode }) {
  return <div className="modal-layer" role="dialog" aria-modal="true" aria-label={title}><button className="modal-scrim" onClick={close} aria-label="Fechar"/><div className="modal-panel"><div className="modal-title"><div><span>MUGÔ ONE</span><h2>{title}</h2></div><button onClick={close}><X/></button></div>{children}</div></div>
}

export function LegacySaleModal({ close }: { close:()=>void }) {
  type ClientOption={id:string;name:string;phone:string|null;whatsapp_phone:string|null;email:string|null;cpf:string|null;postal_code:string|null;address_line:string|null;address_number:string|null;complement:string|null;district:string|null;city:string|null;state:string|null}
  const [client,setClient]=useState<ClientOption|null>(null),[clientOption,setClientOption]=useState<EntityOption|null>(null),[clientResults,setClientResults]=useState<ClientOption[]>([])
  const [date,setDate]=useState(''),[amount,setAmount]=useState(''),[status,setStatus]=useState('paid'),[method,setMethod]=useState('PIX'),[notes,setNotes]=useState('')
  const [paidAt,setPaidAt]=useState('')
  const [saleType,setSaleType]=useState<'APC'|'SPLIT'>('SPLIT'),[ml,setMl]=useState(''),[bottleNumber,setBottleNumber]=useState(''),[perfume,setPerfume]=useState<EntityOption|null>(null),[credit,setCredit]=useState('')
  const [saving,setSaving]=useState(false),[error,setError]=useState(''),[message,setMessage]=useState(''),[newClient,setNewClient]=useState(false)
  const [assistant,setAssistant]=useState(false),[assistantText,setAssistantText]=useState(''),[interpreting,setInterpreting]=useState(false),[perfumeAvailability,setPerfumeAvailability]=useState(new Map<string,number>()),[available,setAvailable]=useState<number|null>(null)
  const clientSearch=useCallback(async(term:string)=>{const rows=await searchClients(term) as ClientOption[];setClientResults(rows);return rows.map(row=>({id:row.id,label:row.name,description:[row.whatsapp_phone||row.phone?`WhatsApp final ${(row.whatsapp_phone||row.phone)!.replace(/\D/g,'').slice(-4)}`:'Sem WhatsApp',row.email?row.email.replace(/^(.{2}).*(@.*)$/,'$1•••$2'):'Sem e-mail'].join(' · ')}))},[])
  const perfumeSearch=useCallback(async(term:string)=>(await searchPerfumes(term)).map(row=>({id:row.id,label:row.full_name_raw,description:[row.brand_house,row.bottle_identifier].filter(Boolean).join(' · ')})),[])
  const interpret=async()=>{setInterpreting(true);setError('');try{const result=await parseSaleAssistant(assistantText),f=result.fields,matched=(result.client_matches[0] as ClientOption|undefined)??null,perfumeMatch=result.perfume_matches.length===1?result.perfume_matches[0]:null;setClient(matched);setClientOption(matched?{id:matched.id,label:matched.name}:null);setClientResults(result.client_matches as ClientOption[]);setMl(f.ml==null?'':String(f.ml));setAmount(f.amount==null?'':String(f.amount));if(f.sale_type)setSaleType(f.sale_type as 'APC'|'SPLIT');if(f.payment_status)setStatus(String(f.payment_status));if(f.payment_method)setMethod(String(f.payment_method));if(f.paid_at)setPaidAt(String(f.paid_at));setNotes(String(f.notes??''));setPerfumeAvailability(new Map(result.perfume_matches.map(item=>[item.id,item.available_ml])));setPerfume(perfumeMatch?{id:perfumeMatch.id,label:perfumeMatch.name}:null);setAvailable(perfumeMatch?.available_ml??null);setAssistant(false)}catch(reason){setError(reason instanceof Error?reason.message:'Não foi possível interpretar.')}finally{setInterpreting(false)}}
  const submit=async(e:FormEvent)=>{e.preventDefault();if(saving)return;const value=parseBrazilianMoney(amount),volume=parseBrazilianMoney(ml),creditValue=credit?parseBrazilianMoney(credit):null;if(!client)return setError('Selecione um cliente.');if(!date)return setError('Informe a data da venda.');if(!perfume)return setError('Selecione um perfume existente.');if(!/^[1-9]\d*$/.test(bottleNumber))return setError('Informe o número do frasco.');if(value===null||value<0)return setError('Informe um valor válido.');if(volume===null||volume<0)return setError('Informe um volume em ML válido.');if(credit&&creditValue===null)return setError('Informe um crédito válido.')
    setSaving(true);setError('');try{await createSale({clientId:client.id,date,amount:value,status,method,notes,perfumeId:perfume.id,saleType,volumeMl:volume,bottleNumber:Number(bottleNumber),paidAt,creditReferenceAmount:creditValue});setMessage('Venda salva e estoque reservado somente quando pago.');setTimeout(close,650)}catch(err){setError(err instanceof Error?err.message:'Falha ao salvar.')}finally{setSaving(false)}}
  return <>{assistant&&<Modal title="Preencher com IA" close={()=>setAssistant(false)}><div className="record-form"><p>Cole a mensagem, anotação ou pedido do cliente. Nada será salvo antes da sua revisão.</p><label className="field"><span>Texto para interpretar</span><textarea rows={9} value={assistantText} onChange={event=>setAssistantText(event.target.value)}/></label><div className="form-actions"><button onClick={()=>setAssistant(false)}>Cancelar</button><button className="primary" disabled={!assistantText.trim()||interpreting} onClick={interpret}>{interpreting?"Interpretando…":"INTERPRETAR E MOSTRAR PRÉVIA"}</button></div></div></Modal>}{newClient&&<ClientModal close={()=>setNewClient(false)} onSaved={(c)=>{setClient({...c,phone:null,whatsapp_phone:null,email:null,cpf:null,postal_code:null,address_line:null,address_number:null,complement:null,district:null,city:null,state:null});setClientOption({id:c.id,label:c.name});setNewClient(false)}}/>}<Modal title="Adicionar venda" close={close}><form onSubmit={submit} className="record-form">
    <div className="form-actions ai-fill-row"><button type="button" onClick={()=>setAssistant(true)}><Sparkles/> Preencher com IA</button><small>Cole a mensagem do pedido — a IA organiza os dados para você conferir antes de salvar.</small></div><div className="form-grid">
      <Divider label="Cliente"/>
      <div className="field wide"><EntityCombobox label="Cliente *" placeholder="Buscar cliente…" value={clientOption} search={clientSearch} onChange={option=>{setClientOption(option);setClient(option?clientResults.find(row=>row.id===option.id)??null:null)}}/><button className="entity-create-action" type="button" onClick={()=>setNewClient(true)}><Plus/> Criar cliente</button></div>
      {client&&<div className="client-context wide"><div><strong>Dados do cliente</strong><span>{client.whatsapp_phone||client.phone||'Sem telefone'} · {client.cpf||'CPF não informado'}</span><span>{[client.address_line,client.address_number,client.complement,client.district,client.city,client.state,client.postal_code].filter(Boolean).join(', ')||'Endereço não informado'}</span></div><button type="button" onClick={()=>window.open(`/clientes/${client.id}`,'_blank')}>Editar dados do cliente</button></div>}
      <Divider label="Produto"/>
      <DateField id="sale-date" label="Data da venda" value={date} onChange={setDate} required error={!date&&error?'Data obrigatória.':''}/>
      <div className="field wide"><EntityCombobox label="Perfume *" placeholder="Buscar perfume existente…" value={perfume} search={perfumeSearch} onChange={option=>{setPerfume(option);setAvailable(option?perfumeAvailability.get(option.id)??null:null)}}/></div>{available!==null&&<div className="client-context wide"><strong>Estoque operacional</strong><span>Disponível: {available} ml · Venda: {ml||"—"} ml</span></div>}
      <label className="field"><span>Tipo *</span><select value={saleType} onChange={(e)=>setSaleType(e.target.value as 'APC'|'SPLIT')}><option>APC</option><option>SPLIT</option></select></label>
      <Field label="ML *" value={ml} onChange={setMl} placeholder="Ex.: 10"/>
      <Field label="Número do frasco *" value={bottleNumber} onChange={value=>setBottleNumber(value.replace(/\D/g,''))} placeholder="Ex.: 1"/>
      <Field label="Valor *" value={amount} onChange={setAmount} placeholder="R$ 0,00"/>
      <Divider label="Pagamento"/>
      <label className="field"><span>Status do pagamento</span><select value={status} onChange={(e)=>setStatus(e.target.value)}><option value="paid">Pago</option><option value="pending">Aguardando</option><option value="cancelled">Cancelado</option><option value="unknown">Em revisão</option></select></label>
      <label className="field"><span>Forma de pagamento</span><select value={method} onChange={(e)=>setMethod(e.target.value)}><option>PIX</option><option>CARTÃO DE CRÉDITO</option><option>DEPÓSITO</option><option>CRÉDITO E PIX</option><option>OUTRO</option></select></label>
      <DateField id="paid-at" label="Data do pagamento" value={paidAt} onChange={setPaidAt}/>
      <Field label="Crédito (referência)" value={credit} onChange={setCredit} placeholder="R$ 0,00"/>
      <Divider label="Observações"/>
      <label className="field wide"><span>Observação</span><textarea value={notes} onChange={(e)=>setNotes(e.target.value)}/></label></div>
      <FormFeedback error={error} message={message}/><FormActions close={close} saving={saving} label="Salvar venda"/></form></Modal></>
}

function Field({label,value='',onChange,wide,type='text',placeholder,error}: {label:string;value?:string;onChange:(v:string)=>void;wide?:boolean;type?:string;placeholder?:string;error?:string}) {
  return <label className={`field ${wide?'wide':''} ${error?'field-invalid':''}`}><span>{label}</span><input aria-invalid={Boolean(error)} type={type} value={value} placeholder={placeholder} onChange={(e)=>onChange(e.target.value)}/>{error&&<small className="field-error">{error}</small>}</label>
}
function FormFeedback({error,message}:{error:string;message:string}) { return <>{error&&<div className="form-error">{error}</div>}{message&&<div className="form-success"><Check/> {message}</div>}</> }
function FormActions({close,saving,label}:{close:()=>void;saving:boolean;label:string}) { return <div className="form-actions"><button type="button" onClick={close}>Cancelar</button><button className="primary" disabled={saving}>{saving?<LoaderCircle className="spin"/>:<Check/>}{saving?'Salvando…':label}</button></div> }
