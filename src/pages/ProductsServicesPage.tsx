import { useCallback, useEffect, useState } from 'react'
import { AlertTriangle, Plus } from 'lucide-react'
import { CatalogItem, CatalogItemInput, UNIT_SUGGESTIONS, createCatalogItem, fetchCatalogItems, unitLabel, updateCatalogItem } from '../lib/catalog'
import { useHasPermission } from '../lib/PermissionsContext'
import { Modal, PageHeader, PrimaryButton, SearchInput, SecondaryButton, StatusBadge, Table } from '../components/ui'
import { FormField } from '../components/ui/FormField'
import './ProductsServicesPage.css'

const money = (value: number) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(value)

function CatalogItemModal({ item, close, onSaved }: { item?: CatalogItem; close: () => void; onSaved: () => void }) {
  const [form, setForm] = useState<CatalogItemInput>({ type: item?.type ?? 'service', name: item?.name ?? '', sku: item?.sku ?? '', description: item?.description ?? '', category: item?.category ?? '', unit: item?.unit ?? 'un', price: item?.price ?? 0, cost: item?.cost ?? undefined })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const set = <K extends keyof CatalogItemInput>(key: K, value: CatalogItemInput[K]) => setForm((current) => ({ ...current, [key]: value }))
  const submit = async () => {
    if (!form.name.trim()) return setError('Informe o nome do item.')
    setSaving(true); setError('')
    try {
      if (item) await updateCatalogItem(item.id, form)
      else await createCatalogItem(form)
      onSaved()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Não foi possível salvar.')
    } finally { setSaving(false) }
  }
  return <Modal open onClose={close} eyebrow="PRODUTOS & SERVIÇOS" title={item ? 'Editar item' : 'Novo item'} footer={<><SecondaryButton onClick={close}>Cancelar</SecondaryButton><PrimaryButton loading={saving} onClick={submit}>Salvar</PrimaryButton></>}>
    <div className="form-grid">
      <FormField label="Nome" htmlFor="ci-name" required><input id="ci-name" value={form.name} onChange={(e) => set('name', e.target.value)} autoFocus /></FormField>
      <FormField label="Tipo" htmlFor="ci-type" required>
        <select id="ci-type" value={form.type} onChange={(e) => set('type', e.target.value as 'product' | 'service')}>
          <option value="service">Serviço</option>
          <option value="product">Produto</option>
        </select>
      </FormField>
      <FormField label="Categoria" htmlFor="ci-category"><input id="ci-category" value={form.category ?? ''} onChange={(e) => set('category', e.target.value)} /></FormField>
      <FormField label="SKU" htmlFor="ci-sku"><input id="ci-sku" value={form.sku ?? ''} onChange={(e) => set('sku', e.target.value)} placeholder="Opcional" /></FormField>
      <FormField label="Unidade" htmlFor="ci-unit"><select id="ci-unit" value={form.unit} onChange={(e) => set('unit', e.target.value)}>{UNIT_SUGGESTIONS.map((u) => <option key={u} value={u}>{unitLabel(u)}</option>)}</select></FormField>
      <FormField label="Preço" htmlFor="ci-price"><input id="ci-price" inputMode="decimal" value={String(form.price)} onChange={(e) => set('price', Number(e.target.value.replace(',', '.')) || 0)} /></FormField>
      <FormField label="Custo (opcional)" htmlFor="ci-cost"><input id="ci-cost" inputMode="decimal" value={form.cost === undefined || form.cost === null ? '' : String(form.cost)} onChange={(e) => set('cost', e.target.value ? Number(e.target.value.replace(',', '.')) : null)} /></FormField>
      <div className="field wide"><FormField label="Descrição" htmlFor="ci-description"><textarea id="ci-description" value={form.description ?? ''} onChange={(e) => set('description', e.target.value)} /></FormField></div>
    </div>
    {error && <div className="form-error">{error}</div>}
  </Modal>
}

export function ProductsServicesPage() {
  const canManage = useHasPermission('catalog.manage')
  const [items, setItems] = useState<CatalogItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [search, setSearch] = useState('')
  const [typeFilter, setTypeFilter] = useState<'all' | 'product' | 'service'>('all')
  const [editing, setEditing] = useState<CatalogItem | 'new' | null>(null)

  const load = useCallback(() => fetchCatalogItems({ search: search || undefined, type: typeFilter === 'all' ? undefined : typeFilter })
    .then(setItems)
    .catch(() => setError('Não foi possível carregar o catálogo.'))
    .finally(() => setLoading(false)), [search, typeFilter])
  useEffect(() => { load() }, [load])

  const toggleActive = async (item: CatalogItem) => {
    try { await updateCatalogItem(item.id, { active: !item.active }); load() } catch { setError('Não foi possível atualizar o item.') }
  }

  return <div className="page products-services">
    {editing && <CatalogItemModal item={editing === 'new' ? undefined : editing} close={() => setEditing(null)} onSaved={() => { setEditing(null); load() }} />}
    <PageHeader title="Produtos & Serviços" description="Catálogo de itens vendáveis pela organização." actions={canManage ? <PrimaryButton icon={<Plus size={16} />} onClick={() => setEditing('new')}>Novo item</PrimaryButton> : undefined} />

    <div className="toolbar card">
      <SearchInput value={search} onChange={setSearch} placeholder="Buscar por nome…" />
      <select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value as 'all' | 'product' | 'service')}>
        <option value="all">Todos os tipos</option>
        <option value="product">Produtos</option>
        <option value="service">Serviços</option>
      </select>
    </div>

    {loading ? <div className="empty card"><h3>Carregando catálogo…</h3></div>
      : error ? <div className="notice"><AlertTriangle size={18} /><span>{error}</span></div>
      : items.length === 0 ? <div className="empty card"><h3>Nenhum item cadastrado</h3><p>Cadastre o primeiro produto ou serviço para começar a vender.</p></div>
      : <div className="card clients-table">
          <Table rowKey={(item) => item.id} rows={items} columns={[
            { key: 'name', label: 'Nome', render: (item) => <strong>{item.name}</strong> },
            { key: 'type', label: 'Tipo', render: (item) => item.type === 'product' ? 'Produto' : 'Serviço' },
            { key: 'category', label: 'Categoria', render: (item) => item.category ?? '—' },
            { key: 'sku', label: 'SKU', render: (item) => item.sku ?? '—' },
            { key: 'unit', label: 'Unidade', render: (item) => unitLabel(item.unit) },
            { key: 'price', label: 'Preço', render: (item) => money(item.price) },
            { key: 'active', label: 'Ativo', render: (item) => <StatusBadge tone={item.active ? 'success' : 'neutral'}>{item.active ? 'Ativo' : 'Inativo'}</StatusBadge> },
            { key: 'actions', label: 'Ações', render: (item) => canManage ? <div className="products-services-actions"><button onClick={(event) => { event.stopPropagation(); setEditing(item) }}>Editar</button><button onClick={(event) => { event.stopPropagation(); void toggleActive(item) }}>{item.active ? 'Desativar' : 'Ativar'}</button></div> : null },
          ]} />
        </div>}
  </div>
}
