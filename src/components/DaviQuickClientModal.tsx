import { FormEvent, useEffect, useRef, useState } from 'react'
import { AlertTriangle, Check, LoaderCircle } from 'lucide-react'
import { createDaviExcelClient, DaviClientCandidate } from '../lib/records'
import { Modal, useToast } from './ui'
import './DaviQuickClientModal.css'

const phoneMask=(value:string)=>value.replace(/\D/g,'').slice(0,11).replace(/^(\d{2})(\d)/,'($1) $2').replace(/(\d{5})(\d)/,'$1-$2')
const cpfMask=(value:string)=>value.replace(/\D/g,'').slice(0,11).replace(/(\d{3})(\d)/,'$1.$2').replace(/(\d{3})(\d)/,'$1.$2').replace(/(\d{3})(\d{1,2})$/,'$1-$2')

export function DaviQuickClientModal({name,onCancel,onSelected}:{name:string;onCancel:()=>void;onSelected:(client:{id:string;name:string})=>void}){
  const toast=useToast(),nameRef=useRef<HTMLInputElement>(null)
  const[form,setForm]=useState({name,phone:'',email:'',cpf:''}),[saving,setSaving]=useState(false),[error,setError]=useState(''),[duplicates,setDuplicates]=useState<DaviClientCandidate[]>([]),[forceAllowed,setForceAllowed]=useState(false)
  useEffect(()=>{requestAnimationFrame(()=>nameRef.current?.focus())},[])
  const submit=async(event?:FormEvent,force=false)=>{event?.preventDefault();if(saving)return;setError('');setDuplicates([])
    if(!form.name.trim())return setError('Informe o nome da cliente.')
    if(form.email&&!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email))return setError('Informe um e-mail válido.')
    if(form.phone&&![10,11].includes(form.phone.replace(/\D/g,'').length))return setError('Informe um telefone válido.')
    if(form.cpf&&form.cpf.replace(/\D/g,'').length!==11)return setError('Informe um CPF válido.')
    setSaving(true)
    try{
      const result=await createDaviExcelClient(form,force)
      if(result.status==='duplicate'){setDuplicates(result.candidates);setForceAllowed(result.force_allowed);return}
      toast.push('Cliente cadastrada.',{tone:'success'});onSelected(result.client)
    }catch(reason){setError(reason instanceof Error?reason.message:'Não foi possível cadastrar a cliente.')}
    finally{setSaving(false)}
  }
  return <Modal open onClose={onCancel} title="NOVA CLIENTE" eyebrow="DAVI EXCEL" footer={<><button type="button" onClick={onCancel}>CANCELAR</button><button className="primary" type="submit" form="davi-quick-client" disabled={saving}>{saving?<><LoaderCircle className="spin"/> SALVANDO...</>:<><Check/> SALVAR CLIENTE</>}</button></>}>
    <form id="davi-quick-client" className="davi-quick-client" onSubmit={submit}>
      <p>Cadastre a cliente sem sair da planilha. A venda continuará como rascunho.</p>
      <label><span>NOME *</span><input ref={nameRef} value={form.name} onChange={event=>setForm(value=>({...value,name:event.target.value}))}/></label>
      <div><label><span>TELEFONE</span><input inputMode="tel" placeholder="(11) 99999-9999" value={form.phone} onChange={event=>setForm(value=>({...value,phone:phoneMask(event.target.value)}))}/></label><label><span>CPF</span><input inputMode="numeric" placeholder="000.000.000-00" value={form.cpf} onChange={event=>setForm(value=>({...value,cpf:cpfMask(event.target.value)}))}/></label></div>
      <label><span>E-MAIL</span><input type="email" value={form.email} onChange={event=>setForm(value=>({...value,email:event.target.value.trim()}))}/></label>
      {duplicates.length>0&&<section className="davi-client-duplicates"><header><AlertTriangle/><div><strong>Encontramos clientes parecidas.</strong><span>Confira antes de criar uma duplicata.</span></div></header>{duplicates.map(candidate=><div key={candidate.id}><span><strong>{candidate.name}</strong><small>{candidate.reason}</small></span><button type="button" onClick={()=>onSelected({id:candidate.id,name:candidate.name})}>USAR CLIENTE EXISTENTE</button></div>)}{forceAllowed&&<button type="button" disabled={saving} onClick={()=>void submit(undefined,true)}>CADASTRAR MESMO ASSIM</button>}</section>}
      {error&&<div className="form-error">{error}</div>}
    </form>
  </Modal>
}
