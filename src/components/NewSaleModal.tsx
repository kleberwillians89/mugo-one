import { FormEvent, useCallback, useEffect, useState } from 'react'
import { Check, Plus, Trash2 } from 'lucide-react'
import { DateField } from './DateField'
import { searchClients } from '../lib/records'
import { CatalogItem, UNIT_SUGGESTIONS, createCatalogItem, searchCatalogItems, unitLabel } from '../lib/catalog'
import { NewSaleItemInput, createSaleWithItems } from '../lib/sale-items'
import { fetchTeamMembers, TeamMember } from '../lib/team'
import { Modal, EntityCombobox, EntityOption, FormField, PrimaryButton, SecondaryButton } from './ui'
import './NewSaleModal.css'

type ClientOption = { id: string; name: string }

type ItemDraft = {
  key: string
  catalogItem: EntityOption | null
  description: string
  quantity: string
  unit: string
  unitPrice: string
  discountAmount: string
}

const money = (value: number) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(value)
const parseNumber = (value: string) => { const n = Number(value.replace(',', '.')); return Number.isFinite(n) ? n : null }
const newItemKey = () => Math.random().toString(36).slice(2)
const emptyItem = (): ItemDraft => ({ key: newItemKey(), catalogItem: null, description: '', quantity: '1', unit: 'un', unitPrice: '', discountAmount: '' })

function lineTotal(item: ItemDraft): number {
  const qty = parseNumber(item.quantity) ?? 0
  const price = parseNumber(item.unitPrice) ?? 0
  const discount = parseNumber(item.discountAmount) ?? 0
  return Math.max(0, qty * price - discount)
}

/** Cadastro rápido de item de catálogo direto da Nova Venda — mesmo padrão de "criar cliente inline" já usado no produto. */
function QuickCatalogItemModal({ initialName, close, onCreated }: { initialName: string; close: () => void; onCreated: (item: CatalogItem) => void }) {
  const [name, setName] = useState(initialName)
  const [type, setType] = useState<'product' | 'service'>('service')
  const [unit, setUnit] = useState('un')
  const [price, setPrice] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (!name.trim()) return setError('Informe o nome do item.')
    setSaving(true); setError('')
    try {
      const created = await createCatalogItem({ type, name, unit, price: parseNumber(price) ?? 0 })
      onCreated(created)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Não foi possível criar o item.')
    } finally { setSaving(false) }
  }
  return <Modal open onClose={close} eyebrow="NOVO ITEM" title="Cadastrar produto ou serviço" footer={<><SecondaryButton onClick={close}>Cancelar</SecondaryButton><PrimaryButton loading={saving} onClick={submit}><Check size={16} />Cadastrar</PrimaryButton></>}>
    <form className="record-form" onSubmit={submit}>
      <div className="form-grid">
        <FormField label="Nome" htmlFor="quick-item-name" required><input id="quick-item-name" value={name} onChange={(e) => setName(e.target.value)} autoFocus /></FormField>
        <FormField label="Tipo" htmlFor="quick-item-type" required>
          <select id="quick-item-type" value={type} onChange={(e) => setType(e.target.value as 'product' | 'service')}>
            <option value="service">Serviço</option>
            <option value="product">Produto</option>
          </select>
        </FormField>
        <FormField label="Unidade" htmlFor="quick-item-unit"><select id="quick-item-unit" value={unit} onChange={(e) => setUnit(e.target.value)}>{UNIT_SUGGESTIONS.map((u) => <option key={u} value={u}>{unitLabel(u)}</option>)}</select></FormField>
        <FormField label="Valor" htmlFor="quick-item-price"><input id="quick-item-price" inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value)} placeholder="0,00" /></FormField>
      </div>
      {error && <div className="form-error">{error}</div>}
    </form>
  </Modal>
}

export function NewSaleModal({ close, onCreated }: { close: () => void; onCreated?: (saleId: string) => void }) {
  const [client, setClient] = useState<ClientOption | null>(null)
  const [clientOption, setClientOption] = useState<EntityOption | null>(null)
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10))
  const [ownerUserId, setOwnerUserId] = useState('')
  const [members, setMembers] = useState<TeamMember[]>([])
  const [items, setItems] = useState<ItemDraft[]>([emptyItem()])
  const [quickCreateFor, setQuickCreateFor] = useState<string | null>(null)
  const [paymentStatus, setPaymentStatus] = useState('unknown')
  const [paymentMethod, setPaymentMethod] = useState('')
  const [paidAt, setPaidAt] = useState('')
  const [source, setSource] = useState('manual')
  const [notes, setNotes] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => { fetchTeamMembers().then(setMembers).catch(() => setMembers([])) }, [])

  const clientSearch = useCallback(async (term: string) => (await searchClients(term) as ClientOption[]).map((row) => ({ id: row.id, label: row.name })), [])

  const patchItem = (key: string, patch: Partial<ItemDraft>) => setItems((current) => current.map((item) => (item.key === key ? { ...item, ...patch } : item)))
  const addItem = () => setItems((current) => [...current, emptyItem()])
  const removeItem = (key: string) => setItems((current) => (current.length > 1 ? current.filter((item) => item.key !== key) : current))

  const selectCatalogItem = (key: string, option: EntityOption | null, catalogItems: Map<string, CatalogItem>) => {
    if (!option) return patchItem(key, { catalogItem: null })
    const found = catalogItems.get(option.id)
    patchItem(key, { catalogItem: option, description: found?.name ?? option.label, unit: found?.unit ?? 'un', unitPrice: found ? String(found.price) : '' })
  }
  const [catalogCache, setCatalogCache] = useState<Map<string, CatalogItem>>(new Map())
  const itemSearchCaching = useCallback(async (term: string) => {
    const rows = await searchCatalogItems(term)
    setCatalogCache((current) => { const next = new Map(current); for (const row of rows) next.set(row.id, row); return next })
    return rows.map((row) => ({ id: row.id, label: row.name, description: `${row.type === 'product' ? 'Produto' : 'Serviço'} · ${money(row.price)} / ${unitLabel(row.unit)}` }))
  }, [])

  const subtotal = items.reduce((sum, item) => sum + (parseNumber(item.quantity) ?? 0) * (parseNumber(item.unitPrice) ?? 0), 0)
  const discountTotal = items.reduce((sum, item) => sum + (parseNumber(item.discountAmount) ?? 0), 0)
  const total = items.reduce((sum, item) => sum + lineTotal(item), 0)

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    setError('')
    if (!client) return setError('Selecione um cliente ou empresa.')
    if (!date) return setError('Informe a data da venda.')
    const parsedItems: NewSaleItemInput[] = []
    for (const item of items) {
      if (!item.description.trim()) return setError('Todo item precisa de uma descrição.')
      const quantity = parseNumber(item.quantity)
      if (quantity === null || quantity <= 0) return setError(`Quantidade inválida em "${item.description}".`)
      const unitPrice = parseNumber(item.unitPrice)
      if (unitPrice === null || unitPrice < 0) return setError(`Valor unitário inválido em "${item.description}".`)
      const discountAmount = item.discountAmount ? parseNumber(item.discountAmount) : 0
      if (discountAmount === null || discountAmount < 0) return setError(`Desconto inválido em "${item.description}".`)
      parsedItems.push({ catalogItemId: item.catalogItem?.id ?? null, description: item.description.trim(), quantity, unit: item.unit || 'un', unitPrice, discountAmount })
    }
    setSaving(true)
    try {
      const result = await createSaleWithItems({
        clientId: client.id, saleDate: date, items: parsedItems, paymentStatus, paymentMethod: paymentMethod || null,
        paidAt: paidAt || null, ownerUserId: ownerUserId || null, source, notes: notes || null,
      })
      onCreated?.(result.saleId)
      close()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Não foi possível salvar a venda.')
    } finally { setSaving(false) }
  }

  return <>
    {quickCreateFor && <QuickCatalogItemModal initialName="" close={() => setQuickCreateFor(null)} onCreated={(created) => {
      setCatalogCache((current) => new Map(current).set(created.id, created))
      selectCatalogItem(quickCreateFor, { id: created.id, label: created.name }, new Map(catalogCache).set(created.id, created))
      setQuickCreateFor(null)
    }} />}
    <Modal open onClose={close} size="lg" eyebrow="NOVA VENDA" title="Adicionar venda" footer={<>
      <SecondaryButton onClick={close}>Cancelar</SecondaryButton>
      <PrimaryButton loading={saving} onClick={submit}><Check size={16} />Salvar venda</PrimaryButton>
    </>}>
      <form className="record-form new-sale-form" onSubmit={submit}>
        <div className="form-grid">
          <div className="field wide"><EntityCombobox label="Cliente / Empresa *" placeholder="Buscar cliente…" value={clientOption} search={clientSearch} onChange={(option) => { setClientOption(option); setClient(option ? { id: option.id, name: option.label } : null) }} /></div>
          <DateField id="new-sale-date" label="Data" value={date} onChange={setDate} required />
          <FormField label="Responsável" htmlFor="new-sale-owner"><select id="new-sale-owner" value={ownerUserId} onChange={(e) => setOwnerUserId(e.target.value)}><option value="">—</option>{members.map((member) => <option key={member.user_id} value={member.user_id}>{member.full_name || member.email}</option>)}</select></FormField>
        </div>

        <div className="new-sale-items">
          <h3>Itens</h3>
          {items.map((item) => <div className="new-sale-item-row" key={item.key}>
            <div className="field wide"><EntityCombobox label="Produto ou serviço" placeholder="Buscar item do catálogo…" value={item.catalogItem} search={itemSearchCaching} onChange={(option) => selectCatalogItem(item.key, option, catalogCache)} onCreate={(query) => { patchItem(item.key, { description: query }); setQuickCreateFor(item.key) }} createLabel={(query) => `CADASTRAR "${query}" NO CATÁLOGO`} /></div>
            <FormField label="Descrição" htmlFor={`item-desc-${item.key}`}><input id={`item-desc-${item.key}`} value={item.description} onChange={(e) => patchItem(item.key, { description: e.target.value })} placeholder="Descrição do item" /></FormField>
            <FormField label="Quantidade" htmlFor={`item-qty-${item.key}`}><input id={`item-qty-${item.key}`} inputMode="decimal" value={item.quantity} onChange={(e) => patchItem(item.key, { quantity: e.target.value })} /></FormField>
            <FormField label="Unidade" htmlFor={`item-unit-${item.key}`}><select id={`item-unit-${item.key}`} value={item.unit} onChange={(e) => patchItem(item.key, { unit: e.target.value })}>{UNIT_SUGGESTIONS.map((u) => <option key={u} value={u}>{unitLabel(u)}</option>)}</select></FormField>
            <FormField label="Valor unitário" htmlFor={`item-price-${item.key}`}><input id={`item-price-${item.key}`} inputMode="decimal" value={item.unitPrice} onChange={(e) => patchItem(item.key, { unitPrice: e.target.value })} placeholder="0,00" /></FormField>
            <FormField label="Desconto" htmlFor={`item-discount-${item.key}`}><input id={`item-discount-${item.key}`} inputMode="decimal" value={item.discountAmount} onChange={(e) => patchItem(item.key, { discountAmount: e.target.value })} placeholder="0,00" /></FormField>
            <div className="new-sale-item-total"><span>Total</span><strong>{money(lineTotal(item))}</strong></div>
            <button type="button" className="new-sale-item-remove" disabled={items.length === 1} onClick={() => removeItem(item.key)} aria-label="Remover item"><Trash2 size={15} /></button>
          </div>)}
          <SecondaryButton icon={<Plus size={15} />} onClick={addItem}>Adicionar item</SecondaryButton>
        </div>

        <div className="new-sale-summary">
          <div><span>Subtotal</span><strong>{money(subtotal)}</strong></div>
          <div><span>Desconto</span><strong>{money(discountTotal)}</strong></div>
          <div className="new-sale-summary-total"><span>Total</span><strong>{money(total)}</strong></div>
        </div>

        <div className="form-grid">
          <FormField label="Status do pagamento" htmlFor="new-sale-status"><select id="new-sale-status" value={paymentStatus} onChange={(e) => setPaymentStatus(e.target.value)}><option value="paid">Pago</option><option value="pending">Aguardando</option><option value="cancelled">Cancelado</option><option value="unknown">Em revisão</option></select></FormField>
          <FormField label="Forma de pagamento" htmlFor="new-sale-method"><input id="new-sale-method" value={paymentMethod} onChange={(e) => setPaymentMethod(e.target.value)} placeholder="Ex.: PIX" /></FormField>
          <DateField id="new-sale-paid-at" label="Data do pagamento" value={paidAt} onChange={setPaidAt} />
          <FormField label="Origem" htmlFor="new-sale-source"><select id="new-sale-source" value={source} onChange={(e) => setSource(e.target.value)}><option value="manual">Manual</option><option value="import">Importação</option></select></FormField>
          <div className="field wide"><FormField label="Observações" htmlFor="new-sale-notes"><textarea id="new-sale-notes" value={notes} onChange={(e) => setNotes(e.target.value)} /></FormField></div>
        </div>

        {error && <div className="form-error">{error}</div>}
      </form>
    </Modal>
  </>
}
