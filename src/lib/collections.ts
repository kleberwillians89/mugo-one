import { supabase } from './supabase'
import { authenticatedOrganization } from './records'

/**
 * Cobrança universal (Sprint de Limpeza) — Core só entrega Cobrança +
 * Template + Variáveis + Communication Hub; cada organização configura
 * sua própria identidade/PIX/instruções/templates (ver
 * docs/ACTIVE_LEGACY_COLLECTIONS_AUDIT.md).
 */

export type PixKeyType = 'cpf' | 'cnpj' | 'email' | 'telefone' | 'aleatoria'

export type OrganizationCollectionSettings = {
  displayName: string
  paymentInstructions: string
  pixEnabled: boolean
  pixKeyType: PixKeyType | ''
  pixKey: string
  pixHolderName: string
  bankTransferEnabled: boolean
  bankName: string
  bankAgency: string
  bankAccount: string
  bankAccountHolder: string
  paymentLinkEnabled: boolean
  paymentLinkUrl: string
  defaultDueDays: number
  lateFeeText: string
  interestText: string
  supportPhone: string
  supportEmail: string
  footerText: string
}

export const EMPTY_COLLECTION_SETTINGS: OrganizationCollectionSettings = {
  displayName: '', paymentInstructions: '', pixEnabled: false, pixKeyType: '', pixKey: '', pixHolderName: '',
  bankTransferEnabled: false, bankName: '', bankAgency: '', bankAccount: '', bankAccountHolder: '',
  paymentLinkEnabled: false, paymentLinkUrl: '', defaultDueDays: 7, lateFeeText: '', interestText: '',
  supportPhone: '', supportEmail: '', footerText: '',
}

type SettingsRow = {
  display_name: string | null; payment_instructions: string | null
  pix_enabled: boolean; pix_key_type: PixKeyType | null; pix_key: string | null; pix_holder_name: string | null
  bank_transfer_enabled: boolean; bank_name: string | null; bank_agency: string | null; bank_account: string | null; bank_account_holder: string | null
  payment_link_enabled: boolean; payment_link_url: string | null
  default_due_days: number; late_fee_text: string | null; interest_text: string | null
  support_phone: string | null; support_email: string | null; footer_text: string | null
}

const SETTINGS_COLUMNS = 'display_name,payment_instructions,pix_enabled,pix_key_type,pix_key,pix_holder_name,bank_transfer_enabled,bank_name,bank_agency,bank_account,bank_account_holder,payment_link_enabled,payment_link_url,default_due_days,late_fee_text,interest_text,support_phone,support_email,footer_text'

function mapSettings(row: SettingsRow): OrganizationCollectionSettings {
  return {
    displayName: row.display_name ?? '', paymentInstructions: row.payment_instructions ?? '',
    pixEnabled: row.pix_enabled, pixKeyType: row.pix_key_type ?? '', pixKey: row.pix_key ?? '', pixHolderName: row.pix_holder_name ?? '',
    bankTransferEnabled: row.bank_transfer_enabled, bankName: row.bank_name ?? '', bankAgency: row.bank_agency ?? '', bankAccount: row.bank_account ?? '', bankAccountHolder: row.bank_account_holder ?? '',
    paymentLinkEnabled: row.payment_link_enabled, paymentLinkUrl: row.payment_link_url ?? '',
    defaultDueDays: row.default_due_days, lateFeeText: row.late_fee_text ?? '', interestText: row.interest_text ?? '',
    supportPhone: row.support_phone ?? '', supportEmail: row.support_email ?? '', footerText: row.footer_text ?? '',
  }
}

export async function fetchOrganizationCollectionSettings(): Promise<OrganizationCollectionSettings | null> {
  if (!supabase) throw new Error('Conecte o Supabase para continuar.')
  const { organizationId } = await authenticatedOrganization()
  const { data, error } = await supabase.from('organization_collection_settings').select(SETTINGS_COLUMNS).eq('organization_id', organizationId).maybeSingle()
  if (error) throw new Error(error.message)
  return data ? mapSettings(data as SettingsRow) : null
}

export async function saveOrganizationCollectionSettings(input: OrganizationCollectionSettings): Promise<OrganizationCollectionSettings> {
  if (!supabase) throw new Error('Conecte o Supabase para continuar.')
  const { organizationId } = await authenticatedOrganization()
  const payload = {
    organization_id: organizationId,
    display_name: input.displayName || null, payment_instructions: input.paymentInstructions || null,
    pix_enabled: input.pixEnabled, pix_key_type: input.pixKeyType || null, pix_key: input.pixKey || null, pix_holder_name: input.pixHolderName || null,
    bank_transfer_enabled: input.bankTransferEnabled, bank_name: input.bankName || null, bank_agency: input.bankAgency || null, bank_account: input.bankAccount || null, bank_account_holder: input.bankAccountHolder || null,
    payment_link_enabled: input.paymentLinkEnabled, payment_link_url: input.paymentLinkUrl || null,
    default_due_days: input.defaultDueDays, late_fee_text: input.lateFeeText || null, interest_text: input.interestText || null,
    support_phone: input.supportPhone || null, support_email: input.supportEmail || null, footer_text: input.footerText || null,
  }
  const { data, error } = await supabase.from('organization_collection_settings').upsert(payload, { onConflict: 'organization_id' }).select(SETTINGS_COLUMNS).single()
  if (error) throw new Error(error.message)
  return mapSettings(data as SettingsRow)
}

export type CollectionMessageChannel = 'email' | 'whatsapp' | 'sms' | 'generic'
export type CollectionTemplateSituation = 'initial' | 'due_today' | 'overdue' | 'second_reminder' | 'paid'

export type CollectionMessageTemplate = {
  id: string; name: string; key: string; channel: CollectionMessageChannel; subject: string; body: string; active: boolean
  isDefault: boolean; situation: CollectionTemplateSituation | null; updatedAt: string
}

type TemplateRow = {
  id: string; name: string; key: string; channel: CollectionMessageChannel; subject: string | null; body: string; active: boolean
  is_default: boolean; situation: CollectionTemplateSituation | null; updated_at: string
}
const TEMPLATE_COLUMNS = 'id,name,key,channel,subject,body,active,is_default,situation,updated_at'

function mapTemplate(row: TemplateRow): CollectionMessageTemplate {
  return { id: row.id, name: row.name, key: row.key, channel: row.channel, subject: row.subject ?? '', body: row.body, active: row.active, isDefault: row.is_default, situation: row.situation, updatedAt: row.updated_at }
}

/** Template usado quando "Cobrar" não precisa perguntar nada — o padrão da organização, associado à situação específica (ex.: vencida) quando existir, senão o padrão geral, senão o primeiro ativo. Nunca pergunta ao usuário se já existe uma resposta óbvia (princípio "menos decisões"). */
export function defaultTemplateFor(templates: CollectionMessageTemplate[], situation?: CollectionTemplateSituation | null): CollectionMessageTemplate | null {
  const active = templates.filter((t) => t.active)
  return (situation && active.find((t) => t.situation === situation)) ?? active.find((t) => t.isDefault) ?? active[0] ?? null
}

export async function fetchCollectionMessageTemplates(): Promise<CollectionMessageTemplate[]> {
  if (!supabase) throw new Error('Conecte o Supabase para continuar.')
  await authenticatedOrganization()
  const { data, error } = await supabase.from('collection_message_templates').select(TEMPLATE_COLUMNS).order('created_at', { ascending: true })
  if (error) throw new Error(error.message)
  return (data ?? []).map((row) => mapTemplate(row as TemplateRow))
}

export async function seedDefaultCollectionTemplates(): Promise<CollectionMessageTemplate[]> {
  if (!supabase) throw new Error('Conecte o Supabase para continuar.')
  const { organizationId } = await authenticatedOrganization()
  const { data, error } = await supabase.rpc('seed_default_collection_templates', { p_organization_id: organizationId })
  if (error) throw new Error(error.message)
  return ((data ?? []) as TemplateRow[]).map(mapTemplate)
}

/**
 * O usuário NUNCA deve ver uma tela vazia de templates se ele tem como
 * resolver isso sozinho — só popula silenciosamente quando a organização
 * ainda não tem nenhum template E quem está olhando pode configurar
 * (collections.configure); sem essa permissão, a ausência é só
 * reportada (não há nada que a pessoa consiga fazer sobre isso aqui).
 */
export async function ensureCollectionTemplatesSeeded(canConfigure: boolean): Promise<CollectionMessageTemplate[]> {
  const templates = await fetchCollectionMessageTemplates()
  if (templates.length > 0 || !canConfigure) return templates
  try { return await seedDefaultCollectionTemplates() } catch { return templates }
}

export type CollectionTemplateInput = { name: string; key: string; channel: CollectionMessageChannel; subject: string; body: string; active: boolean }

export async function createCollectionMessageTemplate(input: CollectionTemplateInput): Promise<CollectionMessageTemplate> {
  if (!supabase) throw new Error('Conecte o Supabase para continuar.')
  const { organizationId } = await authenticatedOrganization()
  const { data, error } = await supabase.from('collection_message_templates').insert({
    organization_id: organizationId, name: input.name, key: input.key, channel: input.channel,
    subject: input.subject || null, body: input.body, active: input.active,
  }).select(TEMPLATE_COLUMNS).single()
  if (error) throw new Error(error.message)
  return mapTemplate(data as TemplateRow)
}

export async function updateCollectionMessageTemplate(id: string, input: CollectionTemplateInput): Promise<CollectionMessageTemplate> {
  if (!supabase) throw new Error('Conecte o Supabase para continuar.')
  await authenticatedOrganization()
  const { data, error } = await supabase.from('collection_message_templates').update({
    name: input.name, key: input.key, channel: input.channel, subject: input.subject || null, body: input.body, active: input.active,
  }).eq('id', id).select(TEMPLATE_COLUMNS).single()
  if (error) throw new Error(error.message)
  return mapTemplate(data as TemplateRow)
}

export async function deleteCollectionMessageTemplate(id: string): Promise<void> {
  if (!supabase) throw new Error('Conecte o Supabase para continuar.')
  await authenticatedOrganization()
  const { error } = await supabase.from('collection_message_templates').delete().eq('id', id)
  if (error) throw new Error(error.message)
}

/** Marca um template como o padrão da organização (nunca dois ao mesmo tempo — trocar desmarca o anterior atomicamente no servidor). */
export async function setDefaultCollectionTemplate(id: string): Promise<CollectionMessageTemplate> {
  if (!supabase) throw new Error('Conecte o Supabase para continuar.')
  const { data, error } = await supabase.rpc('set_default_collection_template', { p_template_id: id })
  if (error) throw new Error(error.message)
  return mapTemplate(data as TemplateRow)
}

/** Associa (ou remove, com situation=null) um template a uma situação — só configuração/leitura, nenhum disparo automático (briefing §4: "não criar Automation Scheduler agora"). */
export async function setCollectionTemplateSituation(id: string, situation: CollectionTemplateSituation | null): Promise<CollectionMessageTemplate> {
  if (!supabase) throw new Error('Conecte o Supabase para continuar.')
  const { data, error } = await supabase.rpc('set_collection_template_situation', { p_template_id: id, p_situation: situation })
  if (error) throw new Error(error.message)
  return mapTemplate(data as TemplateRow)
}

export type RenderedCollectionMessage = { subject: string; body: string; invalidVariables: string[] }

function mapRendered(data: unknown): RenderedCollectionMessage {
  const row = data as { subject: string; body: string; invalid_variables: string[] }
  return { subject: row.subject, body: row.body, invalidVariables: row.invalid_variables ?? [] }
}

/** Pré-visualização com dados fictícios (nunca um cliente real por padrão) — briefing §13. */
export async function previewCollectionTemplate(templateId: string): Promise<RenderedCollectionMessage> {
  if (!supabase) throw new Error('Conecte o Supabase para continuar.')
  const { organizationId } = await authenticatedOrganization()
  const { data, error } = await supabase.rpc('preview_collection_template', { p_organization_id: organizationId, p_template_id: templateId })
  if (error) throw new Error(error.message)
  return mapRendered(data)
}

/** Renderiza com dados REAIS do cliente/vendas — usado para copiar a mensagem (nunca envia nada sozinho). Resolução de variável sempre no servidor (briefing §34). */
export async function renderCollectionTemplate(clientId: string, saleIds: string[], templateId: string): Promise<RenderedCollectionMessage> {
  if (!supabase) throw new Error('Conecte o Supabase para continuar.')
  const { organizationId } = await authenticatedOrganization()
  const { data, error } = await supabase.rpc('render_collection_template', { p_organization_id: organizationId, p_template_id: templateId, p_client_id: clientId, p_sale_ids: saleIds })
  if (error) throw new Error(error.message)
  return mapRendered(data)
}

export type RecentlyPaidCollection = { id: string; clientId: string; clientName: string; clientNumber: number | null; amount: number; paidAt: string; paymentMethod: string | null }

/** Últimos 30 dias de pagamentos — só para a aba "Pagas" da tela principal (confirmação/celebração, briefing §14); histórico completo continua em Vendas. */
export async function fetchRecentlyPaidCollections(): Promise<RecentlyPaidCollection[]> {
  if (!supabase) throw new Error('Conecte o Supabase para continuar.')
  await authenticatedOrganization()
  const since = new Date(); since.setDate(since.getDate() - 30)
  const { data, error } = await supabase.from('sales').select('id,client_id,amount,paid_at,payment_method,clients(name,client_number)').eq('payment_status', 'paid').gte('paid_at', since.toISOString().slice(0, 10)).is('deleted_at', null).order('paid_at', { ascending: false }).limit(200)
  if (error) throw new Error(error.message)
  type Row = { id: string; client_id: string; amount: number; paid_at: string; payment_method: string | null; clients: { name: string; client_number: number | null } | null }
  return (data ?? []).map((row: unknown) => {
    const r = row as Row
    return { id: r.id, clientId: r.client_id, clientName: r.clients?.name ?? 'Cliente', clientNumber: r.clients?.client_number ?? null, amount: Number(r.amount), paidAt: r.paid_at, paymentMethod: r.payment_method }
  })
}

/** Soma paga no mês corrente — para o card "Recebidas no mês" da tela principal (mesma tabela/RLS de sales, sem RPC nova). */
export async function fetchCollectionsPaidThisMonth(): Promise<number> {
  if (!supabase) throw new Error('Conecte o Supabase para continuar.')
  await authenticatedOrganization()
  const firstOfMonth = new Date(); firstOfMonth.setDate(1); firstOfMonth.setHours(0, 0, 0, 0)
  const { data, error } = await supabase.from('sales').select('amount').eq('payment_status', 'paid').gte('paid_at', firstOfMonth.toISOString().slice(0, 10)).is('deleted_at', null)
  if (error) throw new Error(error.message)
  return (data ?? []).reduce((sum: number, row: { amount: number }) => sum + Number(row.amount), 0)
}

export type SendCollectionMessageResult = { attemptId: string; status: 'sent' | 'failed'; errorCode: string | null; errorMessage: string | null }

/** Envia pelo Communication Hub (nunca um provider direto) — sem provider conectado para o canal, volta status:'failed'/errorCode:'provider_not_configured', nunca lança e nunca finge sucesso. */
export async function sendCollectionMessage(clientId: string, saleIds: string[], templateId: string, channel: CollectionMessageChannel = 'email'): Promise<SendCollectionMessageResult> {
  if (!supabase) throw new Error('Conecte o Supabase para continuar.')
  const { organizationId } = await authenticatedOrganization()
  const { data, error } = await supabase.rpc('send_collection_message', {
    p_organization_id: organizationId, p_client_id: clientId, p_sale_ids: saleIds, p_template_id: templateId, p_channel: channel,
  })
  if (error) throw new Error(error.message)
  const row = data as { attempt_id: string; status: 'sent' | 'failed'; error_code: string | null; error_message: string | null }
  return { attemptId: row.attempt_id, status: row.status, errorCode: row.error_code, errorMessage: row.error_message }
}
