import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const radarPage = readFileSync(new URL('./RadarPage.tsx', import.meta.url), 'utf8')

describe('RadarPage: uma ação humana = uma busca', () => {
  it('handleSearch ignora chamadas repetidas enquanto uma busca está em andamento', () => {
    const handleSearchBody = radarPage.slice(radarPage.indexOf('async function handleSearch'), radarPage.indexOf('async function handleWatch'))
    expect(handleSearchBody).toContain('if (searching) return')
  })

  it('o botão de busca fica desabilitado (loading) durante a requisição, bloqueando duplo clique', () => {
    expect(radarPage).toContain('loading={searching}')
  })

  it('não busca automaticamente enquanto o usuário digita (só Enter ou clique)', () => {
    expect(radarPage).not.toMatch(/onChange=\{[^}]*handleSearch/)
  })
})

describe('RadarPage: query enviada ao backend preserva o texto digitado', () => {
  it('envia query normalizada (sem reordenar) junto com brand/perfume_name', () => {
    expect(radarPage).toContain('const value = normalizeSearchQuery(raw ?? query)')
    expect(radarPage).toContain('searchRadar({ query: value,')
  })
})

describe('RadarPage: nenhum resultado de busca é salvo automaticamente', () => {
  it('renderiza os resultados apenas em memória (useState), sem chamar addManualOffer', () => {
    const resultsComponent = radarPage.slice(radarPage.indexOf('function RadarSearchResults'))
    expect(resultsComponent).not.toContain('addManualOffer')
  })
})
