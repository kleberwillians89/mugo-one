import {describe,expect,it} from 'vitest'
import {missingShippingClientFields} from './client-completeness'

describe('cliente criado só com nome (importação IA)',()=>{
  it('todos os campos de envio aparecem como faltantes',()=>{
    expect(missingShippingClientFields({})).toEqual(['Telefone','CPF','CEP','Endereço','Número','Bairro','Cidade','Estado'])
  })
})

describe('cliente com telefone mas sem CPF/endereço',()=>{
  it('lista somente os campos realmente ausentes, telefone não aparece',()=>{
    const missing=missingShippingClientFields({phone:'11999999999'})
    expect(missing).not.toContain('Telefone')
    expect(missing).toEqual(['CPF','CEP','Endereço','Número','Bairro','Cidade','Estado'])
  })
  it('whatsapp_phone também conta como telefone presente',()=>{
    expect(missingShippingClientFields({whatsapp_phone:'11999999999'})).not.toContain('Telefone')
  })
  it('cnpj também conta como documento presente',()=>{
    expect(missingShippingClientFields({cnpj:'12345678000199'})).not.toContain('CPF')
  })
})

describe('cliente completo',()=>{
  it('nenhum alerta: lista vazia',()=>{
    expect(missingShippingClientFields({
      phone:'11999999999',cpf:'12345678900',postal_code:'01310100',
      address_line:'Av. Paulista',address_number:'1000',district:'Bela Vista',city:'São Paulo',state:'SP',
    })).toEqual([])
  })
})

describe('não inventa nenhum dado',()=>{
  it('não retorna nada além dos 8 campos definidos, mesmo com objeto extra',()=>{
    const missing=missingShippingClientFields({phone:null,cpf:null,cnpj:null,postal_code:null,address_line:null,address_number:null,district:null,city:null,state:null})
    expect(missing.every(field=>['Telefone','CPF','CEP','Endereço','Número','Bairro','Cidade','Estado'].includes(field))).toBe(true)
  })
})
