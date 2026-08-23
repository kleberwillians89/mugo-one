import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'

const perfumePage=readFileSync('src/pages/PerfumePrintLabelPage.tsx','utf8')
const perfumeCss=readFileSync('src/pages/PerfumePrintLabelPage.css','utf8')
const shipmentPage=readFileSync('src/pages/ShipmentPrintPage.tsx','utf8')
const routes=readFileSync('src/Auth.tsx','utf8')
const printHelper=readFileSync('src/lib/preparation.ts','utf8')
const receiptSql=readFileSync('supabase/migrations/202608220004_perfume_receipt_by_scan.sql','utf8')

describe('arquitetura final das impressões RUAH',()=>{
  it('isola A4 e etiqueta 70x30 em rotas distintas',()=>{expect(routes).toContain("path==='/print/shipment'");expect(routes).toContain("path==='/print/perfume'");expect(shipmentPage).toContain('@page { size: A4 portrait; margin: 12mm; }');expect(perfumePage).toContain('@page { size: 70mm 30mm; margin: 0; }');expect(perfumeCss).toContain('width: 70mm');expect(perfumeCss).toContain('height: 30mm')})
  it('não escala a etiqueta no modo print',()=>{const printCss=perfumeCss.slice(perfumeCss.indexOf('@media print'));expect(printCss).not.toMatch(/transform\s*:\s*scale/i);expect(printCss).not.toMatch(/zoom\s*:/i)})
  it('aceita apenas identidade canônica RUAH-P e usa o mesmo payload validado nos três elementos',()=>{expect(perfumePage).toContain("/^RUAH-P\\d{6}$/.test(code)");expect(perfumePage).toContain('<BarcodeImage value={label.operational_code}');expect(perfumePage).toContain('<code>{label.operational_code}</code>');expect(perfumePage).toContain('<QrCodeImage value={label.operational_code}');expect(printHelper).toContain('codes:perfume.operational_code')})
  it('scanner resolve operational_code para perfume sem alterar estoque no preview',()=>{const preview=receiptSql.slice(receiptSql.indexOf('perfume_receipt_preview'),receiptSql.indexOf('perfume_receipt_confirm'));expect(preview).toContain('p.operational_code');expect(preview).toContain('p.id');expect(preview).not.toMatch(/\b(insert|update|delete)\b/i)})
})
