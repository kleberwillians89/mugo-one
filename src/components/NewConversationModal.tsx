import { FormEvent, useCallback, useState } from 'react'
import { Send } from 'lucide-react'
import { TaskEntityType, searchRelatableEntities } from '../lib/tasks'
import { sendEmailMessage } from '../lib/communications'
import { Modal, EntityCombobox, EntityOption, FormField, PrimaryButton, SecondaryButton } from './ui'

const RECIPIENT_TYPES: { value: TaskEntityType; label: string }[] = [
  { value: 'customer', label: 'Cliente' }, { value: 'contact', label: 'Contato' }, { value: 'lead', label: 'Lead' },
]

/**
 * Nova Conversa (briefing §62) — primeira versão só de e-mail (único
 * canal com envio real nesta sprint). Permite selecionar um destinatário
 * já cadastrado OU informar um e-mail manual.
 */
export function NewConversationModal({ close, onCreated }: { close: () => void; onCreated?: (conversationId: string) => void }) {
  const [recipientType, setRecipientType] = useState<TaskEntityType>('customer')
  const [recipientOption, setRecipientOption] = useState<EntityOption | null>(null)
  const [manualEmail, setManualEmail] = useState('')
  const [subject, setSubject] = useState('')
  const [bodyText, setBodyText] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const search = useCallback(async (term: string) => {
    const rows = await searchRelatableEntities(recipientType, term)
    return rows.map((row) => ({ id: row.id, label: row.label }))
  }, [recipientType])

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    setError('')
    if (!recipientOption && !manualEmail.trim()) return setError('Selecione um destinatário ou informe um e-mail.')
    if (!subject.trim() || !bodyText.trim()) return setError('Assunto e mensagem são obrigatórios.')
    setSaving(true)
    try {
      const result = await sendEmailMessage({
        customerId: recipientType === 'customer' ? recipientOption?.id : null,
        contactId: recipientType === 'contact' ? recipientOption?.id : null,
        leadId: recipientType === 'lead' ? recipientOption?.id : null,
        recipientIdentity: manualEmail.trim() || null,
        subject: subject.trim(), bodyText: bodyText.trim(),
      })
      onCreated?.(result.conversationId)
      close()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Não foi possível enviar o e-mail.')
    } finally { setSaving(false) }
  }

  return <Modal open onClose={close} eyebrow="CONVERSAS" title="Nova conversa" footer={<>
    <SecondaryButton onClick={close}>Cancelar</SecondaryButton>
    <PrimaryButton loading={saving} onClick={submit}><Send size={15} />Enviar</PrimaryButton>
  </>}>
    <form className="record-form" onSubmit={submit}>
      <div className="form-grid">
        <FormField label="Destinatário" htmlFor="conversation-recipient-type">
          <select id="conversation-recipient-type" value={recipientType} onChange={(e) => { setRecipientType(e.target.value as TaskEntityType); setRecipientOption(null) }}>
            {RECIPIENT_TYPES.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
          </select>
        </FormField>
        <div className="field wide">
          <EntityCombobox label="Buscar cadastro…" placeholder="Buscar…" value={recipientOption} search={search} onChange={setRecipientOption} />
        </div>
        <div className="field wide">
          <FormField label="Ou informe um e-mail manual" htmlFor="conversation-manual-email">
            <input id="conversation-manual-email" type="email" value={manualEmail} onChange={(e) => setManualEmail(e.target.value)} placeholder="nome@exemplo.com" />
          </FormField>
        </div>
        <div className="field wide"><FormField label="Assunto" htmlFor="conversation-subject" required><input id="conversation-subject" value={subject} onChange={(e) => setSubject(e.target.value)} autoFocus /></FormField></div>
        <div className="field wide"><FormField label="Mensagem" htmlFor="conversation-body" required><textarea id="conversation-body" rows={6} value={bodyText} onChange={(e) => setBodyText(e.target.value)} /></FormField></div>
      </div>
      {error && <div className="form-error">{error}</div>}
    </form>
  </Modal>
}
