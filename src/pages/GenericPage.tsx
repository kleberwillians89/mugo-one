import { useState } from 'react'
import { CalendarDays, ChevronDown, Home, Plus, Search, Settings, ShoppingBag, UserRound } from 'lucide-react'
import { ClientModal, SaleModal } from '../components/RecordModals'
import { Page } from '../routing'
import { PageHeader, PrimaryButton } from '../components/ui'

export function GenericPage({ page }: { page: Page }) {
  const [modal,setModal]=useState(false)
  const config = {
    Clientes: ['Clientes','Relacionamento, recorrência e histórico em um só lugar.',UserRound],
    Vendas: ['Vendas','Acompanhe cada venda, pagamento e alteração com segurança.',ShoppingBag],
    Configurações: ['Configurações','Organização, membros, integrações e preferências.',Settings],
  }[page as 'Clientes'] as [string,string,typeof Home]
  const Icon = config[2]
  return <div className="page">{modal&&page==='Clientes'&&<ClientModal close={()=>setModal(false)}/>}
    {modal&&page==='Vendas'&&<SaleModal close={()=>setModal(false)}/>}
    <PageHeader title={config[0]} description={config[1]} actions={page!=='Configurações'?<PrimaryButton icon={<Plus size={17}/>} onClick={()=>setModal(true)}>{page==='Clientes'?'Adicionar cliente':'Adicionar venda'}</PrimaryButton>:undefined}/>
    <div className="toolbar card"><div className="search"><Search size={18}/><input placeholder={`Buscar em ${page.toLowerCase()}…`}/></div><button><CalendarDays size={17}/> Período</button><button><ChevronDown size={16}/> Filtros</button></div>
    <div className="empty card"><div className="empty-icon"><Icon/></div><h3>Nenhum dado sincronizado</h3><p>Conecte o projeto Supabase da RUAH e faça a primeira importação segura.</p><button className="primary" onClick={()=>setModal(true)}><Plus size={17}/> {page==='Clientes'?'Adicionar cliente':page==='Vendas'?'Adicionar venda':'Configurar'}</button></div>
  </div>
}
