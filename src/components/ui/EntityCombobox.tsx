import { useEffect, useId, useRef, useState } from 'react'
import { Check, ChevronDown, LoaderCircle, Plus, Search, X } from 'lucide-react'
import { nextComboboxIndex } from './entity-combobox-logic'
import './EntityCombobox.css'

export type EntityOption = { id: string; label: string; description?: string }

export function EntityCombobox({ value, onChange, search, placeholder, label, error, disabled=false, minimumCharacters=2, debounceMs=250, onCreate, createLabel, shouldOfferCreate, noResultsLabel='Nenhum resultado encontrado.' }:{
  value:EntityOption|null;onChange:(option:EntityOption|null)=>void;search:(query:string)=>Promise<EntityOption[]>;placeholder:string;label:string;error?:string;disabled?:boolean;minimumCharacters?:number;debounceMs?:number;onCreate?:(query:string)=>void;createLabel?:(query:string)=>string;shouldOfferCreate?:(query:string,options:EntityOption[])=>boolean;noResultsLabel?:string
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
  const keyDown=(event:React.KeyboardEvent<HTMLInputElement>)=>{
    const itemCount=options.length+(canCreate?1:0)
    if(event.key==='ArrowDown'){event.preventDefault();setOpen(true);setActive(index=>nextComboboxIndex(index,'ArrowDown',itemCount))}
    else if(event.key==='ArrowUp'){event.preventDefault();setActive(index=>nextComboboxIndex(index,'ArrowUp',itemCount))}
    else if(event.key==='Enter'&&open&&active>=0){event.preventDefault();if(active<options.length)choose(options[active]);else onCreate?.(query.trim())}
    else if(event.key==='Escape'){event.preventDefault();setOpen(false);setActive(-1)}
  }
  const listId=`${id}-listbox`,status=query.trim().length<minimumCharacters?`Digite pelo menos ${minimumCharacters} caracteres.`:loading?'Buscando…':options.length?'':noResultsLabel
  return <div className={`entity-combobox ${error?'entity-combobox-error':''}`}>
    <label htmlFor={id}>{label}</label><div className="entity-combobox-control"><Search aria-hidden="true"/><input id={id} role="combobox" aria-autocomplete="list" aria-expanded={open} aria-controls={listId} aria-activedescendant={active>=0?`${id}-option-${active}`:undefined} aria-invalid={Boolean(error)} disabled={disabled} value={value?.label??query} placeholder={placeholder} onFocus={()=>query.trim().length>=minimumCharacters&&setOpen(true)} onChange={event=>{const next=event.target.value,searchable=next.trim().length>=minimumCharacters;request.current++;setQuery(next);setOptions([]);setLoading(searchable);setOpen(searchable);onChange(null)}} onKeyDown={keyDown}/>{(query||value)&&<button type="button" aria-label={`Limpar ${label.toLowerCase()}`} onClick={clear}><X/></button>}{loading?<LoaderCircle className="spin" aria-label="Buscando"/>:<ChevronDown aria-hidden="true"/>}</div>
    {open&&<div className="entity-combobox-popover"><div id={listId} role="listbox">{options.map((option,index)=><button id={`${id}-option-${index}`} role="option" aria-selected={value?.id===option.id} className={active===index?'active':''} type="button" key={option.id} onMouseDown={event=>event.preventDefault()} onMouseEnter={()=>setActive(index)} onClick={()=>choose(option)}><span><strong>{option.label}</strong>{option.description&&<small>{option.description}</small>}</span>{value?.id===option.id&&<Check aria-hidden="true"/>}</button>)}{canCreate&&<button id={`${id}-option-${options.length}`} role="option" aria-selected="false" className={`entity-combobox-create ${active===options.length?'active':''}`} type="button" onMouseDown={event=>event.preventDefault()} onMouseEnter={()=>setActive(options.length)} onClick={()=>onCreate?.(query.trim())}><Plus aria-hidden="true"/><strong>{createLabel?.(query.trim())??'CADASTRAR NOVO'}</strong></button>}</div>{status&&<p role="status">{status}</p>}</div>}
    {error&&<small className="field-error">{error}</small>}
  </div>
}
