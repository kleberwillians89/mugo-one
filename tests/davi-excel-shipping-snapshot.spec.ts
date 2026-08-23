import{expect,test}from'@playwright/test'
import{readFileSync}from'node:fs'

const page=readFileSync('src/pages/DaviExcelPage.tsx','utf8')
const css=readFileSync('src/pages/DaviExcelPage.css','utf8')
const portal=readFileSync('src/portal/CustomerPortalApp.tsx','utf8')

test('Davi Excel is a compact sheet, not cards',()=>{expect(page).toContain('<table>');expect(page).toContain('<thead>');expect(css).toContain('position:sticky');expect(css).toContain('overflow:auto');expect(css).toContain('min-width:1960px')})
test('Davi Excel supports server pagination and full filtered export',()=>{expect(page).toContain('fetchDaviExcel(filters,page,100,sorts)');expect(page).toContain('fetchDaviExcel(filters,index,500,sorts)');expect(page).toContain('if(all.length>=result.total)break')})
test('mobile keeps controlled horizontal scroll',()=>{expect(css).toContain('@media(max-width:700px)');expect(css).toContain('.davi-grid{overflow:auto')})
test('Minha RUAH has current and next shipment blocks',()=>{expect(portal).toContain('portal-shipping-snapshot');expect(portal).toContain('ENVIO EM ANDAMENTO');expect(portal).toContain('DISPONÍVEL PARA O PRÓXIMO ENVIO')})
test('request flow snapshots explicitly selected allocations across perfumes',()=>{expect(portal).toContain('selected.has(a.allocation_id)');expect(portal).toContain('createShipmentRequest([...selected], address)');expect(portal).toContain('flatMap(group=>group.available_allocations)')})
test('active shipment removes the second request CTA',()=>{expect(portal).toContain('requesting&&!activeRequest&&availableForRequest.length');expect(portal).not.toContain('SOLICITAR OUTRO ENVIO')})
test('all thirteen columns expose an accessible filter trigger',()=>{expect(page).toContain('columns.map(column=>');expect(page).toContain('aria-expanded={open===column.key}');expect(page).toContain("aria-label={`${column.label}${active?' — filtro ativo':''}`}");expect((page.match(/key:'(client|sale_date|deadline|shipped_at|type|volume|perfume|amount|payment|method|paid_at|credit|notes)'/g)??[]).length).toBe(13)})
test('Excel-like menu supports conditions, values, select all and delayed apply',()=>{expect(page).toContain('FILTRAR POR CONDIÇÃO');expect(page).toContain('FILTRAR POR VALORES');expect(page).toContain('Selecionar todos');expect(page).toContain('LIMPAR FILTRO DESTA COLUNA');expect(page).toContain('>APLICAR<')})
test('column filters combine without resetting siblings',()=>{expect(page).toContain('const next={...(current.columns??{})}');expect(page).toContain('next[key]=filter');expect(page).toContain('delete next[key]')})
test('filter menu is keyboard dismissible and not clipped by sheet overflow',()=>{expect(page).toContain("if(event.key==='Escape')onClose()");expect(page).toContain("document.addEventListener('mousedown',close)");expect(css).toContain('.davi-filter-menu{position:fixed')})
test('expanded sheet hides sidebar and app header while preserving its toolbar',()=>{expect(css).toContain('html.davi-sheet-mode .app-shell>.sidebar{display:none!important}');expect(css).toContain('html.davi-sheet-mode .app-shell>main{width:100%!important');expect(page).toContain('SAIR DA TELA CHEIA')})
test('client column and header remain frozen at spreadsheet density',()=>{expect(css).toContain('.davi-grid th{position:sticky');expect(css).toContain('.davi-grid th:first-child,.davi-grid td:first-child{position:sticky;left:0');expect(css).toContain('height:29px')})
