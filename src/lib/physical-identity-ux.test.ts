import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { bottleDeepLink } from './inventory-bottles'

/**
 * Regression suite for the "etiqueta/QR/câmera/scanner" UX pass. No live
 * browser/camera/printer is reachable from this sandbox (same constraint as
 * bottle-capacity-correction.test.ts and ai-inventory.test.ts), so most of
 * these assert the exact component/CSS source rather than rendering a real
 * DOM or decoding a real image. Physical print + real camera/scanner
 * behavior remain PENDING HUMAN VALIDATION (see final report).
 */

const read = (relPath: string) => readFileSync(new URL(`../${relPath}`, import.meta.url), 'utf8')

const identityView = read('components/bottles/PhysicalIdentityView.tsx')
const onboardingModal = read('components/bottles/BottleOnboardingModal.tsx')
const splitModal = read('components/bottles/BottleSplitModal.tsx')
const bottleLabelTsx = read('components/bottles/BottleLabelPrint.tsx')
const bottleLabelCss = read('components/bottles/BottleLabelPrint.css')
const splitLabelTsx = read('components/bottles/SplitLabelPrint.tsx')
const splitLabelCss = read('components/bottles/SplitLabelPrint.css')
const qrCameraScanner = read('components/bottles/QrCameraScanner.tsx')
const keyboardWedgeListener = read('components/bottles/useKeyboardWedgeListener.ts')
const inventoryStationPage = read('pages/InventoryStationPage.tsx')
const inventoryCountPage = read('pages/InventoryCountPage.tsx')
const qrBottlePage = read('pages/QrBottlePage.tsx')

describe('A/B — QR na tela resolve para o mesmo objeto (frasco)', () => {
  it('A: BottleOnboardingModal mostra PhysicalIdentityView com o QR do frasco (bottleDeepLink), não um token cru', () => {
    expect(onboardingModal).toContain('import { PhysicalIdentityView }')
    expect(onboardingModal).toContain('qrValue={bottleDeepLink(identityBottle.qr_token)}')
  })
  it('B: o QR exibido é o MESMO deep link que /q/:token resolve de volta ao bottle (bottleDeepLink + QrBottlePage compartilham o mesmo token)', () => {
    // Sem DOM/location neste ambiente de teste (mesma limitação documentada
    // no topo do arquivo) — stub mínimo só para exercitar a função real.
    const globalWithLocation = globalThis as { location?: { origin: string } }
    const previous = globalWithLocation.location
    globalWithLocation.location = { origin: 'https://crm.ruahparfums.com.br' }
    try {
      const token = 'a'.repeat(64)
      expect(bottleDeepLink(token)).toBe(`https://crm.ruahparfums.com.br/q/${token}`)
    } finally {
      globalWithLocation.location = previous
    }
    // QrBottlePage — o destino do deep link — resolve exatamente por esse token, via o mesmo RPC que o scanner usa.
    expect(qrBottlePage).toContain('resolveBottleByToken(currentToken)')
    expect(qrBottlePage).toContain('BottleConferencePanel')
  })
  it('split reaproveita barcode_value como payload do QR — nenhum qr_token novo foi inventado para split (briefing seção 3: só criar se houver motivo arquitetural real)', () => {
    expect(splitModal).toContain('qrValue={identityUnit.barcode_value}')
    expect(read('lib/inventory-bottles.ts')).not.toContain('qr_token:string; source_bottle_id') // InventorySplitUnit type never gained a qr_token field
  })
})

describe('C — Code128 na tela continua a identidade canônica (RUAH-F...)', () => {
  it('PhysicalIdentityView passa o MESMO valor para o texto e para o BarcodeImage — nunca troca por estética', () => {
    expect(identityView).toContain('<p className="identity-view-code">{code}</p>')
    expect(identityView).toContain('<BarcodeImage value={code} />')
  })
  it('bottle: code é barcode_value (RUAH-F...), nunca qr_token', () => {
    expect(onboardingModal).toContain('code={identityBottle.barcode_value}')
  })
  it('split: code é barcode_value (RUAH-S...-...), a mesma identidade impressa na etiqueta física', () => {
    expect(splitModal).toContain('code={identityUnit.barcode_value}')
  })
})

describe('D — etiquetas físicas usam 24x10mm (reduzido de 30x10mm)', () => {
  it('bottle label: @page e o retângulo da etiqueta são exatamente 24mm x 10mm', () => {
    expect(bottleLabelCss).toContain('size: 24mm 10mm')
    expect(bottleLabelCss).toContain('width: 24mm')
    expect(bottleLabelCss).toContain('height: 10mm')
    // .bottle-label-tag { width: ...; height: ... } deve ser 24mm/10mm, não 30mm — comentários que MENCIONAM 30mm (contexto histórico) são esperados e não checados aqui.
    expect(bottleLabelCss).toMatch(/\.bottle-label-tag\s*\{\s*\n\s*width:\s*24mm;\s*\n\s*height:\s*10mm;/)
  })
  it('split label: mesma redução para 24mm x 10mm', () => {
    expect(splitLabelCss).toContain('size: 24mm 10mm')
    expect(splitLabelCss).toContain('width: 24mm')
    expect(splitLabelCss).toContain('height: 10mm')
    expect(splitLabelCss).toMatch(/\.split-label-tag\s*\{\s*\n\s*width:\s*24mm;\s*\n\s*height:\s*10mm;/)
  })
})

describe('S — QR não precisa (e não está) na etiqueta física 24x10', () => {
  it('BottleLabelPrint renderiza só Code128 — nenhum QrCodeImage', () => {
    expect(bottleLabelTsx).not.toContain('QrCodeImage')
    expect(bottleLabelTsx).toContain('BarcodeImage')
  })
  it('SplitLabelPrint renderiza só perfume + Code128 — nenhum QrCodeImage', () => {
    expect(splitLabelTsx).not.toContain('QrCodeImage')
    expect(splitLabelTsx).toContain('BarcodeImage')
  })
})

describe('E — etiqueta do split contém nome do perfume + Code128, identidade inalterada', () => {
  it('SplitLabelPrint recebe e renderiza perfumeName, e o Code128 usa unit.barcode_value (RUAH-S...)', () => {
    expect(splitLabelTsx).toContain('perfumeName')
    expect(splitLabelTsx).toContain('<strong className="split-label-perfume">{perfumeName}</strong>')
    expect(splitLabelTsx).toContain('value={unit.barcode_value}')
  })
})

describe('F/G — câmera aceita QR e Code128', () => {
  it('F: jsQR continua como fallback obrigatório (QR sempre funciona, mesmo sem BarcodeDetector)', () => {
    expect(qrCameraScanner).toContain("import jsQR from 'jsqr'")
    expect(qrCameraScanner).toContain('jsQR(image.data, image.width, image.height)')
  })
  it('G: BarcodeDetector é tentado com os formatos qr_code e code_128, feature-detectado via getSupportedFormats antes de usar', () => {
    expect(qrCameraScanner).toContain("['qr_code', 'code_128']")
    expect(qrCameraScanner).toContain('getSupportedFormats()')
    expect(qrCameraScanner).toContain('.detect(canvas)')
  })
  it('nenhuma dependência nova foi introduzida para isso — BarcodeDetector é API nativa do navegador (briefing seção 5)', () => {
    expect(qrCameraScanner).not.toMatch(/from ['"]@?zxing/i)
    expect(qrCameraScanner).not.toContain('quagga')
  })
})

describe('H/I — HID (scanner físico) resolve identidade sem sequestrar digitação humana', () => {
  it('H: InventoryStationPage liga o listener HID direto a resolve() (parseScannedValue → resolveBottleByToken/Code) — mesmo pipeline do bipe manual/câmera', () => {
    expect(inventoryStationPage).toContain('useKeyboardWedgeListener(resolve, mode')
    expect(inventoryStationPage).toContain('parseScannedValue(raw)')
  })
  it('I: o listener ignora teclado quando o foco está num INPUT/TEXTAREA/SELECT — nunca sequestra digitação normal de formulário', () => {
    expect(keyboardWedgeListener).toContain("['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)")
    expect(keyboardWedgeListener).toContain('return')
  })
})

describe('J/K — conferência em lote (InventoryCountPage) nunca escreve estoque e não conta duplicado', () => {
  it('J: comentário e RPCs usados confirmam que a tela só lê (fetchTrackingPreview/resolveBottleByToken/resolveBottleByCode) — nenhuma chamada de escrita', () => {
    expect(inventoryCountPage).toContain('Never writes to inventory_items/inventory_bottles — only reads')
    expect(inventoryCountPage).not.toContain('confirmBottleConference')
    expect(inventoryCountPage).not.toContain('inventory_apply')
  })
  it('K: reler um frasco já conferido mostra "FRASCO JÁ CONFERIDO" em vez de contar de novo', () => {
    expect(inventoryCountPage).toContain('FRASCO JÁ CONFERIDO')
    expect(inventoryCountPage).toContain('if (prev[result.bottle_id]) { already = true; return prev }')
  })
})

describe('Q/R — mobile e print view', () => {
  it('Q: os alvos de toque da lista de frascos/identidade continuam ≥44px em mobile (nada regrediu ao adicionar o botão "Identidade")', () => {
    expect(read('components/bottles/BottleOnboardingModal.css')).toContain('min-height: 44px')
    expect(read('components/bottles/PhysicalIdentityView.css')).toContain('min-height: 44px')
  })
  it('R: print view da etiqueta esconde todo o chrome do app (sidebar/header/modal) — nunca uma folha A4 do app por trás da etiqueta', () => {
    for (const css of [bottleLabelCss, splitLabelCss]) {
      expect(css).toContain('.sidebar, .app-shell > main > header')
      expect(css).toContain('display: none !important')
      expect(css).toMatch(/@page [\w-]+ \{\s*size: 24mm 10mm;\s*margin: 0;/)
    }
  })
})
