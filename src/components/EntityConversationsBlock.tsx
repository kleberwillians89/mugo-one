import { useEffect, useState } from 'react'
import { Conversation, CONVERSATION_STATUS_LABEL, fetchConversationsForCustomer } from '../lib/communications'
import { SecondaryButton, StatusBadge } from './ui'
import './EntityTasksBlock.css'

/**
 * Bloco de Conversas na Customer 360 (briefing §33) — últimas
 * conversas, canal, status; sem renderizar a thread inteira aqui.
 */
export function EntityConversationsBlock({ customerId }: { customerId: string }) {
  const [conversations, setConversations] = useState<Conversation[] | null>(null)

  useEffect(() => {
    fetchConversationsForCustomer(customerId).then(setConversations).catch(() => setConversations([]))
  }, [customerId])

  if (conversations !== null && conversations.length === 0) return null

  return <section className="entity-tasks-block">
    <header><strong>Conversas</strong><SecondaryButton onClick={() => { history.pushState({}, '', '/conversas'); dispatchEvent(new PopStateEvent('popstate')) }}>Ver conversas</SecondaryButton></header>
    {conversations === null ? <p className="entity-tasks-empty">Carregando…</p> : (
      <div className="entity-tasks-list">
        {conversations.map((c) => (
          <div key={c.id} className="entity-task-row" style={{ cursor: 'default' }}>
            <span>{c.subject || c.channel}</span>
            <span className="entity-task-row-meta">
              <StatusBadge tone={c.status === 'open' ? 'success' : c.status === 'pending' ? 'warning' : 'neutral'}>{CONVERSATION_STATUS_LABEL[c.status]}</StatusBadge>
              <small>{c.channel}</small>
            </span>
          </div>
        ))}
      </div>
    )}
  </section>
}
