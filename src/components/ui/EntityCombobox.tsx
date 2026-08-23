import { useEffect, useId, useRef, useState } from 'react'
import { Check, ChevronDown, LoaderCircle, Plus, Search, X } from 'lucide-react'
import { nextComboboxIndex } from './entity-combobox-logic'
import './EntityCombobox.css'

export type EntityOption = { id: string; label: string; description?: string }

export function EntityCombobox({ value, onChange, search, placeholder, label, error, disabled=false, minimumCharacters=2, debounceMs=250, onCreate, createLabel, shouldOfferCreate, createActionPosition='bottom', noResultsLabel='Nenhum resultado encontrado.' }:{
  value:EntityOption|null;onChange:(option:EntityOption|null)=>void;search:(query:string)=>Promise<EntityOption[]>;placeholder:string;label:string;error?:string;disabled?:boolean;minimumCharacters?:number;debounceMs?:number;onCreate?:(query:string)=>void;createLabel?:(query:string)=>string;shouldOfferCreate?:(query:string,options:EntityOption[])=>boolean;createActionPosition?:'top'|'bottom';noResultsLabel?:string
}) {
  const id=useId(),request=useRef(0),[query,setQuery]=useState(value?.label??''),[options,setOptions]=useState<EntityOption[]>([]),[open,setOpen]=useState(false),[loading,setLoading]=useState(false),[active,setActive]=useState(-1)
  useEffect(()=>{
    const term=query.trim(),current=++request.current
    if(value||term.length<minimumCharacters)return
    const timer=window.setTimeout(()=>search(term).then(rows=>{if(request.current===current){setOptions(rows);setActive(rows.length||onCreate?0:-1)}}).catch(()=>{if(request.current===current)setOptions([])}).finally(()=>{if(request.current===current)setLoading(false)}),debounceMs)
    return()=>window.clearTimeout(timer)
  },[query,value,search,minimumCharacters,debounceMs,onCreate])
  const choose=(option:EntityOption)=>{onChange(option);setQuery(option.label);setOptions([]);setOpen(false);setActive(-1)}
  const clear=()=>{request.current++;onChange(null);setQuery('');setOptions([]);setOpen(false);setActive(-1)}
  const canCreate=Boolean(onCreate&&!loading&&query.trim().length>=minimumCharacters&&(shouldOfferCreate?shouldOfferCreate(query.trim(),options):!options.length))
  const createFirst=canCreate&&createActionPosition==='top'
  const keyDown=(event:React.KeyboardEvent<HTMLInputElement>)=>{
    const itemCount=options.length+(canCreate?1:0)
    if(event.key==='ArrowDown'){event.preventDefault();setOpen(true);setActive(index=>nextComboboxIndex(index,'ArrowDown',itemCount))}
    else if(event.key==='ArrowUp'){event.preventDefault();setActive(index=>nextComboboxIndex(index,'ArrowUp',itemCount))}
    else if(event.key==='Enter'&&open&&active>=0){event.preventDefault();if(createFirst&&active===0)onCreate?.(query.trim());else{const optionIndex=createFirst?active-1:active;if(optionIndex>=0&&optionIndex<options.length)choose(options[optionIndex]);else if(canCreate)onCreate?.(query.trim())}}
    else if(event.key==='Escape'){event.preventDefault();setOpen(false);setActive(-1)}
  }
  const listId=`${id}-listbox`,status=query.trim().length<minimumCharacters?`Digite pelo menos ${minimumCharacters} caracteres.`:loading?'Buscando…':options.length?'':noResultsLabel
  const optionIndex=(index:number)=>index+(createFirst?1:0),createIndex=createFirst?0:options.length
  const createAction=canCreate?<button id={`${id}-option-${createIndex}`} role="option" aria-selected={active===createIndex} className={`entity-combobox-create ${active===createIndex?'active':''}`} type="button" onMouseDown={event=>event.preventDefault()} onMouseEnter={()=>setActive(createIndex)} onClick={()=>onCreate?.(query.trim())}><Plus aria-hidden="true"/><strong>{createLabel?.(query.trim())??'CADASTRAR NOVO'}</strong></button>:null
  const optionButtons=options.map((option,index)=>{const keyboardIndex=optionIndex(index);return <button id={`${id}-option-${keyboardIndex}`} role="option" aria-selected={value?.id===option.id} className={active===keyboardIndex?'active':''} type="button" key={option.id} onMouseDown={event=>event.preventDefault()} onMouseEnter={()=>setActive(keyboardIndex)} onClick={()=>choose(option)}><span><strong>{option.label}</strong>{option.description&&<small>{option.description}</small>}</span>{value?.id===option.id&&<Check aria-hidden="true"/>}</button>})
  return <div className={`entity-combobox ${error?'entity-combobox-error':''}`}>
    <label htmlFor={id}>{label}</label><div className="entity-combobox-control"><Search aria-hidden="true"/><input id={id} role="combobox" aria-autocomplete="list" aria-expanded={open} aria-controls={listId} aria-activedescendant={active>=0?`${id}-option-${active}`:undefined} aria-invalid={Boolean(error)} disabled={disabled} value={value?.label??query} placeholder={placeholder} onFocus={()=>query.trim().length>=minimumCharacters&&setOpen(true)} onChange={event=>{const next=event.target.value,searchable=next.trim().length>=minimumCharacters;request.current++;setQuery(next);setOptions([]);setLoading(searchable);setOpen(searchable);onChange(null)}} onKeyDown={keyDown}/>{(query||value)&&<button type="button" aria-label={`Limpar ${label.toLowerCase()}`} onClick={clear}><X/></button>}{loading?<LoaderCircle className="spin" aria-label="Buscando"/>:<ChevronDown aria-hidden="true"/>}</div>
    {open&&<div className={`entity-combobox-popover ${createActionPosition==='top'?'entity-combobox-popover--create-top':''}`}><div id={listId} role="listbox">{createFirst&&createAction}{createActionPosition==='top'?<div className="entity-combobox-results" role="presentation">{optionButtons}</div>:optionButtons}{!createFirst&&createAction}</div>{status&&<p role="status">{status}</p>}</div>}
    {error&&<small className="field-error">{error}</small>}
  </div>
}
