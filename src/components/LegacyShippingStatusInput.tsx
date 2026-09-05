import { useId, useRef, useState } from 'react'
import { useHasPermission } from '../lib/PermissionsContext'
import { legacyShippingStatusLabel, parseLegacyShippingStatus, type LegacyShippingStatus } from '../lib/legacy-shipping-status'
import { setLegacyShippingStatus, type LegacyShippingStatusResult } from '../lib/records'
import { useToast } from './ui'
import './LegacyShippingStatusInput.css'

type Props={saleId:string;status:string|null|undefined;updatedAt:string;onSaved:(result:LegacyShippingStatusResult)=>void}

export function LegacyShippingStatusInput({saleId,status,updatedAt,onSaved}:Props){
  const canEdit=useHasPermission('sales.edit'),toast=useToast(),listId=useId(),inFlight=useRef(false)
  const [draft,setDraft]=useState(legacyShippingStatusLabel(status)),[saving,setSaving]=useState(false),[feedback,setFeedback]=useState('')
  const save=async(value:string)=>{
    if(inFlight.current)return
    let parsed:LegacyShippingStatus|null
    try{parsed=parseLegacyShippingStatus(value)}catch(reason){const message=reason instanceof Error?reason.message:'Status inválido.';setFeedback('Valor inválido');toast.push(message,{tone:'error'});return}
    if(parsed===(status??null)){setDraft(legacyShippingStatusLabel(status));return}
    inFlight.current=true;setSaving(true);setFeedback('')
    try{const result=await setLegacyShippingStatus(saleId,parsed,updatedAt);setDraft(legacyShippingStatusLabel(result.status));setFeedback('Salvo');onSaved(result)}catch(reason){const message=reason instanceof Error?reason.message:'Não foi possível salvar.';setFeedback('Erro');toast.push(message,{tone:'error'})}finally{inFlight.current=false;setSaving(false)}
  }
  const change=(value:string)=>{setDraft(value);setFeedback('');if(['CONFIRMADO','A ENVIAR','SEM ESTOQUE'].includes(value.trim().toLocaleUpperCase('pt-BR')))void save(value)}
  return <div className="legacy-status-control"><span className="legacy-status-input-wrap"><input list={listId} value={draft} disabled={!canEdit||saving} aria-label="Status histórico" onFocus={event=>event.currentTarget.select()} onChange={event=>change(event.target.value)} onKeyDown={event=>{if(event.key==='Enter'){event.preventDefault();void save(event.currentTarget.value)}}} onBlur={event=>void save(event.currentTarget.value)}/><datalist id={listId}><option value="CONFIRMADO"/><option value="A ENVIAR"/><option value="SEM ESTOQUE"/></datalist></span><small aria-live="polite">{saving?'Salvando…':feedback}</small></div>
}
