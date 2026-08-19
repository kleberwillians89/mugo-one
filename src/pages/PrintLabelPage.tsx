import { useEffect } from 'react'
import { BarcodeImage } from '../components/bottles/BarcodeImage'
import './PrintLabelPage.css'

export type PrintLabelKind = 'bottle' | 'split'

/**
 * Documento de impressão ISOLADO — rota própria (/print/bottle,
 * /print/split), sem AppShell/sidebar/header/Modal por perto. A versão
 * anterior renderizava a etiqueta escondida dentro do modal de estoque
 * (Modal > ui-modal-panel > ui-modal-body, todos com position/overflow
 * próprios) e tentava esconder o resto do app via CSS
 * (visibility:hidden + @page nomeado). No smoke real isso caiu para A4 com
 * a etiqueta minúscula num canto — o suspeito mais forte é o mecanismo de
 * `page:` do CSS não resolver de forma confiável quando o elemento alvo
 * está a vários níveis de ancestrais com position:absolute/overflow, e
 * competindo no mesmo bundle global com o @page{size:A4} de
 * enhancements.css (ShipmentPrintView).
 *
 * Esta página elimina a causa em vez de tentar mascará-la: é aberta numa
 * aba NOVA (window.open, ver src/lib/print-labels.ts), e o React aqui
 * renderiza SÓ a etiqueta — nenhum outro elemento existe no documento para
 * esconder. `@page` nomeado continua sendo usado (não um @page global sem
 * nome, que colidiria com o de enhancements.css se algum dia esta aba
 * carregasse o mesmo bundle antes de navegar para outro lugar), mas agora
 * aplicado a um DOM raso, direto abaixo do body — sem nenhum ancestral
 * position/overflow no meio.
 */
export function PrintLabelPage({ kind }: { kind: PrintLabelKind }) {
  const params = new URLSearchParams(location.search)
  const perfume = params.get('perfume') ?? ''
  const codes = (params.get('codes') ?? '').split(',').map((code) => code.trim()).filter(Boolean)

  useEffect(() => {
    document.title = kind === 'bottle' ? 'Etiqueta de frasco — RUAH' : 'Etiqueta de split — RUAH'
    if (codes.length === 0) return
    const frame = requestAnimationFrame(() => window.print())
    const close = () => window.close()
    window.addEventListener('afterprint', close)
    return () => { cancelAnimationFrame(frame); window.removeEventListener('afterprint', close) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  if (codes.length === 0) {
    return <div className="print-label-empty">Nada para imprimir — feche esta aba e tente novamente a partir do Estoque.</div>
  }

  return (
    <div className="print-label-root">
      {codes.map((code) => (
        <div className="print-label" key={code}>
          {perfume && <strong className="print-label-perfume">{perfume}</strong>}
          <div className="print-label-barcode">
            <BarcodeImage value={`RUAH-${code}`} displayValue={false} height={64} width={1} margin={2} />
          </div>
          <span className="print-label-code">{code}</span>
        </div>
      ))}
    </div>
  )
}
