import { useState } from 'react'
import { Check } from 'lucide-react'
import { Modal, PrimaryButton, SecondaryButton, Stepper, useToast } from './ui'
import {
  CollectionMessageTemplate, EMPTY_COLLECTION_SETTINGS, OrganizationCollectionSettings, PixKeyType,
  saveOrganizationCollectionSettings, seedDefaultCollectionTemplates,
} from '../lib/collections'
import './CollectionsSetupWizard.css'

const PIX_KEY_TYPES: { value: PixKeyType; label: string }[] = [{ value: 'cpf', label: 'CPF' }, { value: 'cnpj', label: 'CNPJ' }, { value: 'email', label: 'E-mail' }, { value: 'telefone', label: 'Telefone' }, { value: 'aleatoria', label: 'Aleatória' }]

/**
 * "Configure suas cobranças" em 3 passos — menos decisões, mais
 * defaults (briefing §12/§34, componente reutilizável para um futuro
 * onboarding geral, mas não é o onboarding em si). Nada de bank
 * agency/late fee/metadata aqui — isso é "Configurações avançadas",
 * fora do wizard (briefing §13, progressive disclosure).
 */
export function CollectionsSetupWizard({ onClose, onDone }: { onClose: () => void; onDone: (templates: CollectionMessageTemplate[]) => void }) {
  const toast = useToast()
  const [step, setStep] = useState(0)
  const [settings, setSettings] = useState<OrganizationCollectionSettings>(EMPTY_COLLECTION_SETTINGS)
  const [saving, setSaving] = useState(false)
  const [templates, setTemplates] = useState<CollectionMessageTemplate[]>([])

  const nothingSelected = !settings.pixEnabled && !settings.bankTransferEnabled && !settings.paymentLinkEnabled

  const finishStep2 = async () => {
    setSaving(true)
    try {
      const saved = await saveOrganizationCollectionSettings(settings)
      setSettings(saved)
      const seeded = await seedDefaultCollectionTemplates()
      setTemplates(seeded)
      setStep(2)
    } catch (reason) { toast.push(reason instanceof Error ? reason.message : 'Não foi possível salvar.', { tone: 'error' }) }
    finally { setSaving(false) }
  }

  return <Modal open onClose={onClose} eyebrow="CONFIGURE SUAS COBRANÇAS" title={['Como você recebe?', 'Informe seus dados', 'Como deseja falar com seus clientes?', 'Cobranças configuradas'][step]}>
    <Stepper steps={['Recebimento', 'Dados', 'Mensagens']} currentIndex={Math.min(step, 2)} />

    {step === 0 && <div className="setup-wizard-step">
      <p className="setup-wizard-hint">Escolha uma ou mais formas de pagamento — nada aqui é obrigatório, você pode mudar depois.</p>
      <label className="setup-wizard-choice"><input type="checkbox" checked={settings.pixEnabled} onChange={(e) => setSettings({ ...settings, pixEnabled: e.target.checked })} /> PIX</label>
      <label className="setup-wizard-choice"><input type="checkbox" checked={settings.bankTransferEnabled} onChange={(e) => setSettings({ ...settings, bankTransferEnabled: e.target.checked })} /> Transferência bancária</label>
      <label className="setup-wizard-choice"><input type="checkbox" checked={settings.paymentLinkEnabled} onChange={(e) => setSettings({ ...settings, paymentLinkEnabled: e.target.checked })} /> Link de pagamento</label>
      <div className="setup-wizard-actions"><PrimaryButton disabled={nothingSelected} onClick={() => setStep(1)}>Continuar</PrimaryButton></div>
      {nothingSelected && <p className="setup-wizard-hint">Selecione ao menos uma opção para continuar — você sempre pode ativar as outras depois.</p>}
    </div>}

    {step === 1 && <div className="setup-wizard-step">
      {settings.pixEnabled && <div className="setup-wizard-group">
        <h4>PIX</h4>
        <label className="field"><span>Tipo de chave</span><select value={settings.pixKeyType} onChange={(e) => setSettings({ ...settings, pixKeyType: e.target.value as PixKeyType })}><option value="">Selecione</option>{PIX_KEY_TYPES.map((t) => <option value={t.value} key={t.value}>{t.label}</option>)}</select></label>
        <label className="field"><span>Chave PIX</span><input value={settings.pixKey} onChange={(e) => setSettings({ ...settings, pixKey: e.target.value })} /></label>
        <label className="field"><span>Nome do titular</span><input value={settings.pixHolderName} onChange={(e) => setSettings({ ...settings, pixHolderName: e.target.value })} /></label>
      </div>}
      {settings.bankTransferEnabled && <div className="setup-wizard-group">
        <h4>Transferência bancária</h4>
        <label className="field"><span>Banco</span><input value={settings.bankName} onChange={(e) => setSettings({ ...settings, bankName: e.target.value })} /></label>
        <label className="field"><span>Agência</span><input value={settings.bankAgency} onChange={(e) => setSettings({ ...settings, bankAgency: e.target.value })} /></label>
        <label className="field"><span>Conta</span><input value={settings.bankAccount} onChange={(e) => setSettings({ ...settings, bankAccount: e.target.value })} /></label>
      </div>}
      {settings.paymentLinkEnabled && <div className="setup-wizard-group">
        <h4>Link de pagamento</h4>
        <label className="field"><span>Endereço do link</span><input value={settings.paymentLinkUrl} onChange={(e) => setSettings({ ...settings, paymentLinkUrl: e.target.value })} /></label>
      </div>}
      <div className="setup-wizard-actions"><SecondaryButton onClick={() => setStep(0)}>Voltar</SecondaryButton><PrimaryButton loading={saving} onClick={() => void finishStep2()}>Continuar</PrimaryButton></div>
    </div>}

    {step === 2 && <div className="setup-wizard-step">
      <p className="setup-wizard-hint">Preparamos mensagens prontas — você pode usar como estão ou editar quando quiser, em Configurações → Cobranças.</p>
      <ul className="setup-wizard-template-list">
        {templates.map((t) => <li key={t.id}><strong>{t.name}</strong><span>{t.body.split('\n').find((line) => line.trim())}</span></li>)}
      </ul>
      <div className="setup-wizard-actions"><PrimaryButton onClick={() => setStep(3)}>Está ótimo</PrimaryButton><SecondaryButton onClick={() => setStep(3)}>Quero editar depois</SecondaryButton></div>
    </div>}

    {step === 3 && <div className="setup-wizard-step setup-wizard-done">
      <Check size={40} />
      <p>Suas cobranças estão configuradas.</p>
      <div className="setup-wizard-actions"><PrimaryButton onClick={() => onDone(templates)}>Ir para Cobranças</PrimaryButton></div>
    </div>}
  </Modal>
}
