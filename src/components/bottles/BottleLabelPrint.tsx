import { InventoryBottle } from '../../lib/inventory-bottles'
import { BarcodeImage } from './BarcodeImage'
import './BottleLabelPrint.css'

/**
 * Etiqueta física do frasco — 24mm x 10mm (reduzida de 30x10mm; ver
 * BottleLabelPrint.css para as regras @page/@media print que fixam o
 * tamanho físico e o cálculo de largura de módulo do Code128). Contém SÓ:
 * Code128 do barcode_value do frasco (ex. RUAH-F000185 — a identidade
 * FÍSICA do frasco individual, nunca o token de QR). Nunca nome do
 * perfume, ml, APC, status, preço, cliente ou envio — esses pertencem ao
 * objeto de impressão operacional (ver ShipmentPrintView em
 * Shipment360View.tsx), um identificador completamente diferente do
 * frasco.
 *
 * A marca RUAH foi removida (era texto fixo em 30x10mm) para o barcode
 * receber 100% da largura disponível em 24mm — mesma prioridade já
 * aplicada ao SplitLabelPrint ("1. leitura do Code128, 2+. resto").  QR
 * continua fora desta etiqueta: não há espaço para QR + Code128 sem
 * comprometer a leitura, e o QR de tela (PhysicalIdentityView) já cobre o
 * caso de uso de leitura por celular/teste.
 *
 * Legenda textual do Code128 continua desligada (displayValue=false) pelo
 * mesmo motivo de antes: em 10mm de altura, texto legível roubaria altura
 * das barras.
 *
 * Sempre montado (mesmo fora de impressão) para window.print() funcionar
 * sem corrida de estado — mesma técnica de .shipment-print-view.
 */
export function BottleLabelPrint({ bottles }: { bottles: InventoryBottle[] }) {
  return (
    <div className="bottle-label-print">
      <div className="bottle-label-sheet">
        {bottles.map((bottle) => (
          <div className="bottle-label-tag" key={bottle.id}>
            <BarcodeImage value={bottle.barcode_value} displayValue={false} height={64} width={1} />
          </div>
        ))}
      </div>
    </div>
  )
}
