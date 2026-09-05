import { useEffect, useRef, useState } from 'react'
import { CalendarDays, Check, ChevronDown, X } from 'lucide-react'
import { DayPicker, DateRange } from 'react-day-picker'
import { format, parse } from 'date-fns'
import { ptBR } from 'date-fns/locale'
import { brazilianToIso, isoToBrazilian } from '../lib/date'
import { PeriodPreset as Preset, PeriodValue, presetPeriod } from '../lib/period'
import { useOperationalSalesStartDate } from '../lib/PermissionsContext'

const localIso = (date:Date) => format(date,'yyyy-MM-dd')

export function PeriodFilter({value,onApply}:{value:PeriodValue;onApply:(period:PeriodValue)=>void}) {
  const operationalStart=useOperationalSalesStartDate()
  const [open,setOpen]=useState(false)
  const [draft,setDraft]=useState(value)
  const [startText,setStartText]=useState(isoToBrazilian(value.start))
  const [endText,setEndText]=useState(isoToBrazilian(value.end))
  const [error,setError]=useState('')
  const [compact,setCompact]=useState(()=>matchMedia('(max-width: 760px)').matches)
  const root=useRef<HTMLDivElement>(null)
  useEffect(()=>{const media=matchMedia('(max-width: 760px)'),change=()=>setCompact(media.matches);media.addEventListener('change',change);return()=>media.removeEventListener('change',change)},[])
  useEffect(()=>{if(!open)return;const close=(event:MouseEvent)=>{if(!root.current?.contains(event.target as Node))setOpen(false)},escape=(event:KeyboardEvent)=>{if(event.key==='Escape')setOpen(false)};document.addEventListener('mousedown',close);document.addEventListener('keydown',escape);return()=>{document.removeEventListener('mousedown',close);document.removeEventListener('keydown',escape)}},[open])
  useEffect(()=>{if(!open||!compact)return;const previous=document.body.style.overflow;document.body.style.overflow='hidden';return()=>{document.body.style.overflow=previous}},[open,compact])
  const selectPreset=(preset:Preset)=>{const next=presetPeriod(preset,undefined,operationalStart);setDraft(next);setStartText(isoToBrazilian(next.start));setEndText(isoToBrazilian(next.end));setError('')}
  const commitText=()=>{const start=brazilianToIso(startText),end=brazilianToIso(endText);if(!start||!end)return setError('Informe as duas datas no formato DD/MM/AAAA.');if(end<start)return setError('A data final não pode ser anterior à inicial.');setDraft({start,end,label:'Período personalizado'});setError('')}
  const selected:DateRange={from:parse(draft.start,'yyyy-MM-dd',new Date()),to:parse(draft.end,'yyyy-MM-dd',new Date())}
  const apply=()=>{commitText();const start=brazilianToIso(startText),end=brazilianToIso(endText);if(!start||!end||end<start)return;onApply({...draft,start,end,label:draft.label==='Todo o período'?'Todo o período':`${isoToBrazilian(start)} a ${isoToBrazilian(end)}`});setOpen(false)}
  return <div className="period-filter" ref={root}>
    <button type="button" className="date-filter" aria-haspopup="dialog" aria-expanded={open} onClick={()=>{if(!open){setDraft(value);setStartText(isoToBrazilian(value.start));setEndText(isoToBrazilian(value.end))}setOpen(!open)}}><CalendarDays size={17}/><span>{value.label}</span><ChevronDown size={16}/></button>
    {open&&<div className="period-popover" role="dialog" aria-modal={compact} aria-label="Selecionar período">
      <div className="period-mobile-head"><strong>Selecionar período</strong><button type="button" aria-label="Fechar filtro de período" onClick={()=>setOpen(false)}><X/></button></div>
      <div className="period-panel-body">
        <div className="period-presets">{([
          ...(operationalStart?[['operational','Operação atual','Operação atual']]as[Preset,string,string][]:[]),
          ['today','Hoje','Hoje'],['yesterday','Ontem','Ontem'],['7d','Últimos 7 dias','7 dias'],['30d','Últimos 30 dias','30 dias'],
          ['month','Este mês','Este mês'],['previous_month','Mês anterior','Mês anterior'],['quarter','Este trimestre','Trimestre'],
          ['year','Este ano','Este ano'],['all','Todo o período','Todo período'],['custom','Período personalizado','Personalizado'],
        ] as [Preset,string,string][]).map(([key,label,shortLabel])=><button className={key==='custom'?'period-preset-custom':key==='operational'?'period-preset-operational':undefined} aria-label={label} aria-pressed={draft.label===label} key={key} onClick={()=>selectPreset(key)}><span className="period-label-full">{label}</span><span className="period-label-mobile">{shortLabel}</span></button>)}</div>
        <div className="period-calendar">
          <div className="period-inputs"><label>Data inicial<input value={startText} inputMode="numeric" onChange={(event)=>setStartText(event.target.value.replace(/[^\d/]/g,'').slice(0,10))} onBlur={commitText}/></label><span>até</span><label>Data final<input value={endText} inputMode="numeric" onChange={(event)=>setEndText(event.target.value.replace(/[^\d/]/g,'').slice(0,10))} onBlur={commitText}/></label></div>
          <DayPicker mode="range" locale={ptBR} selected={selected} numberOfMonths={1}
            captionLayout="dropdown" startMonth={new Date(2020,0)} endMonth={new Date(2035,11)}
            onSelect={(range)=>{if(!range?.from)return;const start=localIso(range.from),end=localIso(range.to??range.from);setDraft({start,end,label:'Período personalizado'});setStartText(isoToBrazilian(start));setEndText(isoToBrazilian(end));setError('')}}/>
          {error&&<div className="field-error">{error}</div>}
        </div>
      </div>
      <div className="period-actions"><button onClick={()=>{const empty=presetPeriod('all');setDraft(empty);setStartText(isoToBrazilian(empty.start));setEndText(isoToBrazilian(empty.end));setError('')}}><X/> Limpar</button><button className="primary" onClick={apply}><Check/> Aplicar</button></div>
    </div>}
  </div>
}
