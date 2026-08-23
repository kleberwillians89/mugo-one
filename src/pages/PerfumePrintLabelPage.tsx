import { useEffect, useState } from 'react'
import { BarcodeImage } from '../components/bottles/BarcodeImage'
import { QrCodeImage } from '../components/bottles/QrCodeImage'
import { supabase } from '../lib/supabase'
import './PerfumePrintLabelPage.css'

// A regra global existe somente no documento isolado /print/perfume.
// Assim ela vence o @page A4 do bundle sem alterar outras impressões do CRM.
const PERFUME_LABEL_PAGE_STYLE = '@page { size: 70mm 30mm; margin: 0; }'

export function PerfumePrintLabelPage() {
  const params = new URLSearchParams(location.search)
  const code = (params.get('codes') ?? '').trim().toUpperCase()
  const validOperationalCode = /^RUAH-P\d{6}$/.test(code)
  const [label,setLabel]=useState<{perfume_name:string;brand_house:string|null;operational_code:string}|null>(null)
  const [loading,setLoading]=useState(validOperationalCode)
  const [error,setError]=useState(validOperationalCode?'':'Código operacional de perfume inválido.')

  useEffect(()=>{
    if(!validOperationalCode||!supabase)return
    let active=true
    supabase.rpc('perfume_received_label',{p_operational_code:code}).then(({data,error:reason})=>{
      if(!active)return
      const row=(data??[])[0] as typeof label
      if(reason||!row)setError('Etiqueta indisponível: confirme primeiro o recebimento físico do perfume.')
      else setLabel(row)
      setLoading(false)
    })
    return()=>{active=false}
  },[code,validOperationalCode])

  useEffect(() => {
    document.title = 'Etiqueta de perfume — RUAH'
    if (!label) return
    const frame = requestAnimationFrame(() => window.print())
    const close = () => window.close()
    addEventListener('afterprint', close)
    return () => {
      cancelAnimationFrame(frame)
      removeEventListener('afterprint', close)
    }
  }, [label])

  if(loading)return <p>Validando recebimento físico…</p>
  if(error||!label)return <p>{error||'Etiqueta indisponível.'}</p>

  return (
    <>
      <style>{PERFUME_LABEL_PAGE_STYLE}</style>
      <div className="perfume-print-label">
        <strong>{label.perfume_name}</strong>
        {label.brand_house && <em>{label.brand_house}</em>}
        <div><BarcodeImage value={label.operational_code} displayValue={false} height={72} width={1} margin={1} /></div>
        <code>{label.operational_code}</code>
        <aside><QrCodeImage value={label.operational_code} size={100} alt={`QR ${label.operational_code}`} /></aside>
      </div>
    </>
  )
}
