import { useEffect, useRef } from 'react'
import JsBarcode from 'jsbarcode'

type Props = { value:string; displayValue?:boolean; height?:number; width?:number; fontSize?:number }

/**
 * Code128 rendering only — reading happens via a physical USB/BT scanner
 * acting as a keyboard, never by camera decode. displayValue/height/width
 * default to the original sizing used everywhere except the 30x10mm bottle
 * label (BottleLabelPrint passes displayValue=false there — see its
 * comment for why the human-readable caption is dropped at that scale).
 */
export function BarcodeImage({ value, displayValue = true, height = 46, width = 2, fontSize = 13 }: Props) {
  const svgRef = useRef<SVGSVGElement>(null)
  useEffect(() => {
    if (!svgRef.current) return
    try {
      JsBarcode(svgRef.current, value, {
        format: 'CODE128', displayValue, fontSize, height, width, margin: 4, background: 'transparent',
      })
    } catch { /* valor inválido para Code128 — svg fica vazio, sem quebrar a tela */ }
  }, [value, displayValue, height, width, fontSize])
  return <svg ref={svgRef} className="barcode-image" role="img" aria-label={`Código de barras ${value}`} />
}
