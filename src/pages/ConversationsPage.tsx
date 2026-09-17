import { useCallback, useEffect, useMemo, useState } from 'react'
import { Plus, Send } from 'lucide-react'
import {
  Conversation, ConversationFilters, ConversationStatus, Message, CONVERSATION_STATUS_LABEL, MESSAGE_STATUS_LABEL,
  assignConversation, fetchConversation, fetchConversations, fetchMessages, markConversationRead, sendEmailMessage, setConversationStatus,
} from '../lib/communications'
import { NewConversationModal } from '../components/NewConversationModal'
import { EntityTasksBlock } from '../components/EntityTasksBlock'
import { PrimaryButton, SecondaryButton, StatusBadge, SearchInput } from '../components/ui'
import { useHasPermission } from '../lib/PermissionsContext'
import { authenticatedOrganization } from '../lib/records'
import './ConversationsPage.css'

const FILTER_TABS: { key: 'all' | 'mine' | 'unread' | ConversationStatus; label: string }[] = [
  { key: 'all', label: 'Todas' }, { key: 'mine', label: 'Minhas' }, { key: 'unread', label: 'Não lidas' },
  { key: 'open', label: 'Abertas' }, { key: 'closed', label: 'Fechadas' },
]

function conversationTitle(c: Conversation): string {
  return c.customerName || c.leadName || c.contactName || c.companyName || c.subject || 'Sem identificação'
}

function relativeTime(iso: string | null): string {
  if (!iso) return ''
  const diffMs = Date.now() - new Date(iso).getTime()
  const minutes = Math.round(diffMs / 60000)
  if (minutes < 1) return 'agora'
  if (minutes < 60) return `${minutes}min`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${hours}h`
  return `${Math.round(hours / 24)}d`
}

/**
 * Inbox universal (briefing §23-26). 3 colunas: lista de conversas |
 * thread | contexto do cliente. Nome "Conversas", nunca "WhatsApp
 * Inbox" — o primeiro provider funcional é e-mail, mas a UI é
 * provider-agnostic desde o início (briefing §63).
 */
export function ConversationsPage() {
  const [tab, setTab] = useState<typeof FILTER_TABS[number]['key']>('all')
  const [search, setSearch] = useState('')
  const [conversations, setConversations] = useState<Conversation[] | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [selected, setSelected] = useState<Conversation | null>(null)
  const [messages, setMessages] = useState<Message[] | null>(null)
  const [composerText, setComposerText] = useState('')
  const [sending, setSending] = useState(false)
  const [error, setError] = useState('')
  const [newConversationOpen, setNewConversationOpen] = useState(false)
  const canAssign = useHasPermission('communications.assign')
  const canSend = useHasPermission('communications.send')

  const filters = useMemo<ConversationFilters>(() => ({
    status: tab === 'open' ? ['open', 'pending'] : tab === 'closed' ? ['closed'] : undefined,
    assignedToMe: tab === 'mine', unreadOnly: tab === 'unread', search: search || undefined,
  }), [tab, search])

  const loadList = useCallback(() => {
    fetchConversations(filters).then(setConversations).catch(() => setConversations([]))
  }, [filters])
  useEffect(() => { loadList() }, [loadList])

  const loadThread = useCallback((id: string) => {
    fetchConversation(id).then(setSelected).catch(() => setSelected(null))
    fetchMessages(id).then(setMessages).catch(() => setMessages([]))
  }, [])
  useEffect(() => { if (selectedId) loadThread(selectedId) }, [selectedId, loadThread])

  const openConversation = async (conversation: Conversation) => {
    setSelectedId(conversation.id)
    if (conversation.unreadCount > 0) {
      try { await markConversationRead(conversation.id); loadList() } catch { /* marcação de lida é best-effort */ }
    }
  }

  const sendReply = async () => {
    if (!selected || !composerText.trim()) return
    setSending(true)
    setError('')
    try {
      await sendEmailMessage({
        conversationId: selected.id, customerId: selected.customerId, companyId: selected.companyId,
        contactId: selected.contactId, leadId: selected.leadId, subject: selected.subject ?? '(sem assunto)', bodyText: composerText.trim(),
      })
      setComposerText('')
      loadThread(selected.id)
      loadList()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Não foi possível enviar a mensagem.')
    } finally { setSending(false) }
  }

  const toggleStatus = async () => {
    if (!selected) return
    try {
      await setConversationStatus(selected.id, selected.updatedAt, selected.status === 'closed' ? 'open' : 'closed')
      loadThread(selected.id); loadList()
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Não foi possível atualizar a conversa.') }
  }

  const assignToMe = async () => {
    if (!selected) return
    try {
      const { user } = await authenticatedOrganization()
      await assignConversation(selected.id, selected.updatedAt, user.id)
      loadThread(selected.id); loadList()
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Não foi possível atribuir a conversa.') }
  }

  const entityType = selected?.customerId ? 'customer' : selected?.leadId ? 'lead' : selected?.contactId ? 'contact' : selected?.companyId ? 'company' : null
  const entityId = selected?.customerId ?? selected?.leadId ?? selected?.contactId ?? selected?.companyId ?? null

  return <div className="page conversations-page">
    {newConversationOpen && <NewConversationModal close={() => setNewConversationOpen(false)} onCreated={(id) => { loadList(); setSelectedId(id) }} />}
    <div className="conversations-header">
      <h2>Conversas</h2>
      {canSend && <PrimaryButton icon={<Plus size={16} />} onClick={() => setNewConversationOpen(true)}>Nova conversa</PrimaryButton>}
    </div>

    <div className="conversations-layout">
      <section className="conversations-list-pane">
        <div className="conversations-tabs">
          {FILTER_TABS.map((t) => <button key={t.key} className={tab === t.key ? 'active' : ''} onClick={() => setTab(t.key)}>{t.label}</button>)}
        </div>
        <SearchInput value={search} onChange={setSearch} placeholder="Buscar por nome…" onClear={() => setSearch('')} />
        {conversations === null ? <p className="inline-empty">Carregando…</p> : conversations.length === 0 ? (
          <div className="empty card"><h3>Suas conversas aparecerão aqui.</h3>{canSend && <PrimaryButton icon={<Plus size={15} />} onClick={() => setNewConversationOpen(true)}>Nova conversa</PrimaryButton>}</div>
        ) : (
          <ul className="conversations-list">
            {conversations.map((c) => (
              <li key={c.id}>
                <button className={selectedId === c.id ? 'active' : ''} onClick={() => openConversation(c)}>
                  <span className="conversation-row-top">
                    <strong>{conversationTitle(c)}</strong>
                    <em>{relativeTime(c.lastMessageAt)}</em>
                  </span>
                  <span className="conversation-row-bottom">
                    <small>{c.channel}</small>
                    {c.unreadCount > 0 && <span className="conversation-unread-dot">{c.unreadCount}</span>}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="conversations-thread-pane">
        {!selected ? <div className="empty card"><h3>Selecione uma conversa</h3></div> : (
          <>
            <div className="conversations-thread-header">
              <div>
                <strong>{conversationTitle(selected)}</strong>
                <StatusBadge tone={selected.status === 'open' ? 'success' : selected.status === 'pending' ? 'warning' : 'neutral'}>{CONVERSATION_STATUS_LABEL[selected.status].toUpperCase()}</StatusBadge>
              </div>
              <div className="conversations-thread-actions">
                {canAssign && !selected.assignedUserId && <SecondaryButton onClick={assignToMe}>Atribuir a mim</SecondaryButton>}
                <SecondaryButton onClick={toggleStatus}>{selected.status === 'closed' ? 'Reabrir' : 'Fechar conversa'}</SecondaryButton>
              </div>
            </div>
            <div className="conversations-thread-messages">
              {messages === null ? <p className="inline-empty">Carregando…</p> : messages.length === 0 ? <p className="inline-empty">Nenhuma mensagem ainda.</p> : messages.map((m) => (
                <div key={m.id} className={`message-bubble ${m.direction}`}>
                  {m.messageType !== 'text' ? <em>Mídia ainda não suportada nesta versão.</em> : <p>{m.bodyText}</p>}
                  <span className="message-meta">{MESSAGE_STATUS_LABEL[m.status]}{m.errorMessage ? ` — ${m.errorMessage}` : ''}</span>
                </div>
              ))}
            </div>
            <div className="conversations-composer">
              {!canSend ? <p className="inline-empty">Sem permissão para enviar mensagens.</p> : selected.channel !== 'email' ? (
                <p className="inline-empty">Envio automático para este canal ainda não está disponível — em breve.</p>
              ) : (
                <>
                  <textarea value={composerText} onChange={(e) => setComposerText(e.target.value)} placeholder="Escreva uma mensagem…" rows={2} />
                  <PrimaryButton icon={<Send size={15} />} loading={sending} disabled={!composerText.trim()} onClick={sendReply}>Enviar</PrimaryButton>
                </>
              )}
              {error && <div className="form-error">{error}</div>}
            </div>
          </>
        )}
      </section>

      {selected && entityType && entityId && (
        <section className="conversations-context-pane">
          <EntityTasksBlock entityType={entityType} entityId={entityId} entityLabel={conversationTitle(selected)} defaultMetadata={{ conversation_id: selected.id }} />
        </section>
      )}
    </div>
  </div>
}
