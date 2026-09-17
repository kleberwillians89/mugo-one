import{describe,expect,it}from'vitest'
import{navigation}from'../routing'

describe('ordem operacional do menu',()=>{
  it('prioriza o fluxo diário pedido pelo time (Planilha → Produtos → Vendas, ver Fase F da generalização)',()=>{
    expect(navigation.slice(0,9).map(item=>item.label)).toEqual([
      'Visão Geral','Torre de Controle','Planilha','Produtos','Vendas','Cobranças','Entregas','Estoque','Clientes',
    ])
  })
})
