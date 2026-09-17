import { readFileSync } from 'node:fs'
import JsBarcode from 'jsbarcode'
import { describe, expect, it } from 'vitest'

const barcode = readFileSync('src/components/bottles/BarcodeImage.tsx', 'utf8')
const label = readFileSync('src/legacy/operations/pages/PerfumePrintLabelPage.tsx', 'utf8')
const operationalCode = 'RUAH-P000007'

describe('P0 payload físico da etiqueta RUAH-P', () => {
  it('Code128-B codifica a string canônica completa sem conversão numérica', () => {
    const target = {} as unknown as SVGElement & { encodings: Array<{ text:string; data:string }> }
    JsBarcode(target, operationalCode, { format:'CODE128B', displayValue:false })
    expect(target.encodings.map(item => item.text).join('')).toBe(operationalCode)
    expect(target.encodings.map(item => item.data).join('')).not.toHaveLength(0)
  })

  it('componente usa Code128-B e conserva o payload no SVG', () => {
    expect(barcode).toContain("format: 'CODE128B'")
    expect(barcode).toContain('data-payload={value}')
    expect(barcode).not.toMatch(/parseInt|replace\([^)]*\\D|substring|slice/)
  })

  it('barcode, QR e texto recebem exatamente operational_code', () => {
    expect(label).toContain('<BarcodeImage value={label.operational_code}')
    expect(label).toContain('<QrCodeImage value={label.operational_code}')
    expect(label).toContain('<code>{label.operational_code}</code>')
  })
})
