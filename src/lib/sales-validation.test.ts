import { describe, expect, it } from 'vitest'
import { blockingReasonLabel, blockingReasonLabels } from './sales-validation'

describe('blockingReasonLabel', () => {
  it('traduz cada código para um rótulo humano', () => {
    expect(blockingReasonLabel('perfume_nao_identificado')).toBe('Perfume não identificado')
    expect(blockingReasonLabel('volume_nao_informado')).toBe('Volume não informado')
    expect(blockingReasonLabel('pagamento_nao_identificado')).toBe('Pagamento não identificado')
    expect(blockingReasonLabel('cadastro_cliente_incompleto')).toBe('Cadastro do cliente incompleto')
  })
})

describe('blockingReasonLabels', () => {
  it('traduz uma lista inteira, preservando a ordem', () => {
    expect(blockingReasonLabels(['volume_nao_informado', 'perfume_nao_identificado']))
      .toEqual(['Volume não informado', 'Perfume não identificado'])
  })
  it('lista vazia retorna lista vazia', () => {
    expect(blockingReasonLabels([])).toEqual([])
  })
})
