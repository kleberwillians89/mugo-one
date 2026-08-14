import { FormEvent, useEffect, useState } from 'react'
import { Check, LoaderCircle, Plus, Search, Sparkles, X } from 'lucide-react'
import { DateField } from './DateField'
import { ClientInput, createClient, createSale, parseSaleAssistant, searchClients, updateClient } from '../lib/records'
import { parseBrazilianMoney } from '../lib/importer'
import { Divider } from './ui'
import './RecordModals.css'

const maskPhone = (v:string)=>v.replace(/\D/g,'').slice(0,11).replace(/^(\d{2})(\d)/,'($1) $2').replace(/(\d{5})(\d)/,'$1-$2')
const maskCpf = (v:string)=>v.replace(/\D/g,'').slice(0,11).replace(/(\d{3})(\d)/,'$1.$2').replace(/(\d{3})(\d)/,'$1.$2').replace(/(\d{3})(\d{1,2})$/,'$1-$2')
const maskCep = (v:string)=>v.replace(/\D/g,'').slice(0,8).replace(/(\d{5})(\d)/,'$1-$2')

function Modal({ title, close, children }: { title:string; close:()=>void; children:React.ReactNode }) {
  return <div className="modal-layer" role="dialog" aria-modal="true" aria-label={title}><button className="modal-scrim" onClick={close} aria-label="Fechar"/><div className="modal-panel"><div className="modal-title"><div><span>RUAH PARFUMS</span><h2>{title}</h2></div><button onClick={close}><X/></button></div>{children}</div></div>
}

export function ClientModal({ close, onSaved, clientId, initial }: { close:()=>void; onSaved?: (client:{id:string;name:string})=>void;clientId?:string;initial?:Partial<ClientInput> }) {
  const [form,setForm]=useState<ClientInput>({name:initial?.name??'',status:initial?.status??'active',...initial})
  const [birth,setBirth]=useState(initial?.birthDate??''),[saving,setSaving]=useState(false),[message,setMessage]=useState(''),[error,setError]=useState('')
  const set=(key:keyof ClientInput,value:string)=>setForm((x)=>({...x,[key]:value}))
  const digits=(value?:string)=>String(value??'').replace(/\D/g,''),shippingValues=[form.name,form.cpf,form.phone||form.whatsappPhone,form.postalCode,form.address,form.addressNumber,form.district,form.city,form.state],shippingLabels=['Nome','CPF/CNPJ','Telefone','CEP','Endereço','Número','Bairro','Cidade','UF'],missing=shippingLabels.filter((_,index)=>!String(shippingValues[index]??'').trim()),completed=shippingLabels.length-missing.length
  const validation={cpf:form.cpf&&![11,14].includes(digits(form.cpf).length)?'CPF/CNPJ inválido.':'',phone:(form.phone||form.whatsappPhone)&&digits(form.phone||form.whatsappPhone).length<10?'Telefone incompleto.':'',postalCode:form.postalCode&&digits(form.postalCode).length!==8?'CEP incompleto.':'',state:form.state&&form.state.length!==2?'UF inválida.':''}
  const submit=async(e:FormEvent)=>{e.preventDefault();setError('');if(!form.name.trim())return setError('Informe o nome completo.');if(Object.values(validation).some(Boolean))return setError('Corrija os campos inválidos antes de salvar.')
    setSaving(true);try{const input={...form,birthDate:birth};const data=clientId?await updateClient(clientId,input):await createClient(input);setMessage('Cliente salvo com sucesso.');onSaved?.(data as {id:string;name:string});setTimeout(close,650)}catch(err){setError(err instanceof Error?err.message:'Falha ao salvar.')}finally{setSaving(false)}}
  return <Modal title={clientId?'Editar cliente':'Adicionar cliente'} close={close}><form onSubmit={submit} className="record-form">
    <div className="shipping-form-intro"><strong>DADOS NECESSÁRIOS PARA ENVIO</strong><span>Preencha todos os campos obrigatórios abaixo. Essas informações são necessárias para calcular o frete e emitir a etiqueta.</span><small>* Campos obrigatórios · Complemento é opcional.</small><b className={missing.length?'':'ready'}>{missing.length?`${completed} de ${shippingLabels.length} campos obrigatórios preenchidos`:'✓ Cadastro pronto para envio'}</b>{missing.length>0&&<p>Falta: {missing.join(', ')}.</p>}</div>
    <div className="form-grid">
      <Divider label="Identificação"/>
      <Field label="Nome completo *" value={form.name} onChange={(v)=>set('name',v)} wide/>
      <label className="field"><span>Status</span><select value={form.status} onChange={(e)=>set('status',e.target.value)}><option value="active">Ativo</option><option value="inactive">Inativo</option><option value="review">Em revisão</option></select></label>
      <DateField id="birth-date" label="Data de nascimento" value={birth} onChange={setBirth}/>
      <Divider label="Contato"/>
      <Field label="Telefone *" value={form.phone} onChange={(v)=>set('phone',maskPhone(v))} error={validation.phone}/><Field label="E-mail" type="email" value={form.email} onChange={(v)=>set('email',v)}/>
      <Field label="WhatsApp" value={form.whatsappPhone} onChange={(v)=>set('whatsappPhone',maskPhone(v))}/>
      <Field label="Instagram" value={form.instagram} onChange={(v)=>set('instagram',v)}/>
      <Divider label="Documentos"/>
      <Field label="CPF/CNPJ *" value={form.cpf} onChange={(v)=>set('cpf',maskCpf(v))} error={validation.cpf}/>
      <Divider label="Endereço"/>
      <Field label="CEP *" value={form.postalCode} onChange={(v)=>set('postalCode',maskCep(v))} error={validation.postalCode}/>
      <Field label="Endereço *" value={form.address} onChange={(v)=>set('address',v)} wide/><Field label="Número *" value={form.addressNumber} onChange={(v)=>set('addressNumber',v)}/>
      <Field label="Complemento (opcional)" value={form.complement} onChange={(v)=>set('complement',v)}/><Field label="Bairro *" value={form.district} onChange={(v)=>set('district',v)}/>
      <Field label="Cidade *" value={form.city} onChange={(v)=>set('city',v)}/><Field label="UF *" value={form.state} onChange={(v)=>set('state',v.toUpperCase().slice(0,2))} error={validation.state}/>
      <Divider label="Observações"/>
      <label className="field wide"><span>Observações</span><textarea value={form.notes??''} onChange={(e)=>set('notes',e.target.value)}/></label>
    </div><FormFeedback error={error} message={message}/><FormActions close={close} saving={saving} label="Salvar cliente"/></form></Modal>
}

export function SaleModal({ close }: { close:()=>void }) {
  type ClientOption={id:string;name:string;phone:string|null;whatsapp_phone:string|null;email:string|null;cpf:string|null;postal_code:string|null;address_line:string|null;address_number:string|null;complement:string|null;district:string|null;city:string|null;state:string|null}
  const [query,setQuery]=useState(''),[clients,setClients]=useState<ClientOption[]>([]),[client,setClient]=useState<ClientOption|null>(null)
  const [date,setDate]=useState(''),[amount,setAmount]=useState(''),[status,setStatus]=useState('paid'),[method,setMethod]=useState('PIX'),[notes,setNotes]=useState('')
  const [paidAt,setPaidAt]=useState('')
  const [saleType,setSaleType]=useState<'APC'|'SPLIT'>('SPLIT'),[ml,setMl]=useState(''),[perfume,setPerfume]=useState(''),[credit,setCredit]=useState('')
  const [saving,setSaving]=useState(false),[error,setError]=useState(''),[message,setMessage]=useState(''),[newClient,setNewClient]=useState(false)
  const [assistant,setAssistant]=useState(false),[assistantText,setAssistantText]=useState(''),[interpreting,setInterpreting]=useState(false),[perfumeMatches,setPerfumeMatches]=useState<{id:string;name:string;available_ml:number}[]>([]),[available,setAvailable]=useState<number|null>(null)
  useEffect(()=>{if(query.trim().length<2||client)return;const timer=setTimeout(()=>searchClients(query).then(setClients).catch(()=>setClients([])),250);return()=>clearTimeout(timer)},[query,client])
  const interpret=async()=>{setInterpreting(true);setError('');try{const result=await parseSaleAssistant(assistantText),f=result.fields;setQuery(String(f.client_name??''));setClient((result.client_matches[0] as ClientOption|undefined)??null);setClients(result.client_matches as ClientOption[]);setMl(f.ml==null?'':String(f.ml));setAmount(f.amount==null?'':String(f.amount));if(f.sale_type)setSaleType(f.sale_type as 'APC'|'SPLIT');if(f.payment_status)setStatus(String(f.payment_status));if(f.payment_method)setMethod(String(f.payment_method));if(f.paid_at)setPaidAt(String(f.paid_at));setNotes(String(f.notes??''));setPerfumeMatches(result.perfume_matches);if(result.perfume_matches.length===1){setPerfume(result.perfume_matches[0].name);setAvailable(result.perfume_matches[0].available_ml)}setAssistant(false)}catch(reason){setError(reason instanceof Error?reason.message:'Não foi possível interpretar.')}finally{setInterpreting(false)}}
  const submit=async(e:FormEvent)=>{e.preventDefault();if(saving)return;const value=parseBrazilianMoney(amount),volume=parseBrazilianMoney(ml),creditValue=credit?parseBrazilianMoney(credit):null;if(!client)return setError('Selecione um cliente.');if(!date)return setError('Informe a data da venda.');if(!perfume.trim())return setError('Informe o perfume.');if(value===null||value<0)return setError('Informe um valor válido.');if(volume===null||volume<0)return setError('Informe um volume em ML válido.');if(credit&&creditValue===null)return setError('Informe um crédito válido.')
    setSaving(true);setError('');try{await createSale({clientId:client.id,date,amount:value,status,method,notes,perfume,saleType,volumeMl:volume,paidAt,creditReferenceAmount:creditValue});setMessage('Venda salva e estoque reservado somente quando pago.');setTimeout(close,650)}catch(err){setError(err instanceof Error?err.message:'Falha ao salvar.')}finally{setSaving(false)}}
  return <>{assistant&&<Modal title="Preencher com IA" close={()=>setAssistant(false)}><div className="record-form"><p>Cole a mensagem, anotação ou pedido do cliente. Nada será salvo antes da sua revisão.</p><label className="field"><span>Texto para interpretar</span><textarea rows={9} value={assistantText} onChange={event=>setAssistantText(event.target.value)}/></label><div className="form-actions"><button onClick={()=>setAssistant(false)}>Cancelar</button><button className="primary" disabled={!assistantText.trim()||interpreting} onClick={interpret}>{interpreting?"Interpretando…":"INTERPRETAR E MOSTRAR PRÉVIA"}</button></div></div></Modal>}{newClient&&<ClientModal close={()=>setNewClient(false)} onSaved={(c)=>{setClient({...c,phone:null,whatsapp_phone:null,email:null,cpf:null,postal_code:null,address_line:null,address_number:null,complement:null,district:null,city:null,state:null});setQuery(c.name);setNewClient(false)}}/>}<Modal title="Adicionar venda" close={close}><form onSubmit={submit} className="record-form">
    <div className="form-actions ai-fill-row"><button type="button" onClick={()=>setAssistant(true)}><Sparkles/> Preencher com IA</button><small>Cole a mensagem do pedido — a IA organiza os dados para você conferir antes de salvar.</small></div><div className="form-grid">
      <Divider label="Cliente"/>
      <div className="field wide client-search"><label>Cliente *</label><div className="search-control"><Search/><input value={query} placeholder="Busque pelo nome" onChange={(e)=>{setQuery(e.target.value);setClient(null)}}/><button type="button" onClick={()=>setNewClient(true)}><Plus/> Criar cliente</button></div>
      {!client&&clients.length>0&&<div className="client-results">{clients.map((c)=><button type="button" key={c.id} onClick={()=>{setClient(c);setQuery(c.name);setClients([])}}>{c.name}</button>)}</div>}</div>
      {client&&<div className="client-context wide"><div><strong>Dados do cliente</strong><span>{client.whatsapp_phone||client.phone||'Sem telefone'} · {client.cpf||'CPF não informado'}</span><span>{[client.address_line,client.address_number,client.complement,client.district,client.city,client.state,client.postal_code].filter(Boolean).join(', ')||'Endereço não informado'}</span></div><button type="button" onClick={()=>window.open(`/clientes/${client.id}`,'_blank')}>Editar dados do cliente</button></div>}
      <Divider label="Produto"/>
      <DateField id="sale-date" label="Data da venda" value={date} onChange={setDate} required error={!date&&error?'Data obrigatória.':''}/>
      <Field label="Perfume *" value={perfume} onChange={setPerfume} wide/>{perfumeMatches.length>1&&<label className="field wide"><span>Selecione o perfume identificado</span><select value={perfume} onChange={event=>{const match=perfumeMatches.find(item=>item.name===event.target.value);setPerfume(event.target.value);setAvailable(match?.available_ml??null)}}><option value="">Selecione…</option>{perfumeMatches.map(item=><option key={item.id} value={item.name}>{item.name}</option>)}</select></label>}{available!==null&&<div className="client-context wide"><strong>Estoque operacional</strong><span>Disponível: {available} ml · Venda: {ml||"—"} ml</span></div>}
      <label className="field"><span>Tipo *</span><select value={saleType} onChange={(e)=>setSaleType(e.target.value as 'APC'|'SPLIT')}><option>APC</option><option>SPLIT</option></select></label>
      <Field label="ML *" value={ml} onChange={setMl} placeholder="Ex.: 10"/>
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
