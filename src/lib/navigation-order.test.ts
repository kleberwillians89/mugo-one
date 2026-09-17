import{describe,expect,it}from'vitest'
import{navigation}from'../routing'

describe('ordem operacional do menu',()=>{
  it('prioriza o fluxo diário pedido pelo time',()=>{
    expect(navigation.slice(0,8).map(item=>item.label)).toEqual([
      'Visão Geral','Torre de Controle','Planilha','Vendas','Cobranças','Entregas','Estoque','Clientes',
    ])
  })
})
