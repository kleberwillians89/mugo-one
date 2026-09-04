import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'

const page = readFileSync('src/pages/ShipmentPrintPage.tsx', 'utf8')
const css = readFileSync('src/pages/ShipmentPrintPage.css', 'utf8')

function block(source: string, selector: string) {
  const start = source.indexOf(selector)
  if (start === -1) return null
  const braceStart = source.indexOf('{', start)
  const braceEnd = source.indexOf('}', braceStart)
  return source.slice(braceStart, braceEnd)
}

describe('layout de impressão A4 da nota de envio', () => {
  it('define @page A4 com margem generosa', () => {
    expect(page).toContain('@page { size: A4 portrait; margin: 12mm 14mm; }')
  })

  it('header não usa position:absolute para o conteúdo principal', () => {
    const header = block(css, '.shipment-document-header {')
    expect(header).not.toBeNull()
    expect(header).not.toMatch(/position\s*:\s*absolute/i)
    expect(css).not.toMatch(/position\s*:\s*absolute/i)
  })

  it('não usa transform:scale nem zoom como gambiarra de ajuste', () => {
    expect(css).not.toMatch(/transform\s*:\s*scale/i)
    expect(css).not.toMatch(/\bzoom\s*:/i)
  })

  it('status fica empilhado abaixo de referência/data e nunca invade a seção seguinte', () => {
    const headerDl = block(css, '.shipment-document-header dl {')
    expect(headerDl).not.toBeNull()
    expect(headerDl).not.toMatch(/flex-wrap/)
    expect(headerDl).toMatch(/display:\s*grid/)
    const header = block(css, '.shipment-document-header {')
    expect(header).toMatch(/margin-bottom/)
  })

  it('endereço do cliente permite quebra de linha sem cortar conteúdo', () => {
    expect(css).toMatch(/\.shipment-document-grid[^{]*address[^{]*\{[^}]*overflow-wrap:\s*anywhere/s)
  })

  it('ações de impressão ficam ocultas em @media print', () => {
    const printBlock = css.slice(css.indexOf('@media print'))
    expect(printBlock).toMatch(/\.shipment-document-actions\s*\{\s*display:\s*none\s*!important/)
  })

  it('seções principais evitam quebra de página no meio do conteúdo', () => {
    for (const selector of [
      '.shipment-document-destination {',
      '.shipment-document-logistics {',
      '.shipment-document-summary {',
      '.shipment-document-notes {',
      '.shipment-document-signature {',
      '.shipment-document tr {',
    ]) {
      const rule = block(css, selector)
      expect(rule, `selector ${selector} deve existir`).not.toBeNull()
      expect(rule).toMatch(/break-inside:\s*avoid/)
      expect(rule).toMatch(/page-break-inside:\s*avoid/)
    }
  })

  it('tabela de itens pode continuar em outra página com cabeçalho repetido', () => {
    const printBlock = css.slice(css.indexOf('@media print'))
    expect(printBlock).toMatch(/\.shipment-document table\s*\{\s*page-break-inside:\s*auto/)
    expect(printBlock).toMatch(/\.shipment-document thead\s*\{\s*display:\s*table-header-group/)
  })

  it('preview de tela mantém o documento centralizado próximo da largura A4', () => {
    const doc = block(css, '.shipment-document {')
    expect(doc).toMatch(/width:\s*min\(210mm,\s*100%\)/)
    expect(doc).toMatch(/margin:\s*auto/)
  })

  it('reseta position/height do header explicitamente contra o vazamento da tag global <header> do app shell', () => {
    // src/styles.css define um seletor de tag <header>{position:sticky;top:0;
    // height:91px} para a barra do app shell — sem este reset, QUALQUER
    // <header> da aplicação (inclusive este documento isolado) herda essa
    // regra, e um header "sticky" corrompe a paginação de impressão do
    // Chromium (repinta uma cópia grudada sobre o conteúdo seguinte).
    const header = block(css, '.shipment-document-header {')
    expect(header).toMatch(/position:\s*static/)
    expect(header).toMatch(/height:\s*auto/)
  })

  it('rede de segurança de @media print neutraliza position/overflow/height herdados em todas as seções do corpo', () => {
    const printBlock = css.slice(css.indexOf('@media print'))
    for (const selector of [
      '.shipment-document-header',
      '.shipment-document-destination',
      '.shipment-document-logistics',
      '.shipment-document-items',
      '.shipment-document-summary',
      '.shipment-document-notes',
      '.shipment-document-signature',
      '.shipment-document footer',
    ]) expect(printBlock).toContain(selector)
    expect(printBlock).toMatch(/visibility:\s*visible/)
    expect(printBlock).toMatch(/overflow:\s*visible/)
    expect(printBlock).toMatch(/position:\s*static/)
    expect(printBlock).toMatch(/height:\s*auto/)
    expect(printBlock).toMatch(/max-height:\s*none/)
  })

  it('reseta font-size/line-height na raiz do documento para não herdar a tipografia do app (que empurra conteúdo para a página 2)', () => {
    const doc = block(css, '.shipment-document {')
    expect(doc).toMatch(/line-height:\s*normal/)
    expect(doc).toMatch(/font-size:\s*10pt/)
  })
})
