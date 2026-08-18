import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const suppliersPage = readFileSync(new URL('./RadarSuppliersPage.tsx', import.meta.url), 'utf8')

describe('RadarSuppliersPage: botão de seed só para admin/manager', () => {
  it('gate do botão usa canManageSources (admin ou manager)', () => {
    expect(suppliersPage).toContain("const canManageSources = role === 'admin' || role === 'manager'")
    expect(suppliersPage).toContain('{canManageSources && <SecondaryButton icon={<Download size={16} />} onClick={() => setShowSeedConfirm(true)}>Carregar fontes iniciais</SecondaryButton>}')
  })

  it('busca o papel do usuário antes de decidir o que mostrar', () => {
    expect(suppliersPage).toContain('fetchRadarRole()')
  })
})

describe('RadarSuppliersPage: confirmação antes de carregar fontes', () => {
  it('mostra o texto de confirmação exato do spec', () => {
    expect(suppliersPage).toContain('title="Adicionar as fontes internacionais recomendadas ao Radar?"')
  })

  it('tem Cancelar e Adicionar fontes, e só chama o seed no clique de confirmação', () => {
    expect(suppliersPage).toContain('<SecondaryButton onClick={() => setShowSeedConfirm(false)}>Cancelar</SecondaryButton>')
    expect(suppliersPage).toContain('<PrimaryButton loading={seeding} onClick={handleSeed}>Adicionar fontes</PrimaryButton>')
  })
})

describe('RadarSuppliersPage: mensagem de resultado usa formatSeedResult (determinística)', () => {
  it('não monta a mensagem manualmente na página — delega à função pura testada', () => {
    expect(suppliersPage).toContain('setSeedMessage(formatSeedResult(result))')
  })
})
