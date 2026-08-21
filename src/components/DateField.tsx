import { useEffect, useRef, useState } from 'react'
import { CalendarDays, X } from 'lucide-react'
import { DayPicker } from 'react-day-picker'
import { format, parse } from 'date-fns'
import { ptBR } from 'date-fns/locale'
import 'react-day-picker/style.css'
import { isoToBrazilian, brazilianToIso } from '../lib/date'

type Props = {
  id: string
  label: string
  value: string
  onChange: (iso: string) => void
  required?: boolean
  error?: string
}

export function DateField({ id, label, value, onChange, required, error }: Props) {
  const [open, setOpen] = useState(false)
  const [text, setText] = useState(isoToBrazilian(value))
  const root = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const close = (event: MouseEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [])
  const selected = value ? parse(value, 'yyyy-MM-dd', new Date()) : undefined
  const commitText = () => {
    if (!text && !required) return onChange('')
    const iso = brazilianToIso(text)
    if (iso) onChange(iso)
  }
  return <div className="field date-field" ref={root}>
    <label htmlFor={id}>{label}{required && ' *'}</label>
    <div className={`date-control ${error ? 'invalid' : ''}`} onClick={() => setOpen(true)}>
      <input id={id} inputMode="numeric" placeholder="dd/mm/aaaa" value={text}
        onChange={(e) => setText(e.target.value.replace(/[^\d/]/g, '').slice(0, 10))}
        onBlur={commitText} onKeyDown={(e) => { if (e.key === 'Enter') commitText(); if(e.key==='Escape')setOpen(false) }}
        aria-invalid={Boolean(error)} aria-describedby={error ? `${id}-error` : undefined}/>
      {value && !required && <button type="button" aria-label="Limpar data" onClick={(e)=>{e.stopPropagation();setText('');onChange('')}}><X/></button>}
      <button type="button" aria-label={`Abrir calendário de ${label}`} onClick={(e)=>{e.stopPropagation();setOpen((x)=>!x)}}><CalendarDays/></button>
    </div>
    {open && <div className="calendar-popover"><DayPicker mode="single" locale={ptBR} selected={selected}
      onSelect={(day)=>{if(day){const iso=format(day,'yyyy-MM-dd');setText(isoToBrazilian(iso));onChange(iso);setOpen(false)}}}
      captionLayout="label" showOutsideDays fixedWeeks/></div>}
    {error && <span className="field-error" id={`${id}-error`}>{error}</span>}
  </div>
}
