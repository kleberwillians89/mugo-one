import {readFileSync} from 'node:fs'
import {describe,expect,it} from 'vitest'

const css=readFileSync(new URL('../styles/rebrand-v2.css',import.meta.url),'utf8')
const client=readFileSync(new URL('../pages/ClientDetailsPage.tsx',import.meta.url),'utf8')
const sale=readFileSync(new URL('../pages/SaleDetailsPage.tsx',import.meta.url),'utf8')
const shipment=readFileSync(new URL('../components/Shipment360View.tsx',import.meta.url),'utf8')

describe('contrato visual de superfícies autenticadas',()=>{
  it('define papéis semânticos para dark e accent surfaces',()=>{expect(css).toContain('.surface-dark{--surface-bg:');expect(css).toContain('.surface-accent{--surface-bg:');expect(css).toContain('[data-surface-role="metric"]')})
  it('marca dados críticos dos três heróis como conteúdo, não decoração',()=>{for(const source of [client,sale,shipment]){expect(source).toContain('surface-dark');expect(source).toContain('data-surface-role="primary"')}expect(client.match(/data-surface-role="metric"/g)).toHaveLength(3);expect(sale).toContain('data-surface-role="metric"')})
  it('traduz o status do cliente somente na apresentação',()=>{expect(client).toContain('operationalLabel(client.status)');expect(client).not.toContain('>{client.status}</span>')})
  it('preserva handlers operacionais nos componentes visuais',()=>{expect(sale).toContain('onClick={()=>setConfirming(true)}');expect(shipment).toContain('onClick={onEdit}')})
})
