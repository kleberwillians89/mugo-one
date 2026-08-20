import { test, expect, Page } from '@playwright/test'

/**
 * RUAH — GLOBAL MOBILE REVIEW & HARDENING. Fixture QA for the surfaces this
 * round specifically newly audited/fixed and that no earlier spec covers:
 * the real <Table> component wrapped in .clients-table (Clientes/Vendas/
 * Entregas/Estoque/Fornecedores all use this combination — this is where a
 * legacy 2-column card grid was found silently fighting the shared table's
 * own full-width stacked-row mobile layout), Cliente 360 / Venda 360 column
 * collapse, the SuperFrete quote grid, a lone .form-actions button, and the
 * Relatórios/Importação/IA/Insights/Configurações headers. Login/recovery/
 * password/callback share one AuthLayout already covered by
 * tests/responsive.spec.ts; Radar/Estoque/Reposição/Dashboard/QR fixtures
 * already live in tests/mobile-hardening.spec.ts and
 * tests/bottle-identity.spec.ts — not duplicated here.
 */

const CSS_FILES = [
  'src/components/ui/Button.css',
  'src/components/ui/Table.css',
  'src/components/ui/Modal.css',
  'src/styles/tokens.css',
  'src/styles.css',
  'src/enhancements.css',
  'src/styles/rebrand-v2.css',
]

const WIDTHS = [320, 360, 375, 390, 430, 768, 820, 1024, 1280, 1440, 1920]

const markup = `
<div class="page" data-fixture="clients-list">
  <div class="card clients-table">
    <div class="clients-caption"><div><strong>128 clientes</strong><span>Dados reais no período selecionado</span></div><span class="live-dot">SUPABASE</span></div>
    <div class="ui-table-wrap">
      <table class="ui-table">
        <thead><tr><th>Cliente</th><th>Pago</th><th>Aguardando</th><th>Compras</th><th>Ticket médio</th><th>Perfume preferido</th><th>Volume</th><th>Relação</th><th>Última compra</th><th>Ação</th></tr></thead>
        <tbody class="ui-table-body">
          <tr>
            <td data-label="Cliente"><strong class="client-primary-name">TATIANA CARVALHO DE ALBUQUERQUE</strong></td>
            <td data-label="Pago">R$ 12.430,00</td>
            <td data-label="Aguardando">R$ 890,00</td>
            <td data-label="Compras">18</td>
            <td data-label="Ticket médio">R$ 690,55</td>
            <td data-label="Perfume preferido">Xerjoff Naxos</td>
            <td data-label="Volume">640 ml</td>
            <td data-label="Relação"><span class="ui-badge ui-badge--success">recorrente</span></td>
            <td data-label="Última compra">12/08/2026</td>
            <td data-label="Ação"><span class="table-action-copy">Abrir dossiê</span></td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
</div>

<div class="page" data-fixture="sales-list">
  <div class="card clients-table">
    <div class="clients-caption"><div><strong>3.482 vendas filtradas</strong><span>R$ 48.210,00 nesta página</span></div><span class="live-dot">SUPABASE</span></div>
    <div class="ui-table-wrap">
      <table class="ui-table">
        <thead><tr><th>Data</th><th>Cliente</th><th>Perfume</th><th>Tipo</th><th>ML</th><th>Valor</th><th>Pagamento</th><th>Forma</th><th>Entrega</th><th>Origem</th><th>Ações</th></tr></thead>
        <tbody class="ui-table-body">
          <tr>
            <td data-label="Data">12/08/2026</td>
            <td data-label="Cliente"><strong>Duda Lazzarini de Oliveira</strong></td>
            <td data-label="Perfume">Sissa - Mind Games (Frasco 2)</td>
            <td data-label="Tipo">SPLIT</td>
            <td data-label="ML">50 ml</td>
            <td data-label="Valor">R$ 1.395,00</td>
            <td data-label="Pagamento"><span class="badge pending">Aguardando</span></td>
            <td data-label="Forma">PIX</td>
            <td data-label="Entrega">Sem registro</td>
            <td data-label="Origem">Manual</td>
            <td data-label="Ações"><button>Ver detalhes</button></td>
          </tr>
        </tbody>
      </table>
    </div>
    <div class="table-foot"><button disabled>Anterior</button><span>Página 1 de 70</span><button>Próxima</button></div>
  </div>
</div>

<div class="page" data-fixture="dossier-columns">
  <header class="dossier-head surface-dark">
    <span class="dossier-eyebrow">CLIENTE</span>
    <h1 class="dossier-name" data-surface-role="primary">TATIANA CARVALHO DE ALBUQUERQUE</h1>
    <p class="dossier-since" data-surface-role="secondary">Cliente desde Março de 2026</p>
    <div class="dossier-stats"><div><strong data-surface-role="metric">89</strong><span>compras</span></div><div><strong data-surface-role="metric">R$ 49.128,70</strong><span>comprados</span></div></div>
    <div class="dossier-actions"><button class="ui-btn ui-btn--secondary">Editar cadastro</button><span class="badge paid">ATIVO</span></div>
  </header>
  <section class="dossier-columns">
    <div><h3>Contato</h3><dl><dt>Telefone</dt><dd>(11) 98888-7777</dd></dl></div>
    <div><h3>Documentos</h3><dl><dt>CPF</dt><dd>000.000.000-00</dd></dl></div>
    <div><h3>Endereço</h3><dl><dt>Cidade/UF</dt><dd>São Paulo / SP</dd></dl></div>
  </section>
</div>

<div class="page" data-fixture="ficha-columns">
  <header class="ficha-head surface-dark">
    <span class="ficha-eyebrow">VENDA</span>
    <h1 class="ficha-client" data-surface-role="primary">DUDA LAZZARINI DE OLIVEIRA</h1>
    <p class="ficha-product" data-surface-role="secondary">SISSA - MIND GAMES (FRASCO 2) · 50 ml · APC</p>
    <div class="ficha-price-row"><strong data-surface-role="metric">R$ 1.395,00</strong><span class="badge pending">AGUARDANDO</span></div>
    <div class="ficha-actions"><button class="ui-btn ui-btn--secondary">Ver cliente</button><button class="ui-btn ui-btn--primary">Confirmar produto</button></div>
  </header>
  <section class="ficha-columns">
    <article class="card client-panel"><h3>Compra</h3><dl><dt>Perfume</dt><dd>Sissa - Mind Games</dd></dl></article>
    <article class="card client-panel"><h3>Logística</h3><dl><dt>Status</dt><dd>Preparando produtos</dd></dl></article>
  </section>
</div>

<div class="page" data-fixture="quote-grid">
  <div class="quote-grid">
    <button><strong>Correios · SEDEX</strong><span>R$ 42,80</span><small>3 dias úteis</small></button>
    <button><strong>Jadlog · .Package</strong><span>R$ 28,10</span><small>5 dias úteis</small></button>
  </div>
</div>

<div class="page" data-fixture="lone-form-action">
  <div class="card settings-card">
    <div class="record-form">
      <div class="form-grid"><label class="field wide"><span>Nome do remetente</span><input value="RUAH Parfums"/></label></div>
      <div class="form-actions"><button class="primary">Salvar configuração</button></div>
    </div>
  </div>
</div>

<div class="page" data-fixture="reports">
  <div class="page-lead"><div><h2>Relatórios</h2><p>Resumo financeiro e comparação matemática entre períodos.</p></div><div class="page-actions"><button>Exportar</button></div></div>
  <div class="card clients-table">
    <div class="clients-caption"><strong>Comparação com o período anterior</strong></div>
    <table><thead><tr><th>Indicador</th><th>Atual</th><th>Anterior</th><th>Variação</th></tr></thead>
      <tbody><tr><td>Valor pago</td><td>R$ 48.210,00</td><td>R$ 41.900,00</td><td>15,1%</td></tr></tbody>
    </table>
  </div>
</div>

<div class="page" data-fixture="ia-chat">
  <div class="page-lead"><div><span class="eyebrow">ASSISTENTE EXECUTIVO</span><h2>RUAH Intelligence</h2></div></div>
  <div class="chat-box card">
    <div class="ai-metric-grid">
      <article><span>Vendas</span><strong>842</strong><p>no período</p></article>
      <article><span>Ticket médio</span><strong>R$ 1.983,00</strong><p>por venda</p></article>
    </div>
    <div class="chat-input"><textarea placeholder="Pergunte sobre faturamento, clientes, pagamentos…"></textarea><button aria-label="Enviar pergunta">Enviar</button></div>
  </div>
</div>

<div class="page" data-fixture="insights">
  <div class="page-lead"><div><h2>Insights comerciais</h2></div><button class="primary">Gerar novos insights</button></div>
  <div class="insight-grid">
    <article class="card insight-skeleton"><div><span>Pagamentos aguardando</span><i>REAL</i></div><h3>12 vendas · R$ 8.400,00</h3></article>
  </div>
</div>
`

async function auditFixture(page: Page, fixture: string) {
  const target = page.locator(`[data-fixture="${fixture}"]`)
  await expect(target).toBeVisible()
  return page.evaluate((sel) => {
    const root = document.querySelector(sel) as HTMLElement
    const viewport = document.documentElement.clientWidth
    const insideScrollContainer = (node: HTMLElement) => {
      for (let el: HTMLElement | null = node.parentElement; el && el !== root.parentElement; el = el.parentElement) {
        const style = getComputedStyle(el)
        if ((style.overflowX === 'auto' || style.overflowX === 'scroll') && el.scrollWidth > el.clientWidth) return true
      }
      return false
    }
    const overflowing = [...root.querySelectorAll<HTMLElement>('*')]
      .filter((node) => node.getBoundingClientRect().width > 0 && node.getBoundingClientRect().right > viewport + 1)
      .filter((node) => !insideScrollContainer(node))
      .map((node) => `${node.tagName}.${[...node.classList].join('.')}`)
    // Detects the specific bug this round found: the legacy .clients-table
    // mobile grid (display:grid, 2 columns) leaking onto <Table>'s own
    // .ui-table rows, which must always be either a normal table-row
    // (desktop) or block (mobile card mode) — never grid, at any width.
    const crampedRows = [...root.querySelectorAll<HTMLElement>('.ui-table tbody tr')]
      .filter((row) => getComputedStyle(row).display === 'grid')
      .map((row) => row.textContent?.trim().slice(0, 80))
    const smallTargets = [...root.querySelectorAll<HTMLElement>('button,a,input,select')]
      .filter((node) => getComputedStyle(node).display !== 'none')
      .map((node) => {
        const isBareCheckable = (node as HTMLInputElement).type === 'checkbox' || (node as HTMLInputElement).type === 'radio'
        const label = isBareCheckable ? node.closest('label') : null
        const measured = label ?? node
        return { box: measured.getBoundingClientRect(), label: node.textContent?.trim() || node.getAttribute('aria-label') || node.getAttribute('placeholder') }
      })
      .filter(({ box }) => box.width > 0 && box.height > 0 && (box.width < 44 || box.height < 44))
      .map(({ label, box }) => `${label} ${Math.round(box.width)}x${Math.round(box.height)}`)
    return { overflowing, crampedRows, smallTargets }
  }, `[data-fixture="${fixture}"]`)
}

for (const width of WIDTHS) {
  test(`global mobile review fixtures @ ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 1600 })
    await page.goto('/login')
    await page.setContent(markup)
    for (const file of CSS_FILES) await page.addStyleTag({ path: file })
    await page.addStyleTag({ content: 'body{display:flex;flex-direction:column;gap:24px}.page{margin:0;max-width:none}' })

    const isMobile = width <= 640
    const fixtures = ['clients-list', 'sales-list', 'dossier-columns', 'ficha-columns', 'quote-grid', 'lone-form-action', 'reports', 'ia-chat', 'insights']
    for (const fixture of fixtures) {
      const result = await auditFixture(page, fixture)
      expect(result.overflowing, `${fixture}@${width}: overflow: ${result.overflowing.join(', ')}`).toEqual([])
      expect(result.crampedRows, `${fixture}@${width}: fields sharing a row instead of one-per-line (the .clients-table/.ui-table collision): ${result.crampedRows.join(' | ')}`).toEqual([])
      if (isMobile) expect(result.smallTargets, `${fixture}@${width}: touch targets under 44px: ${result.smallTargets.join(', ')}`).toEqual([])
    }

    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1)
    if ([320, 360, 375, 390, 430, 768, 1024, 1280, 1440, 1920].includes(width)) await page.screenshot({ path: `tests/screenshots/global-review-${width}.png`, fullPage: true })
  })
}

test('lone .form-actions button spans full width on mobile (not half-width in a 2-col grid)', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 900 })
  await page.goto('/login')
  await page.setContent(markup)
  for (const file of CSS_FILES) await page.addStyleTag({ path: file })
  const tracks = await page.locator('[data-fixture="lone-form-action"] .form-actions').evaluate((el) => getComputedStyle(el).gridTemplateColumns.trim().split(/\s+/).length)
  expect(tracks, 'a lone button must get a single-column grid, not the two-button 1fr/1.25fr split').toBe(1)
  const button = page.locator('[data-fixture="lone-form-action"] .form-actions button')
  const actions = page.locator('[data-fixture="lone-form-action"] .form-actions')
  const [buttonBox, contentWidth] = await Promise.all([
    button.boundingBox(),
    actions.evaluate((el) => el.clientWidth - parseFloat(getComputedStyle(el).paddingLeft) - parseFloat(getComputedStyle(el).paddingRight)),
  ])
  expect(buttonBox!.width).toBeGreaterThan(contentWidth * 0.95)
})
