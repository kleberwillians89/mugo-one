/**
 * Único ponto que sabe como abrir a etiqueta física (rota /print/bottle ou
 * /print/split — ver PrintLabelPage.tsx) — evita reimplementar a
 * construção da URL em cada lugar que tem um botão "Imprimir etiqueta"
 * (BottleOnboardingModal, BottleSplitModal, PhysicalIdentityView).
 * Nenhum dado sensível: perfume + código humano do frasco/split, nada de
 * cliente/preço/envio. O barcode_value (RUAH-<code>) é derivado dentro de
 * PrintLabelPage a partir do code, pela mesma convenção que
 * inventory_bottle_generate já usa no backend — não duplicado aqui.
 */
function openPrintTab(kind: 'bottle' | 'split', perfumeName: string, codes: string[]) {
  const params = new URLSearchParams({ perfume: perfumeName, codes: codes.join(',') })
  window.open(`/print/${kind}?${params.toString()}`, '_blank', 'width=420,height=280')
}

export function printBottleLabels(perfumeName: string, bottleCodes: string[]) {
  openPrintTab('bottle', perfumeName, bottleCodes)
}

export function printSplitLabels(perfumeName: string, splitCodes: string[]) {
  openPrintTab('split', perfumeName, splitCodes)
}
