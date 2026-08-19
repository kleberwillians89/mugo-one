import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

/**
 * Regression suite for the "ajuste cirúrgico da etiqueta física" pass:
 * the barcode is the protagonist, name/human-code are small support text.
 * No live browser/printer is reachable from this sandbox (same
 * constraint as the rest of the print-label suite), so these assert the
 * exact CSS/component source rather than rendering a real DOM. Physical
 * print of a real 28x10mm label remains PENDING HUMAN VALIDATION.
 */

const printLabelCss = readFileSync(new URL('../pages/PrintLabelPage.css', import.meta.url), 'utf8')
const printLabelPage = readFileSync(new URL('../pages/PrintLabelPage.tsx', import.meta.url), 'utf8')
const barcodeImage = readFileSync(new URL('../components/bottles/BarcodeImage.tsx', import.meta.url), 'utf8')

const labelRule = printLabelCss.slice(printLabelCss.indexOf('.print-label {'), printLabelCss.indexOf('\n}\n', printLabelCss.indexOf('.print-label {')) + 2)
const perfumeRule = printLabelCss.slice(printLabelCss.indexOf('.print-label-perfume {'), printLabelCss.indexOf('\n}\n', printLabelCss.indexOf('.print-label-perfume {')) + 2)
const codeRule = printLabelCss.slice(printLabelCss.indexOf('.print-label-code {'), printLabelCss.indexOf('\n}\n', printLabelCss.indexOf('.print-label-code {')) + 2)
const barcodeSvgRule = printLabelCss.slice(printLabelCss.indexOf('.print-label-barcode .barcode-image {'), printLabelCss.indexOf('\n}\n', printLabelCss.indexOf('.print-label-barcode .barcode-image {')) + 2)

function mmFontSize(rule: string): number {
  const match = rule.match(/font-size:\s*([\d.]+)mm/)
  if (!match) throw new Error('font-size em mm não encontrado')
  return Number(match[1])
}

describe('1 — tamanho da etiqueta continua 28x10mm', () => {
  it('@page e o retângulo .print-label são exatamente 28mm x 10mm', () => {
    expect(printLabelCss).toContain('size: 28mm 10mm')
    expect(labelRule).toMatch(/width:\s*28mm;/)
    expect(labelRule).toMatch(/height:\s*10mm;/)
  })
  it('nenhum outro tamanho (24mm, 30x10, 30x15, A4) foi introduzido nas dimensões reais da etiqueta', () => {
    expect(printLabelCss).not.toContain('24mm')
    expect(labelRule).not.toMatch(/width:\s*30mm/)
    expect(labelRule).not.toMatch(/height:\s*15mm/)
    expect(printLabelCss).not.toMatch(/size:\s*A4/i)
  })
})

describe('2/3 — proporção tipográfica: nome e código são apoio, nunca protagonistas', () => {
  it('2: nome do perfume usa fonte <= 1.65mm (alvo pedido: 1.5-1.65mm)', () => {
    const size = mmFontSize(perfumeRule)
    expect(size).toBeLessThanOrEqual(1.65)
    expect(size).toBeGreaterThanOrEqual(1.5)
  })
  it('3: código humano usa fonte <= 1.45mm (alvo pedido: 1.3-1.45mm)', () => {
    const size = mmFontSize(codeRule)
    expect(size).toBeLessThanOrEqual(1.45)
    expect(size).toBeGreaterThanOrEqual(1.3)
  })
  it('font-weight 600 em ambos, sem uppercase forçado no nome', () => {
    expect(perfumeRule).toContain('font-weight: 600;')
    expect(codeRule).toContain('font-weight: 600;')
    expect(perfumeRule).not.toContain('text-transform')
  })
})

describe('4/5 — nome nunca quebra em duas linhas; nome longo usa reticências', () => {
  it('4: white-space nowrap — nunca duas linhas', () => {
    expect(perfumeRule).toContain('white-space: nowrap;')
  })
  it('5: overflow hidden + text-overflow ellipsis — nome longo trunca visualmente, nunca reduz o barcode para caber inteiro', () => {
    expect(perfumeRule).toContain('overflow: hidden;')
    expect(perfumeRule).toContain('text-overflow: ellipsis;')
    // "10019 WONDERS - EX NIHILO" continua o valor real enviado — a etiqueta
    // não reformata/abrevia o texto, só o exibe truncado visualmente via CSS.
    expect(printLabelPage).toContain('{perfume}')
    expect(printLabelPage).not.toMatch(/perfume\.slice|perfume\.substring|perfume\.split/)
  })
})

describe('6 — barcode recebe a maior área vertical disponível (linha central flexível do grid)', () => {
  it('a linha do meio do grid é minmax(0,1fr) — a única com altura variável, entre duas linhas de texto fixas e pequenas', () => {
    expect(labelRule).toMatch(/grid-template-rows:\s*1\.55mm minmax\(0, 1fr\) 1\.35mm;/)
  })
  it('o SVG do barcode ocupa 100% da altura da linha (height:100%), com um teto de 5.8mm (dentro da faixa de 5.5-6mm pedida)', () => {
    expect(barcodeSvgRule).toContain('height: 100%;')
    expect(barcodeSvgRule).toMatch(/max-height:\s*5\.8mm;/)
  })
  it('nenhum transform:scale() é usado para dimensionar o barcode — só width/height normais, sem distorcer as barras', () => {
    expect(labelRule).not.toContain('transform')
    expect(barcodeSvgRule).not.toContain('transform')
    expect(barcodeSvgRule).toContain('width: auto;')
  })
  it('largura do barcode: ocupa toda a largura disponível (max-width:100%), nunca estreito e centralizado sobrando espaço vazio', () => {
    expect(barcodeSvgRule).toContain('max-width: 100%;')
  })
})

describe('7 — QR não aparece na etiqueta física impressa', () => {
  it('PrintLabelPage não importa/renderiza QrCodeImage nem qr_token', () => {
    expect(printLabelPage).not.toContain('QrCodeImage')
    expect(printLabelPage).not.toContain('qr_token')
  })
})

describe('8/9 — payload do barcode continua a identidade canônica, não mudou com o ajuste visual', () => {
  it('8: bottle usa RUAH-F... (derivado de code, ex.: RUAH-F000003 para F000003)', () => {
    expect(printLabelPage).toContain('value={`RUAH-${code}`}')
  })
  it('9: split usa RUAH-S... pela MESMA derivação — nenhum SKU novo criado só pelo ajuste de layout', () => {
    // mesmo template literal cobre os dois "kind"s — não há um caminho de
    // código separado para split que pudesse ter divergido da identidade.
    const occurrences = (printLabelPage.match(/value=\{`RUAH-\$\{code\}`\}/g) ?? []).length
    expect(occurrences).toBe(1)
  })
  it('margin do gerador foi reduzida (2, não 0) para dar mais largura às barras sem remover a quiet zone — payload/formato do Code128 inalterados', () => {
    expect(printLabelPage).toContain('margin={2}')
    expect(barcodeImage).toContain('margin?:number')
    expect(barcodeImage).toContain('margin = 4') // default preservado para todo outro chamador existente
    expect(barcodeImage).toContain("format: 'CODE128'")
  })
  it('displayValue continua desligado nesta etiqueta — o texto humano é a própria .print-label-code, não a legenda nativa do gerador', () => {
    expect(printLabelPage).toContain('displayValue={false}')
  })
})

describe('10 — nenhum A4 introduzido nesta folha dedicada', () => {
  it('só existe o @page nomeado de 28mm x 10mm, nunca size:A4', () => {
    const pageRuleCount = (printLabelCss.match(/@page/g) ?? []).length
    expect(pageRuleCount).toBe(1)
    expect(printLabelCss).not.toMatch(/A4/i)
  })
})

describe('11 — PrintLabelPage continua isolado do AppShell (não regrediu com o ajuste visual)', () => {
  it('nenhuma importação de Modal/sidebar/header foi introduzida ao mexer no layout', () => {
    const imports = printLabelPage.match(/^import .+$/gm) ?? []
    expect(imports).toEqual([
      "import { useEffect } from 'react'",
      "import { BarcodeImage } from '../components/bottles/BarcodeImage'",
      "import './PrintLabelPage.css'",
    ])
  })
})
