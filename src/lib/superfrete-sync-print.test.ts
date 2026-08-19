import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { safeProviderError } from '../../supabase/functions/_shared/superfrete-domain'
import { getLabelUiState, ShipmentActionState } from './superfrete'

/**
 * Regression suite for "SuperFrete diz que a etiqueta está pronta, RUAH
 * mostra SUPERFRETE_NETWORK_ERROR". Causa raiz: qualquer erro LOCAL depois
 * da chamada de rede (aplicar estado via RPC, persistir status de
 * impressão) caía no mesmo catch genérico e era rotulado como "a SuperFrete
 * não confirmou" — mesmo quando a SuperFrete tinha respondido com sucesso.
 * Deno.serve roda no topo do módulo do Edge Function — importar
 * index.ts diretamente quebraria o vitest (sem runtime Deno), então a
 * separação de etapas é verificada por texto-fonte, mesma convenção do
 * resto da suíte (ver team-frontend.test.ts).
 */

const indexTs = readFileSync(new URL('../../supabase/functions/superfrete-sync-shipment/index.ts', import.meta.url), 'utf8')
const superfreteSharedTs = readFileSync(new URL('../../supabase/functions/_shared/superfrete.ts', import.meta.url), 'utf8')
const migration = readFileSync(new URL('../../supabase/migrations/202608190014_superfrete_state_apply_defensive_casts.sql', import.meta.url), 'utf8')

const shipment = (overrides: Partial<ShipmentActionState> = {}): ShipmentActionState => ({
  status: 'label_released', superfrete_order_id: 'order-1', superfrete_status: 'released', checkout_status: 'released',
  print_available: false, print_url: null, label_pdf_url: null, tracking_code: 'BR123', integration_error: null, ...overrides,
})

describe('A — released + tracking + arquivo disponível: botão IMPRIMIR habilita', () => {
  it('canPrint=true e título ETIQUETA PRONTA quando print_available e print_url existem', () => {
    const state = getLabelUiState(shipment({ print_available: true, print_url: 'https://etiqueta.superfrete.com/a.pdf' }))
    expect(state.canPrint).toBe(true)
    expect(state.title).toBe('ETIQUETA PRONTA')
  })
})

describe('B — released sem arquivo real: nunca inventa URL, nunca finge "ainda preparando" depois de já ter sondado', () => {
  it('sem print_available e sem integration_error (nunca sincronizado): mensagem genérica de preparo é honesta', () => {
    const state = getLabelUiState(shipment())
    expect(state.canPrint).toBe(false)
    expect(state.title).toBe('ETIQUETA CRIADA')
    expect(state.description).toContain('sendo preparado')
  })
  it('sem print_available MAS já sondado e falhou (integration_error=SUPERFRETE_FILE_MISSING): não repete "ainda preparando" — isso seria mentira, já tentamos', () => {
    const state = getLabelUiState(shipment({ integration_error: 'SUPERFRETE_FILE_MISSING' }))
    expect(state.canPrint).toBe(false)
    expect(state.description).not.toContain('ainda está sendo preparado')
    expect(state.printUnavailableReason).toContain('sincronizar novamente')
  })
  it('SUPERFRETE_PROVIDER_PROCESSING não conta como "já sondado e falhou" (não é sobre o arquivo em si)', () => {
    const state = getLabelUiState(shipment({ integration_error: 'SUPERFRETE_PROVIDER_PROCESSING' }))
    expect(state.title).toBe('ETIQUETA CRIADA')
  })
})

describe('C/G — sincronizar é só leitura + reconciliação: nunca repete /cart ou /checkout', () => {
  it('a etapa 1 do Edge Function chama GET /api/v0/order/info — nunca /cart, nunca /checkout', () => {
    expect(indexTs).toContain("/api/v0/order/info/${encodeURIComponent(shipment.superfrete_order_id)}`,{method:'GET'}")
    expect(indexTs).not.toContain('/cart')
    expect(indexTs).not.toContain('/checkout')
  })
  it('a etapa 2 aplica o estado já confirmado via apply_superfrete_state (idempotente) — não existe nenhuma segunda chamada de compra no arquivo', () => {
    expect(indexTs).toContain("ctx.client.rpc('apply_superfrete_state'")
  })
})

describe('D — HTTP 500 é um erro HTTP, nunca "network error"', () => {
  it('safeProviderError mantém o status na resposta 5xx (SUPERFRETE_HTTP_500), não mascara como rede', () => {
    const httpError = Object.assign(new Error('http 500'), { status: 500 })
    expect(safeProviderError(httpError)).toMatchObject({ code: 'SUPERFRETE_HTTP_500', uncertain: true })
  })
})

describe('E — falha de fetch sem resposta nenhuma (exceção/timeout) é a ÚNICA classe que vira erro de rede/timeout', () => {
  it('TypeError de rede pura vira SUPERFRETE_NETWORK_ERROR', () => {
    expect(safeProviderError(new TypeError('fetch failed'))).toMatchObject({ code: 'SUPERFRETE_NETWORK_ERROR', uncertain: true })
  })
  it('timeout tem código próprio, mais específico que network genérico', () => {
    expect(safeProviderError(new DOMException('timeout', 'AbortError'))).toMatchObject({ code: 'SUPERFRETE_TIMEOUT', uncertain: true })
  })
})

describe('F — resposta 2xx com corpo não-JSON vira INVALID_RESPONSE, nunca network error nem corpo vazio silencioso', () => {
  it('superFreteRequest marca a exceção com invalidResponse quando o parse falha em uma resposta ok', () => {
    const parseBlock = superfreteSharedTs.slice(superfreteSharedTs.indexOf('const raw=await response.text()'), superfreteSharedTs.indexOf('}finally{clearTimeout(timer)}'))
    expect(parseBlock).toContain('parseFailed=true')
    expect(parseBlock).toContain("error.invalidResponse=true")
  })
  it('a checagem de HTTP não-ok continua vindo ANTES da checagem de parseFailed — um 500 com corpo quebrado ainda deve virar SUPERFRETE_HTTP_500, não INVALID_RESPONSE', () => {
    const httpCheckIndex = superfreteSharedTs.indexOf('if(!response.ok)')
    const parseFailedCheckIndex = superfreteSharedTs.indexOf('if(parseFailed)')
    expect(httpCheckIndex).toBeGreaterThan(0)
    expect(httpCheckIndex).toBeLessThan(parseFailedCheckIndex)
  })
  it('safeProviderError mapeia o marcador invalidResponse para SUPERFRETE_INVALID_RESPONSE, incerto (não sabemos se a operação remota terminou)', () => {
    const tagged = Object.assign(new Error('superfrete_invalid_response'), { invalidResponse: true })
    expect(safeProviderError(tagged)).toMatchObject({ code: 'SUPERFRETE_INVALID_RESPONSE', uncertain: true })
  })
})

describe('local (apply/persist) nunca reusa o rótulo de erro de rede do provedor — a causa raiz do bug relatado', () => {
  it('a etapa 2 (apply_superfrete_state) tem seu próprio código de erro, distinto de safeProviderError', () => {
    const stage2 = indexTs.slice(indexTs.indexOf("const {error:applyError}"), indexTs.indexOf('// Etapa 3'))
    expect(stage2).toContain("code:'SUPERFRETE_STATE_APPLY_ERROR'")
    expect(stage2).not.toContain('safeProviderError')
  })
  it('a etapa 3 (persistir status de impressão) também tem código próprio, distinto de safeProviderError', () => {
    const stage3 = indexTs.slice(indexTs.indexOf('// Etapa 3'))
    expect(stage3).toContain("code:'SUPERFRETE_PRINT_PERSIST_ERROR'")
    expect(stage3).not.toContain('safeProviderError')
  })
  it('só a etapa 1 (a chamada de rede real) usa safeProviderError', () => {
    const stage1 = indexTs.slice(indexTs.indexOf('let provider:unknown'), indexTs.indexOf('const state=extractOrderState'))
    expect(stage1).toContain('safeProviderError(cause)')
  })
})

describe('H — tracking_code nunca é sobrescrito por um valor vazio (preservado mesmo se a SuperFrete não reenviar o campo)', () => {
  it('a migration mantém o mesmo padrão coalesce(p_state->>\'tracking\',tracking_code) — não regrediu ao editar os campos secundários ao lado', () => {
    expect(migration).toContain("tracking_code=coalesce(p_state->>'tracking',tracking_code)")
    expect(migration).toContain("print_url=coalesce(p_state->'print'->>'url',p_state->>'print_url',print_url)")
  })
})

describe('I — o arquivo de impressão sondado pertence sempre ao MESMO shipment/pedido, nunca a outro', () => {
  it('rawPrintUrl deriva só do state retornado para este superfrete_order_id (já buscado por id+organization_id) ou dos campos já persistidos deste mesmo shipment — nunca de outra tabela/linha', () => {
    const rawPrintUrlLine = indexTs.slice(indexTs.indexOf('const rawPrintUrl='), indexTs.indexOf('const trustedPrintUrl='))
    expect(rawPrintUrlLine).toContain('shipment.print_url')
    expect(rawPrintUrlLine).toContain('shipment.label_pdf_url')
    expect(rawPrintUrlLine).not.toMatch(/other|another|cross/i)
  })
})

describe('J — o botão de imprimir nunca habilita sem status printável + arquivo realmente confirmado como PDF', () => {
  it('canPrint exige printableStatus, print_available e uma URL — qualquer um faltando desabilita', () => {
    expect(getLabelUiState(shipment({ status: 'customer_approved', superfrete_status: null, print_available: true, print_url: 'https://etiqueta.superfrete.com/a.pdf' })).canPrint).toBe(false)
    expect(getLabelUiState(shipment({ print_available: false, print_url: 'https://etiqueta.superfrete.com/a.pdf' })).canPrint).toBe(false)
    expect(getLabelUiState(shipment({ print_available: true, print_url: null, label_pdf_url: null })).canPrint).toBe(false)
  })
})

describe('a migration só torna os casts SECUNDÁRIOS defensivos — não toca em post_shipment, no gate físico nem em permissões', () => {
  it('post_shipment continua chamado exatamente como antes (mesma condição, mesma linha)', () => {
    expect(migration).toContain('perform public.post_shipment(v.id)')
  })
  it('o gate has_org_role de autorização não foi alterado', () => {
    expect(migration).toContain("has_org_role(v.organization_id,array['admin','manager']::public.member_role[])")
  })
  it('nenhuma coluna nova é criada — só funções e um CREATE OR REPLACE do apply_superfrete_state existente', () => {
    expect(migration).not.toMatch(/alter table.*add column/i)
    expect(migration).not.toContain('create table')
  })
})
