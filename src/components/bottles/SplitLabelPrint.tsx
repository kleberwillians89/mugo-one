import { InventorySplitUnit } from '../../lib/inventory-bottles'
import { BarcodeImage } from './BarcodeImage'
import './SplitLabelPrint.css'

/**
 * Etiqueta física do SPLIT (vidro fracionado) — 24mm x 10mm (reduzida de
 * 30x10mm), DIFERENTE da etiqueta do frasco fonte (BottleLabelPrint): aqui
 * o nome do perfume ENTRA
 * (o vidro sai da mão de quem fraciona sem nenhuma outra referência visual
 * de qual perfume é), mas a marca RUAH sai — briefing explícito: "If
 * adding the RUAH logo damages readability, omit the logo... priorities:
 * 1. barcode readability 2. perfume name readability 3. exact size
 * 4. branding". Com nome (comprimento variável, ao contrário do "RUAH"
 * fixo da etiqueta do frasco) + barras cabendo em 10mm de altura, incluir
 * a marca também empurraria as prioridades 1-2 para trás — decisão
 * documentada aqui, a confirmar fisicamente junto com o resto da Priority 0.
 *
 * Legenda textual do Code128 também desligada (displayValue=false), mesma
 * razão da etiqueta do frasco: a barra recebe a altura disponível inteira.
 */
export function SplitLabelPrint({ units, perfumeName }: { units: InventorySplitUnit[]; perfumeName: string }) {
  return (
    <div className="split-label-print">
      <div className="split-label-sheet">
        {units.map((unit) => (
          <div className="split-label-tag" key={unit.id}>
            <strong className="split-label-perfume">{perfumeName}</strong>
            <BarcodeImage value={unit.barcode_value} displayValue={false} height={48} width={1} />
          </div>
        ))}
      </div>
    </div>
  )
}
