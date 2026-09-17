import { FormEvent, useState } from 'react'
import { Check, LoaderCircle, X } from 'lucide-react'
import { DateField } from './DateField'
import { ClientInput, createClient, updateClient } from '../lib/records'
import { Divider } from './ui'
import './RecordModals.css'

const maskPhone = (v:string)=>v.replace(/\D/g,'').slice(0,11).replace(/^(\d{2})(\d)/,'($1) $2').replace(/(\d{5})(\d)/,'$1-$2')
const maskCpf = (v:string)=>v.replace(/\D/g,'').slice(0,11).replace(/(\d{3})(\d)/,'$1.$2').replace(/(\d{3})(\d)/,'$1.$2').replace(/(\d{3})(\d{1,2})$/,'$1-$2')
const maskCep = (v:string)=>v.replace(/\D/g,'').slice(0,8).replace(/(\d{5})(\d)/,'$1-$2')

function Modal({ title, close, children }: { title:string; close:()=>void; children:React.ReactNode }) {
  return <div className="modal-layer" role="dialog" aria-modal="true" aria-label={title}><button className="modal-scrim" onClick={close} aria-label="Fechar"/><div className="modal-panel"><div className="modal-title"><div><span>MUGÔ ONE</span><h2>{title}</h2></div><button onClick={close}><X/></button></div>{children}</div></div>
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

function Field({label,value='',onChange,wide,type='text',placeholder,error}: {label:string;value?:string;onChange:(v:string)=>void;wide?:boolean;type?:string;placeholder?:string;error?:string}) {
  return <label className={`field ${wide?'wide':''} ${error?'field-invalid':''}`}><span>{label}</span><input aria-invalid={Boolean(error)} type={type} value={value} placeholder={placeholder} onChange={(e)=>onChange(e.target.value)}/>{error&&<small className="field-error">{error}</small>}</label>
}
function FormFeedback({error,message}:{error:string;message:string}) { return <>{error&&<div className="form-error">{error}</div>}{message&&<div className="form-success"><Check/> {message}</div>}</> }
function FormActions({close,saving,label}:{close:()=>void;saving:boolean;label:string}) { return <div className="form-actions"><button type="button" onClick={close}>Cancelar</button><button className="primary" disabled={saving}>{saving?<LoaderCircle className="spin"/>:<Check/>}{saving?'Salvando…':label}</button></div> }
