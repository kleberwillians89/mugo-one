import { useEffect, useRef } from 'react'
import JsBarcode from 'jsbarcode'

type Props = { value:string; displayValue?:boolean; height?:number; width?:number; fontSize?:number; margin?:number }

/**
 * Code128 rendering — read via a physical USB/BT scanner acting as a
 * keyboard, camera decode (BarcodeDetector, when supported), or manual
 * entry. displayValue/height/width default to the original sizing used
 * everywhere except the 28x10mm physical label (PrintLabelPage passes
 * displayValue=false there — the label prints its own human-readable code
 * as separate text, so the barcode itself needs no caption competing for
 * height).
 *
 * `margin` defaults to 4 (unchanged for every existing caller). The print
 * label passes a smaller value to reclaim a bit more width for the bars
 * on a 28mm label — never 0: JsBarcode's margin is the Code128 quiet
 * zone, and removing it entirely risks the exact thing this prop exists
 * to protect (a barcode that scans reliably).
 */
export function BarcodeImage({ value, displayValue = true, height = 46, width = 2, fontSize = 13, margin = 4 }: Props) {
  const svgRef = useRef<SVGSVGElement>(null)
  useEffect(() => {
    if (!svgRef.current) return
    try {
      JsBarcode(svgRef.current, value, {
        format: 'CODE128', displayValue, fontSize, height, width, margin, background: 'transparent',
      })
    } catch { /* valor inválido para Code128 — svg fica vazio, sem quebrar a tela */ }
  }, [value, displayValue, height, width, fontSize, margin])
  return <svg ref={svgRef} className="barcode-image" role="img" aria-label={`Código de barras ${value}`} />
}
