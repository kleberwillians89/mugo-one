import { useEffect, useState } from 'react'
import { Touchpoint, fetchTouchpointsForEntity } from '../lib/lead-intake'
import './EntityTasksBlock.css'

/**
 * Bloco somente-leitura de Origem/Touchpoints — briefing §63: histórico
 * de canal, não um dashboard de atribuição completo (isso é trabalho
 * futuro do Mugô Dados). touchpoints é fonte de verdade; nenhum campo
 * aqui é derivado/calculado.
 */
export function EntityTouchpointsBlock({ entityType, entityId }: { entityType: 'customer' | 'lead'; entityId: string }) {
  const [touchpoints, setTouchpoints] = useState<Touchpoint[] | null>(null)

  useEffect(() => {
    fetchTouchpointsForEntity(entityType, entityId).then(setTouchpoints).catch(() => setTouchpoints([]))
  }, [entityType, entityId])

  if (touchpoints !== null && touchpoints.length === 0) return null

  return <section className="entity-tasks-block">
    <header><strong>Origem e contatos</strong></header>
    {touchpoints === null ? <p className="entity-tasks-empty">Carregando…</p> : (
      <div className="entity-tasks-list">
        {touchpoints.map((touchpoint) => (
          <div key={touchpoint.id} className="entity-task-row" style={{ cursor: 'default' }}>
            <span>{touchpoint.channel}{touchpoint.campaign ? ` — ${touchpoint.campaign}` : ''}</span>
            <span className="entity-task-row-meta">
              <small>{touchpoint.provider}</small>
              <em>{new Date(touchpoint.occurredAt).toLocaleDateString('pt-BR')}</em>
            </span>
          </div>
        ))}
      </div>
    )}
  </section>
}
