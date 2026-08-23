import{expect,test}from'@playwright/test'
import{readFileSync}from'node:fs'

const page=readFileSync('src/pages/DaviExcelPage.tsx','utf8')
const css=readFileSync('src/pages/DaviExcelPage.css','utf8')
const portal=readFileSync('src/portal/CustomerPortalApp.tsx','utf8')

test('Davi Excel is a compact sheet, not cards',()=>{expect(page).toContain('<table>');expect(page).toContain('<thead>');expect(css).toContain('position:sticky');expect(css).toContain('overflow:auto');expect(css).toContain('min-width:1800px')})
test('Davi Excel supports server pagination and full filtered export',()=>{expect(page).toContain('fetchDaviExcel(filters,page,100,sort)');expect(page).toContain('fetchDaviExcel(filters,index,500,sort)');expect(page).toContain('if(all.length>=result.total)break')})
test('mobile keeps controlled horizontal scroll',()=>{expect(css).toContain('@media(max-width:600px)');expect(css).toContain('.davi-grid{overflow:auto')})
test('Minha RUAH has current and next shipment blocks',()=>{expect(portal).toContain('portal-shipping-snapshot');expect(portal).toContain('ENVIO EM ANDAMENTO');expect(portal).toContain('DISPONÍVEL PARA O PRÓXIMO ENVIO')})
test('request flow snapshots explicitly selected allocations across perfumes',()=>{expect(portal).toContain('selected.has(a.allocation_id)');expect(portal).toContain('createShipmentRequest([...selected], address)');expect(portal).toContain('flatMap(group=>group.available_allocations)')})
test('active shipment removes the second request CTA',()=>{expect(portal).toContain('requesting&&!activeRequest&&availableForRequest.length');expect(portal).not.toContain('SOLICITAR OUTRO ENVIO')})
