import { describe, expect, it } from 'vitest'
import { isValidUsername, normalizeLoginIdentifier, usernameFromEmail } from './permissions'

describe('B — normaliza username corretamente', () => {
  it('minúsculas, com trim', () => {
    expect(normalizeLoginIdentifier('  Davi.Vendas  ')).toBe('davi.vendas@acesso.ruahparfums.com.br')
  })
  it('aceita a-z, números, ponto, underline, hífen', () => {
    expect(isValidUsername('davi.vendas')).toBe(true)
    expect(isValidUsername('julinha_entregas')).toBe(true)
    expect(isValidUsername('estoque-01')).toBe(true)
    expect(isValidUsername('ilde')).toBe(true)
  })
  it('rejeita espaços dentro do valor', () => {
    expect(isValidUsername('davi vendas')).toBe(false)
  })
  it('rejeita curto demais', () => {
    expect(isValidUsername('ab')).toBe(false)
  })
  it('é tolerante a maiúsculas — normaliza para minúsculo antes de validar, igual ao formulário faz ao digitar', () => {
    expect(isValidUsername('Davi.Vendas')).toBe(true)
  })
  it('rejeita caracteres fora do conjunto permitido mesmo após normalizar', () => {
    expect(isValidUsername('davi@vendas')).toBe(false)
  })
})

describe('C — e-mail antigo continua logando sem alteração', () => {
  it('um valor com "@" passa direto, nunca vira e-mail interno', () => {
    expect(normalizeLoginIdentifier('kleber@ruahparfums.com.br')).toBe('kleber@ruahparfums.com.br')
  })
  it('preserva e-mails de domínios externos quaisquer', () => {
    expect(normalizeLoginIdentifier('Alguem@Gmail.com')).toBe('alguem@gmail.com')
  })
})

describe('username transforma em e-mail interno de forma determinística (sem consulta ao banco)', () => {
  it('"davi.vendas" → davi.vendas@acesso.ruahparfums.com.br', () => {
    expect(normalizeLoginIdentifier('davi.vendas')).toBe('davi.vendas@acesso.ruahparfums.com.br')
  })
  it('nunca expõe o domínio interno de volta à UI — usernameFromEmail desfaz a transformação só para exibição', () => {
    expect(usernameFromEmail('davi.vendas@acesso.ruahparfums.com.br')).toBe('davi.vendas')
    expect(usernameFromEmail('kleber@ruahparfums.com.br')).toBe('kleber@ruahparfums.com.br')
  })
})
