import { InventoryBottle } from '../../lib/inventory-bottles'
import { BarcodeImage } from './BarcodeImage'
import './BottleLabelPrint.css'

/**
 * Etiqueta física do frasco — 30mm x 10mm, identidade mínima (ver
 * BottleLabelPrint.css para as regras @page/@media print que fixam o
 * tamanho físico). Contém SÓ: marca RUAH + Code128 do barcode_value do
 * frasco (ex. RUAH-F000185 — a identidade FÍSICA do frasco individual,
 * nunca o token de QR). Nunca nome do perfume, ml, APC, status, preço,
 * cliente ou envio — esses pertencem ao objeto de impressão operacional
 * (ver ShipmentPrintView em Shipment360View.tsx), um identificador
 * completamente diferente do frasco. QR foi removido desta etiqueta: em
 * 30x10mm não sobra espaço para QR + Code128 + marca sem comprometer a
 * leitura do scanner, que é a prioridade.
 *
 * Legenda textual do Code128 (o "RUAH-F000185" de apoio abaixo das barras)
 * também foi desligada (displayValue=false): em 10mm de altura total,
 * reservar espaço para texto legível reduziria a altura das barras a
 * ponto de arriscar a leitura — decisão documentada aqui, a confirmar
 * fisicamente (ver relatório final: "REAL PHYSICAL PRINT 30x10mm").
 * Sempre montado (mesmo fora de impressão) para window.print() funcionar
 * sem corrida de estado — mesma técnica de .shipment-print-view.
 */
export function BottleLabelPrint({ bottles }: { bottles: InventoryBottle[] }) {
  return (
    <div className="bottle-label-print">
      <div className="bottle-label-sheet">
        {bottles.map((bottle) => (
          <div className="bottle-label-tag" key={bottle.id}>
            <span className="bottle-label-brand">RUAH</span>
            <BarcodeImage value={bottle.barcode_value} displayValue={false} height={64} width={1} />
          </div>
        ))}
      </div>
    </div>
  )
}
