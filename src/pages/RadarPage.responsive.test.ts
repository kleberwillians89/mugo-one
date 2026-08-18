import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const radarCss = readFileSync(new URL('./RadarPage.css', import.meta.url), 'utf8')

describe('RadarPage segue o container real da página (não vw/viewport)', () => {
  it('usa @container page para adaptar o layout, não apenas @media', () => {
    expect(radarCss).toMatch(/@container page \(max-width:\d+px\)/)
  })

  it('não define seu próprio container-type (herda de .page global)', () => {
    expect(radarCss).not.toContain('container-type')
  })
})
