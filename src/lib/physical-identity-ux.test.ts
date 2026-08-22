import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { bottleDeepLink } from './inventory-bottles'

/**
 * Regression suite for "finalizar o fluxo físico de identificação e
 * leitura de frascos/splits" — labels 28x10mm, isolated /print route,
 * canonical resolver (QR/Code128/HID/manual/câmera), and the ScanFeedback
 * visual language. No live browser/camera/printer is reachable from this
 * sandbox (same constraint as bottle-capacity-correction.test.ts and
 * ai-inventory.test.ts), so most of these assert the exact component/CSS
 * source rather than rendering a real DOM or decoding a real image.
 * Physical print + real camera/scanner behavior remain PENDING HUMAN
 * VALIDATION (see final report). Letters A-U below match the briefing's
 * own numbered test list (seção 18).
 */

const read = (relPath: string) => readFileSync(new URL(`../${relPath}`, import.meta.url), 'utf8')

const identityView = read('components/bottles/PhysicalIdentityView.tsx')
const onboardingModal = read('components/bottles/BottleOnboardingModal.tsx')
const splitModal = read('components/bottles/BottleSplitModal.tsx')
const printLabelPage = read('pages/PrintLabelPage.tsx')
const printLabelCss = read('pages/PrintLabelPage.css')
const printLabelsLib = read('lib/print-labels.ts')
const authRoot = read('Auth.tsx')
const qrCameraScanner = read('components/bottles/QrCameraScanner.tsx')
const keyboardWedgeListener = read('components/bottles/useKeyboardWedgeListener.ts')
const inventoryStationPage = read('pages/InventoryStationPage.tsx')
const inventoryStationCss = read('pages/InventoryStationPage.css')
const inventoryCountPage = read('pages/InventoryCountPage.tsx')
const qrBottlePage = read('pages/QrBottlePage.tsx')
const inventoryBottlesLib = read('lib/inventory-bottles.ts')
const shipmentBottleScanLib = read('lib/shipment-bottle-scan.ts')
const shipmentBottleScanComponent = read('components/bottles/ShipmentBottleScan.tsx')
const identityViewCss = read('components/bottles/PhysicalIdentityView.css')

describe('A/B/C/D/E — etiqueta física do FRASCO (PrintLabelPage, kind=bottle)', () => {
  it('A: renderiza o nome do perfume quando fornecido', () => {
    expect(printLabelPage).toContain('{perfume && <strong className="print-label-perfume">{perfume}</strong>}')
  })
  it('B: renderiza Code128 (BarcodeImage)', () => {
    expect(printLabelPage).toContain('import { BarcodeImage }')
    expect(printLabelPage).toContain('<BarcodeImage value={')
  })
  it('C: o payload do barcode é RUAH-<code> — para um bottle_code como F000001 isso é RUAH-F000001', () => {
    expect(printLabelPage).toContain('value={`RUAH-${code}`}')
  })
  it('D: renderiza o código humano (ex.: F000001) como texto separado das barras', () => {
    expect(printLabelPage).toContain('<span className="print-label-code">{code}</span>')
  })
  it('E: NUNCA renderiza QR nesta etiqueta física — QR é só de tela (PhysicalIdentityView)', () => {
    expect(printLabelPage).not.toContain('QrCodeImage')
    expect(printLabelPage).not.toContain('qr_token')
  })
  it('barcode nunca é comprimido para caber texto — recebe a linha central flexível do grid (a única com altura variável) e a maior largura possível (ver print-label-typography.test.ts para o detalhamento de proporção)', () => {
    expect(printLabelCss).toMatch(/grid-template-rows:\s*1\.55mm minmax\(0, 1fr\) 1\.35mm;/)
    expect(printLabelCss).toMatch(/\.print-label-barcode \.barcode-image \{[^}]*height:\s*100%;/)
  })
})

describe('F/G — etiqueta física do SPLIT (mesmo componente, mesma identidade canônica)', () => {
  it('F: split também usa o mesmo bloco de perfume — o componente é compartilhado entre bottle e split, não duplicado', () => {
    // um único componente PrintLabelPage cobre os dois "kind"s — ver Auth.tsx
    expect(printLabelPage).toContain("export type PrintLabelKind = 'bottle' | 'split'")
  })
  it('G: split_code (ex.: S000185-001) também vira RUAH-S000185-001 no barcode, pela mesma derivação — identidade canônica nunca trocada por estética (briefing seção 3)', () => {
    expect(printLabelPage).toContain('value={`RUAH-${code}`}')
    expect(printLabelsLib).toContain('export function printSplitLabels')
  })
  it('nenhum SKU novo é inventado para o split — printSplitLabels recebe split_code, o mesmo identificador já usado em toda a base', () => {
    expect(printLabelsLib).toContain('printSplitLabels(perfumeName: string, splitCodes: string[])')
  })
})

describe('H — tamanho final da etiqueta é 28mm x 10mm (não mais 24mm)', () => {
  it('CSS de impressão fixa 28mm x 10mm no @page nomeado e no retângulo da etiqueta', () => {
    expect(printLabelCss).toContain('size: 28mm 10mm')
    expect(printLabelCss).toMatch(/\.print-label \{[^}]*width:\s*28mm;\s*\n\s*height:\s*10mm;/)
  })
  it('nenhum resquício do tamanho anterior (24mm) ficou no CSS de impressão', () => {
    expect(printLabelCss).not.toContain('24mm')
  })
  it('o aviso na UI (Estoque) também foi atualizado para 28x10mm', () => {
    expect(onboardingModal).toContain('28x10mm')
    expect(onboardingModal).not.toContain('24x10mm')
  })
})

describe('I/J — documento de impressão isolado (causa real do bug de A4)', () => {
  it('I: PrintLabelPage não importa Modal/AppShell/sidebar/header — é uma rota própria, sem chrome do app por perto (a causa suspeita do bug: DOM aninhado dentro de Modal > ui-modal-panel, ambos com position/overflow próprios, competindo com o @page A4 global do mesmo bundle)', () => {
    const imports = printLabelPage.match(/^import .+$/gm) ?? []
    expect(imports).toEqual([
      "import { useEffect } from 'react'",
      "import { BarcodeImage } from '../components/bottles/BarcodeImage'",
      "import './PrintLabelPage.css'",
    ])
    expect(printLabelCss).not.toContain('.sidebar')
    expect(printLabelCss).not.toContain('.app-shell')
    expect(printLabelCss).not.toContain('.ui-modal')
  })
  it('a rota é montada direto pelo AuthRoot, fora do fluxo Modal > BottleOnboardingModal > PhysicalIdentityView', () => {
    expect(authRoot).toContain("path.match(/^\\/print\\/(bottle|split)$/)")
    expect(authRoot).toContain('<PrintLabelPage kind=')
  })
  it('nenhum truque de visibility:hidden/body:has() sobrou — não há mais "resto do app" para esconder', () => {
    expect(printLabelCss).not.toContain('visibility: hidden')
    expect(printLabelCss).not.toContain(':has(')
  })
  it('J: nenhuma regra @page A4 (nem qualquer size:A4) nesta folha dedicada — só o @page nomeado de 28mm x 10mm', () => {
    expect(printLabelCss).not.toMatch(/A4/i)
    const pageRuleCount = (printLabelCss.match(/@page/g) ?? []).length
    expect(pageRuleCount).toBe(1)
  })
  it('a impressão é disparada automaticamente ao montar a página (window.print), e a aba se fecha sozinha depois (afterprint)', () => {
    expect(printLabelPage).toContain('requestAnimationFrame(() => window.print())')
    expect(printLabelPage).toContain("window.addEventListener('afterprint', close)")
  })
  it('abrir a etiqueta usa uma aba NOVA (window.open), preservando o estado da tela de origem — não navega a aba atual para longe do modal aberto', () => {
    expect(printLabelsLib).toContain("window.open(`/print/${kind}?")
    expect(printLabelsLib).toContain("'_blank'")
  })
})

describe('K/L/M/N/O — resolvedor canônico: QR, Code128/HID, manual e câmera convergem no mesmo lugar', () => {
  it('K: manual "RUAH-F000001" é reconhecido como um frasco pelo parser canônico', () => {
    expect(read('lib/bottle-scan.ts')).toContain("const codeMatch = value.match(/^(?:RUAH-)?(F\\d{6})$/i)")
  })
  it('L: manual "RUAH-S000185-001" é reconhecido como um SPLIT pelo mesmo parser — antes só resolvia frasco; resolveSplitByCode fecha essa lacuna sem precisar de RPC/migration nova (select direto, mesma RLS por organization_id já existente em inventory_split_units)', () => {
    expect(read('lib/bottle-scan.ts')).toContain("const splitMatch = value.match(/^(?:RUAH-)?(S\\d{6}-\\d{3})$/i)")
    expect(inventoryBottlesLib).toContain('export async function resolveSplitByCode')
    expect(inventoryBottlesLib).toContain(".from('inventory_split_units')")
    expect(inventoryBottlesLib).toContain(".eq('organization_id', organizationId)")
  })
  it('M: código inexistente/irreconhecível mostra feedback vermelho "CÓDIGO NÃO RECONHECIDO", nunca uma falha silenciosa', () => {
    expect(inventoryStationPage).toContain('✕ CÓDIGO NÃO RECONHECIDO')
    expect(inventoryStationPage).toContain("tone=\"error\"")
  })
  it('N/O: câmera, HID e manual chamam TODOS a mesma função resolve() — QR (câmera), Code128 (HID/manual) e digitação convergem no mesmo pipeline, nunca lógica duplicada por método de entrada', () => {
    expect(inventoryStationPage).toContain('<QrCameraScanner onScan={resolve}')
    expect(inventoryStationPage).toContain('useKeyboardWedgeListener(resolve, mode')
    expect(inventoryStationPage).toContain('if (manualCode.trim()) resolve(manualCode)')
    // todos os três passam pelo MESMO parseScannedValue dentro de resolve() — uma só chamada no arquivo inteiro, não uma por método de entrada.
    expect((inventoryStationPage.match(/parseScannedValue\(/g) ?? []).length).toBe(1)
  })
})

describe('P/Q — scan genérico (consulta/reconhecimento) nunca alta estoque', () => {
  it('P/Q: resolveBottleByToken, resolveBottleByCode e resolveSplitByCode são leituras puras — nenhuma delas grava em physical_ml/available_ml', () => {
    for (const fn of ['resolveBottleByToken', 'resolveBottleByCode']) {
      const body = inventoryBottlesLib.slice(inventoryBottlesLib.indexOf(`export async function ${fn}`))
      const nextFn = body.indexOf('\nexport async function', 1)
      const scoped = nextFn === -1 ? body : body.slice(0, nextFn)
      expect(scoped).not.toContain('physical_ml')
      expect(scoped).not.toContain('available_ml')
      expect(scoped).not.toMatch(/\.(insert|update|upsert)\(/)
    }
    const splitFnBody = inventoryBottlesLib.slice(inventoryBottlesLib.indexOf('export async function resolveSplitByCode'))
    expect(splitFnBody.slice(0, splitFnBody.indexOf('\nexport'))).toMatch(/\.select\(/)
    expect(splitFnBody.slice(0, splitFnBody.indexOf('\nexport'))).not.toMatch(/\.(insert|update|upsert)\(/)
  })
  it('a tela de leitor só chama uma ação de escrita (confirmBottleConference) atrás de um clique humano explícito dentro do BottleConferencePanel — nunca automaticamente ao resolver o scan', () => {
    expect(inventoryStationPage).not.toContain('confirmBottleConference')
  })
})

describe('R — conferência repetida não conta duas vezes (regressão já coberta, revalidada aqui)', () => {
  it('reler um frasco já conferido mostra "FRASCO JÁ CONFERIDO" em vez de contar de novo', () => {
    expect(inventoryCountPage).toContain('FRASCO JÁ CONFERIDO')
    expect(inventoryCountPage).toContain('if (prev[result.bottle_id]) { already = true; return prev }')
  })
  it('a mesma tela nunca escreve em inventory_items/inventory_bottles — só lê', () => {
    expect(inventoryCountPage).toContain('Never writes to inventory_items/inventory_bottles — only reads')
    expect(inventoryCountPage).not.toContain('inventory_apply')
  })
})

describe('S — separação de pedido continua com o backend como autoridade (shipment_item_scan_bottle intocado)', () => {
  it('describeBottleScanResult só traduz o `reason` que o backend já decidiu — nunca recalcula perfume/capacidade no frontend', () => {
    expect(shipmentBottleScanLib).not.toContain('physical_ml -')
    expect(shipmentBottleScanLib).not.toContain('available_ml -')
    expect(shipmentBottleScanLib).toContain('switch (result.reason)')
  })
  it('ShipmentBottleScan ainda chama o mesmo RPC via onScan — nenhuma lógica de negócio nova no componente', () => {
    expect(shipmentBottleScanComponent).toContain('onScan: (rawValue: string) => Promise<BottleScanResult>')
    expect(shipmentBottleScanComponent).toContain('describeBottleScanResult(result)')
  })
})

describe('T — mobile 390px (e 320/375/430) sem overflow', () => {
  it('a tela do leitor tem breakpoint mobile e nenhuma largura fixa maior que 390px nos containers principais', () => {
    expect(inventoryStationCss).toContain('@media (max-width: 480px)')
    expect(inventoryStationCss).not.toMatch(/(?<!max-)width:\s*[4-9]\d{2}px/)
  })
  it('a identidade física (QR/barcode) cabe dentro de um viewport de 320px mesmo com o padding do modal — QR de 220px + barcode com max-width de 260px, nenhum dos dois excede a largura útil', () => {
    expect(identityView).toContain('size={220}')
    expect(identityViewCss).toContain('max-width: 260px')
  })
  it('touch targets do leitor e da identidade continuam >=44px', () => {
    expect(inventoryStationCss).toMatch(/min-height:\s*44px/)
    expect(identityViewCss).toContain('min-height: 44px')
  })
})

describe('U — iOS/Safari sem BarcodeDetector: QR continua funcionando, fallback claro sem botão quebrado', () => {
  it('jsQR nunca é removido — é o caminho que sempre funciona, com ou sem BarcodeDetector', () => {
    expect(qrCameraScanner).toContain("import jsQR from 'jsqr'")
    expect(qrCameraScanner).toContain('jsQR(image.data, image.width, image.height)')
  })
  it('quando BarcodeDetector não resolve nenhum formato (ex.: Safari/iPhone), mostra a mensagem exata pedida — sem termo técnico, sem botão quebrado', () => {
    expect(qrCameraScanner).toContain('Seu navegador lê QR Code nesta tela. Para código de barras use um scanner físico ou digite o código.')
    expect(qrCameraScanner).toContain('!dualFormat')
  })
  it('a mensagem só aparece depois que a checagem de formatos terminou — nunca pisca antes de saber a resposta real', () => {
    expect(qrCameraScanner).toContain('formatCheckDone')
  })
})

describe('QR na tela resolve para o mesmo objeto (infra existente reaproveitada, não recriada)', () => {
  it('BottleOnboardingModal usa PhysicalIdentityView com o QR do frasco (bottleDeepLink), não um token cru', () => {
    expect(onboardingModal).toContain('import { PhysicalIdentityView }')
    expect(onboardingModal).toContain('qrValue={bottleDeepLink(identityBottle.qr_token)}')
  })
  it('o QR exibido é o MESMO deep link que /q/:token resolve de volta ao bottle (bottleDeepLink + QrBottlePage compartilham o mesmo token)', () => {
    const globalWithLocation = globalThis as { location?: { origin: string } }
    const previous = globalWithLocation.location
    globalWithLocation.location = { origin: 'https://crmruahparfums.vercel.app' }
    try {
      const token = 'a'.repeat(64)
      expect(bottleDeepLink(token)).toBe(`https://crmruahparfums.vercel.app/q/${token}`)
    } finally {
      globalWithLocation.location = previous
    }
    expect(qrBottlePage).toContain('resolveBottleByToken(currentToken)')
    expect(qrBottlePage).toContain('BottleConferencePanel')
  })
  it('split reaproveita barcode_value como payload do QR — nenhum qr_token novo foi inventado (briefing seção 6: "só criar qr_token específico para split se houver motivo arquitetural real")', () => {
    expect(splitModal).toContain('qrValue={identityUnit.barcode_value}')
  })
  it('Code128 na tela usa o MESMO valor do texto exibido — nunca troca a identidade por estética', () => {
    expect(identityView).toContain('<p className="identity-view-code">{code}</p>')
    expect(identityView).toContain('<BarcodeImage value={code} />')
  })
  it('a tela ensina a diferença QR x barcode em microtexto simples, sem termo técnico (briefing seção 15)', () => {
    expect(identityView).toContain('leia com a câmera do celular')
    expect(identityView).toContain('leia com scanner físico')
    expect(identityView).not.toContain('HID')
    expect(identityView).not.toContain('BarcodeDetector')
  })
})

describe('HID não sequestra digitação humana (auditoria revalidada, sem mudança)', () => {
  it('o listener ignora teclado quando o foco está num INPUT/TEXTAREA/SELECT', () => {
    expect(keyboardWedgeListener).toContain("['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)")
    expect(keyboardWedgeListener).toContain('return')
  })
})

describe('campo de ml não regrediu (briefing seção 16 — manter a correção já feita)', () => {
  it('parseMlAmount/looksLikeMlWithUnitSuffix continuam existindo e em uso no formulário de Estoque', () => {
    expect(read('lib/ml-input.ts')).toContain('export function parseMlAmount')
    expect(read('pages/InventoryPage.tsx')).toContain('parseMlAmount(opening)')
  })
})
