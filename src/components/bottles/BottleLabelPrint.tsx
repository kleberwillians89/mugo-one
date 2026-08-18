import { InventoryBottle } from '../../lib/inventory-bottles'
import { bottleDeepLink } from '../../lib/inventory-bottles'
import { QrCodeImage } from './QrCodeImage'
import { BarcodeImage } from './BarcodeImage'
import './BottleLabelPrint.css'

/**
 * Print-only content (briefing section 19/21): fixed identity fields only —
 * never ml, APC, status, price, reserved/available. Always mounted so
 * window.print() works without a state race, hidden on screen and shown
 * only under @media print — same technique as .shipment-print-view.
 */
export function BottleLabelPrint({ bottles, brandHouse, perfumeName }:{ bottles:InventoryBottle[]; brandHouse:string|null; perfumeName:string }) {
  return (
    <div className="bottle-label-print">
      <div className="bottle-label-sheet">
        {bottles.map((bottle) => (
          <div className="bottle-label-tag" key={bottle.id}>
            <span className="bottle-label-brand">RUAH</span>
            <strong className="bottle-label-perfume">{perfumeName}</strong>
            <span className="bottle-label-frasco">{bottle.bottle_label}</span>
            <QrCodeImage value={bottleDeepLink(bottle.qr_token)} size={120} />
            <BarcodeImage value={bottle.barcode_value} />
            {brandHouse && <small className="bottle-label-house">{brandHouse}</small>}
          </div>
        ))}
      </div>
    </div>
  )
}
