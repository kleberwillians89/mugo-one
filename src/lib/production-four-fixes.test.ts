import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'

const read=(path:string)=>readFileSync(path,'utf8')
const legacySaleModal=read('src/legacy/sales/LegacySaleModal.tsx')
const records=read('src/lib/records.ts')
const comboboxCss=read('src/components/ui/EntityCombobox.css')
const dateField=read('src/components/DateField.tsx')
const styles=read('src/styles.css')
const portal=read('src/portal/CustomerPortalRoot.tsx')

describe('production fixes — sale modal',()=>{
  it('keeps the client search icon clear of its placeholder',()=>{expect(comboboxCss).toContain('padding:10px 76px 10px 44px!important');expect(comboboxCss).toContain('left:14px')})
  it('uses EntityCombobox for the sale perfume instead of a free text Field (legacy modal, isolated — Fase F, ver docs/SALES_CATALOG_MIGRATION_PLAN.md)',()=>{const sale=legacySaleModal.slice(legacySaleModal.indexOf('export function LegacySaleModal'),legacySaleModal.indexOf('function Field'));expect(sale).toContain('label="Perfume *"');expect(sale).toContain('search={perfumeSearch}');expect(sale).not.toContain('<Field label="Perfume *"')})
  it('persists and revalidates the selected perfume ID inside the organization (legacy modal)',()=>{expect(legacySaleModal).toContain('perfumeId:perfume.id');const create=records.slice(records.indexOf('export async function createSale'),records.indexOf('export async function parseSaleAssistant'));expect(create).toContain(".eq('organization_id',organizationId).eq('id',input.perfumeId).single()");expect(create).toContain('perfume_id:perfume.id');expect(create).not.toContain("from('perfumes').insert")})
  it('renders one compact anchored month',()=>{expect(dateField).toContain('captionLayout="label"');expect(dateField).toContain('fixedWeeks');expect(dateField).not.toContain('captionLayout="dropdown"');expect(styles).toContain('width:min(320px,calc(100vw - 32px))');expect(styles).toContain('--rdp-day_button-width:34px')})
})

describe('production fixes — Minha RUAH login',()=>{
  it('exposes the canonical public login route and required actions',()=>{expect(portal).toContain("path === '/minha-ruah/entrar'");expect(portal).toContain("signInWithPassword");expect(portal).toContain("'ENTRAR'");expect(portal).toContain('Esqueci minha senha');expect(portal).toContain('Ainda não tenho acesso');expect(portal).toContain("go('/minha-ruah/cadastro')")})
  it('redirects anonymous private access to entrar',()=>{expect(portal).toContain("if (!session) { go('/minha-ruah/entrar'); return null }")})
  it('keeps password recovery linked and functional',()=>{expect(portal).toContain("go('/minha-ruah/recuperar')");expect(portal).toContain('resetPasswordForEmail');expect(portal).toContain("redirectTo:`${location.origin}/minha-ruah/redefinir-senha`")})
})
