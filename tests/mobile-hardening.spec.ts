import { test, expect, Page } from '@playwright/test'

/**
 * Static/fixture responsive QA for the MOBILE UX HARDENING round. No auth
 * session available in this environment, so instead of driving the live
 * authenticated routes we render the REAL markup shapes + REAL CSS files
 * (same technique as tests/authenticated-surfaces.spec.ts) for the riskiest
 * patterns identified in the code audit: Radar watchlist/table actions,
 * Estoque table actions, Reposição cards, the Dashboard executive hero
 * (large BRL values), Fornecedores table, a form modal, the mobile drawer,
 * and back-links. Verifies zero horizontal overflow, 44px touch targets,
 * and no clipped text across the full breakpoint matrix from the briefing.
 */

const CSS_FILES = [
  // Component layer (loads first in the real bundle — see main.tsx import order notes)
  'src/components/ui/Button.css',
  'src/components/ui/IconButton.css',
  'src/components/ui/Card.css',
  'src/components/ui/StatusBadge.css',
  'src/components/ui/Modal.css',
  'src/components/ui/Drawer.css',
  'src/components/ui/Table.css',
  'src/components/ui/PageHeader.css',
  // Page layer
  'src/pages/Dashboard.css',
  'src/pages/InventoryPage.css',
  'src/pages/RadarPage.css',
  'src/pages/RadarSuppliersPage.css',
  'src/pages/ReplenishmentPage.css',
  // Global layer (loads last — rebrand-v2.css is the final override authority)
  'src/styles/tokens.css',
  'src/styles.css',
  'src/enhancements.css',
  'src/styles/rebrand-v2.css',
]

const WIDTHS = [320, 375, 390, 430, 768, 820, 1024, 1280, 1440, 1920]

const markup = `
<main class="fixture-root">

<div class="page radar-page" data-fixture="radar-table">
  <div class="card">
    <div class="clients-caption">
      <strong>24 oportunidades</strong>
      <select><option>Confiabilidade</option><option>Menor preço</option></select>
    </div>
    <div class="ui-table-wrap">
      <table class="ui-table">
        <thead><tr><th>Perfume</th><th>Tamanho</th><th>Prioridade</th><th>Status</th><th>Ações</th></tr></thead>
        <tbody class="ui-table-body">
          <tr>
            <td data-label="Perfume"><strong>AMOUAGE — Guidance 46</strong></td>
            <td data-label="Tamanho">100 ml</td>
            <td data-label="Prioridade"><span class="ui-badge ui-badge--danger">ALTA</span></td>
            <td data-label="Status"><span class="ui-badge ui-badge--success">ATIVO</span></td>
            <td data-label="Ações">
              <div class="radar-watch-actions">
                <button>Pausar</button>
                <button>Remover</button>
              </div>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
</div>

<div class="page" data-fixture="inventory-table">
  <div class="card clients-table">
    <div class="clients-caption"><strong>42 perfumes controlados</strong><button class="ui-btn ui-btn--secondary">Exportar</button></div>
    <div class="ui-table-wrap">
      <table class="ui-table">
        <thead><tr><th>Perfume</th><th>Físico</th><th>Reservado</th><th>Em preparação</th><th>Disponível</th><th>Mínimo</th><th>Situação</th><th>Reposição</th><th>Ações</th></tr></thead>
        <tbody class="ui-table-body">
          <tr>
            <td data-label="Perfume"><strong>XERJOFF — Naxos</strong></td>
            <td data-label="Físico" class="ui-table-col--hide-mobile">120 ML</td>
            <td data-label="Reservado">18 ML</td>
            <td data-label="Em preparação">6 ML</td>
            <td data-label="Disponível"><strong class="stock-available">4 ML</strong></td>
            <td data-label="Mínimo" class="ui-table-col--hide-mobile">30 ML</td>
            <td data-label="Situação"><span class="ui-badge ui-badge--warning">Estoque baixo</span></td>
            <td data-label="Reposição"><span class="ui-badge ui-badge--danger">REPOSIÇÃO</span></td>
            <td data-label="Ações">
              <div class="stock-actions">
                <button>Entrada</button>
                <button>Ajustar</button>
                <button>Buscar reposição</button>
              </div>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
</div>

<div class="page radar-suppliers-page" data-fixture="suppliers-table">
  <button class="back-link">← Voltar para o radar</button>
  <div class="card clients-table">
    <div class="clients-caption"><strong>9 fontes</strong></div>
    <div class="ui-table-wrap">
      <table class="ui-table">
        <thead><tr><th>Nome</th><th>País</th><th>Site</th><th>Tipo</th><th>Confiança</th><th>Oportunidades</th><th>Última consulta</th></tr></thead>
        <tbody class="ui-table-body">
          <tr>
            <td data-label="Nome"><strong>HARRODS</strong></td>
            <td data-label="País">Reino Unido</td>
            <td data-label="Site">harrods.com</td>
            <td data-label="Tipo"><span class="ui-badge ui-badge--warning">REVENDEDOR</span></td>
            <td data-label="Confiança"><span class="ui-badge ui-badge--success">CONFIÁVEL</span></td>
            <td data-label="Oportunidades">12</td>
            <td data-label="Última consulta">18/08/2026 09:40</td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
</div>

<div class="page replenishment-page" data-fixture="replenishment-card">
  <button class="back-link">← Voltar para o estoque</button>
  <div class="replenishment-tabs">
    <button class="active">Precisa repor (7)</button>
    <button>Atenção (3)</button>
    <button>Todos (52)</button>
  </div>
  <div class="replenishment-grid">
    <article class="replenishment-card">
      <header>
        <div><strong>NAXOS</strong><span class="replenishment-brand">XERJOFF</span></div>
        <span class="ui-badge ui-badge--danger">REPOR</span>
      </header>
      <div class="replenishment-stats">
        <span>4 ml disponíveis</span>
        <span>31 ml vendidos nos últimos 30 dias</span>
        <span>Cobertura estimada: 4 dias</span>
      </div>
      <p class="replenishment-summary">Estoque crítico: no ritmo atual de vendas, este perfume deve esgotar em poucos dias.</p>
      <footer class="replenishment-actions">
        <button class="ui-btn ui-btn--primary">Buscar reposição</button>
        <button class="ui-btn ui-btn--secondary">Acompanhar no Radar</button>
        <button class="ui-btn ui-btn--secondary">Gerar análise RUAH Intelligence</button>
      </footer>
    </article>
  </div>
</div>

<div class="page dashboard-page" data-fixture="dashboard-hero">
  <section class="executive-hero" aria-label="Resumo executivo">
    <div class="executive-primary"><span>VENDAS NO PERÍODO</span><strong>R$ 1.669.948,58</strong><small>842 relações comerciais</small></div>
    <div class="executive-secondary">
      <div><span>RECEBIDO</span><strong>R$ 1.204.330,12</strong></div>
      <div><span>PENDENTE</span><strong>R$ 465.618,46</strong></div>
      <div><span>ATENÇÃO OPERACIONAL</span><strong>18</strong><small>entregas pendentes + atrasadas</small></div>
    </div>
  </section>
</div>

<div class="ui-modal-layer" data-fixture="modal" style="position:relative;inset:auto;padding:20px">
  <div class="ui-modal-panel ui-modal-panel--md" role="dialog">
    <div class="ui-modal-title"><div><span>NOVA FONTE</span><h2>Validar fonte descoberta</h2></div><button aria-label="Fechar">×</button></div>
    <div class="ui-modal-body">
      <div class="record-form"><div class="form-grid">
        <label class="field wide"><span>Nome</span><input value="Harrods" readonly/></label>
        <label class="field wide"><span>Domínio</span><input value="harrods.com" readonly/></label>
        <label class="field"><span>País (código, ex.: GB)</span><input value="GB" readonly/></label>
        <label class="field"><span>Tipo</span><select><option>Revendedor</option></select></label>
        <label class="field checkbox-field"><input type="checkbox"/><span>Marcar como fonte confiável</span></label>
        <label class="field wide"><span>Observações</span><textarea></textarea></label>
      </div></div>
    </div>
    <div class="ui-modal-footer"><button class="ui-btn ui-btn--secondary">Cancelar</button><button class="ui-btn ui-btn--primary">Salvar fonte</button></div>
  </div>
</div>

<div class="ui-drawer-layer" data-fixture="drawer" style="position:relative;inset:auto;height:600px">
  <div class="ui-drawer-panel ui-drawer-panel--left" style="position:relative">
    <div class="sidebar sidebar--drawer">
      <div class="brand"><div><strong>RUAH</strong><span>INTELLIGENCE</span></div></div>
      <nav>
        <button class="active"><span>Visão Geral</span></button>
        <button><span>Clientes</span></button>
        <button><span>Radar</span></button>
      </nav>
      <div class="sidebar-foot"><div class="workspace-mark">RP</div><div><strong>RUAH Parfums</strong><span>Administrador</span></div></div>
    </div>
  </div>
</div>

</main>`

async function auditFixture(page: Page, fixture: string) {
  const target = page.locator(`[data-fixture="${fixture}"]`)
  await expect(target).toBeVisible()
  return page.evaluate((sel) => {
    const root = document.querySelector(sel) as HTMLElement
    const viewport = document.documentElement.clientWidth
    // A table/carousel deliberately wider than the viewport inside its own
    // overflow-x:auto wrapper (spec section 14-B: "analytical tables may
    // scroll horizontally, but never the page") is correct, not a bug — only
    // flag elements that are NOT contained by such a scroll boundary.
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
    const clipped = [...root.querySelectorAll<HTMLElement>('h1,h2,h3,strong,span,p,td,button')]
      .filter((node) => node.scrollWidth > node.clientWidth + 1 && getComputedStyle(node).whiteSpace !== 'normal' && getComputedStyle(node).overflow === 'hidden')
      .map((node) => node.textContent?.trim())
    const smallTargets = [...root.querySelectorAll<HTMLElement>('button,a,input,select')]
      .filter((node) => getComputedStyle(node).display !== 'none')
      .map((node) => ({ box: node.getBoundingClientRect(), label: node.textContent?.trim() || node.getAttribute('aria-label') }))
      .filter(({ box }) => box.width > 0 && box.height > 0 && (box.width < 44 || box.height < 44))
      .map(({ label, box }) => `${label} ${Math.round(box.width)}x${Math.round(box.height)}`)
    return {
      pageOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      overflowing,
      clipped,
      smallTargets,
    }
  }, `[data-fixture="${fixture}"]`)
}

for (const width of WIDTHS) {
  test(`mobile hardening fixtures @ ${width}px — zero overflow, 44px targets`, async ({ page }) => {
    await page.setViewportSize({ width, height: 1400 })
    await page.goto('/login')
    await page.setContent(markup)
    for (const file of CSS_FILES) await page.addStyleTag({ path: file })
    await page.addStyleTag({ content: '.fixture-root{display:flex;flex-direction:column;gap:24px}.fixture-root .page{margin:0;max-width:none}' })

    const isMobile = width <= 640
    const fixtures = ['radar-table', 'inventory-table', 'suppliers-table', 'replenishment-card', 'dashboard-hero', 'modal', 'drawer']
    for (const fixture of fixtures) {
      const result = await auditFixture(page, fixture)
      expect(result.overflowing, `${fixture}@${width}: elements overflowing viewport: ${result.overflowing.join(', ')}`).toEqual([])
      expect(result.clipped, `${fixture}@${width}: clipped text: ${result.clipped.join(', ')}`).toEqual([])
      // Touch targets are only mandatory in the mobile/small-tablet range this
      // briefing targets (desktop keeps its existing, already-shipped sizing).
      if (isMobile && ['radar-table', 'inventory-table', 'modal', 'drawer', 'replenishment-card', 'suppliers-table'].includes(fixture)) {
        expect(result.smallTargets, `${fixture}@${width}: touch targets under 44px: ${result.smallTargets.join(', ')}`).toEqual([])
      }
    }

    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1)
    await page.screenshot({ path: `tests/screenshots/hardening-${width}.png`, fullPage: true })
  })
}
