import {useRef,useState} from 'react'
import {legacyShippingLabels,legacyShippingState,type LegacyShippingConfirmation} from '../lib/legacy-shipping'
import {setLegacyShippingConfirmation} from '../lib/records'
import {useHasPermission} from '../lib/PermissionsContext'
import {useToast} from './ui'
import './LegacyShippingConfirmationSelect.css'

export type LegacyShippingConfirmationResult={sale_id:string;confirmation:LegacyShippingConfirmation;shipping_date:string|null;confirmed_at:string|null;confirmed_by:string|null;updated_at:string;changed:boolean}
type Props={saleId:string;confirmation:string|null|undefined;shippingDate:string|null|undefined;updatedAt:string;onSaved:(result:LegacyShippingConfirmationResult)=>void}

export function LegacyShippingConfirmationSelect({saleId,confirmation,shippingDate,updatedAt,onSaved}:Props){
  const initial=legacyShippingState(confirmation),canEdit=useHasPermission('sales.edit'),toast=useToast(),inFlight=useRef(false)
  const [value,setValue]=useState<LegacyShippingConfirmation>(initial),[date,setDate]=useState(shippingDate?.slice(0,10)??''),[needsDate,setNeedsDate]=useState(false),[saving,setSaving]=useState(false),[feedback,setFeedback]=useState('')
  const save=async(next:LegacyShippingConfirmation,nextDate:string|null)=>{
    if(inFlight.current)return
    inFlight.current=true;setSaving(true);setFeedback('')
    try{const result=await setLegacyShippingConfirmation(saleId,next,next==='sent'?nextDate:null,updatedAt);setValue(result.confirmation);setDate(result.shipping_date??'');setNeedsDate(false);setFeedback('Salvo');onSaved(result)}
    catch(reason){setValue(initial);setDate(shippingDate?.slice(0,10)??'');setNeedsDate(false);setFeedback('Erro');toast.push(reason instanceof Error?reason.message:'Não foi possível salvar a confirmação.',{tone:'error'})}
    finally{inFlight.current=false;setSaving(false)}
  }
  const change=(next:LegacyShippingConfirmation)=>{setValue(next);setFeedback('');if(next==='sent'&&!date){setNeedsDate(true);return}void save(next,next==='sent'?date:null)}
  return <div className="legacy-confirmation-control">
    <select aria-label="Confirmação manual" value={value} disabled={!canEdit||saving} onChange={event=>change(event.target.value as LegacyShippingConfirmation)}>
      {(Object.keys(legacyShippingLabels) as LegacyShippingConfirmation[]).map(key=><option key={key} value={key}>{legacyShippingLabels[key]}</option>)}
    </select>
    {needsDate&&<label><span>Data do envio</span><input type="date" value={date} disabled={saving} onChange={event=>setDate(event.target.value)} onBlur={()=>date&&void save('sent',date)} onKeyDown={event=>{if(event.key==='Enter'&&date){event.preventDefault();void save('sent',date)}}}/></label>}
    <small aria-live="polite">{saving?'Salvando…':feedback}</small>
  </div>
}
