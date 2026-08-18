import { useEffect, useRef } from 'react'
import JsBarcode from 'jsbarcode'

/** Code128 rendering only — reading happens via a physical USB/BT scanner acting as a keyboard, never by camera decode. */
export function BarcodeImage({ value }:{ value:string }) {
  const svgRef = useRef<SVGSVGElement>(null)
  useEffect(() => {
    if (!svgRef.current) return
    try {
      JsBarcode(svgRef.current, value, {
        format: 'CODE128', displayValue: true, fontSize: 13, height: 46, margin: 4, background: 'transparent',
      })
    } catch { /* valor inválido para Code128 — svg fica vazio, sem quebrar a tela */ }
  }, [value])
  return <svg ref={svgRef} className="barcode-image" role="img" aria-label={`Código de barras ${value}`} />
}
