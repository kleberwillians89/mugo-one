import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

/**
 * Guarda de regressão do Communication Hub (Sprint N) — ver
 * docs/COMMUNICATION_HUB_MIGRATION_PLAN.md. O caminho de negócio
 * completo (conversation→message→status→touchpoint, idempotência,
 * cross-tenant, 4 verticais) já foi provado ao vivo contra o staging
 * durante a sprint — esta suíte protege as propriedades estruturais
 * que webhook/RLS/UI precisam manter sem depender de banco.
 */

const migration = (name: string) => readFileSync(new URL(`../../supabase/migrations/${name}`, import.meta.url), 'utf8')
const readSrc = (relPath: string) => readFileSync(new URL(`../${relPath}`, import.meta.url), 'utf8')

const tasksFoundation = migration('202609220001_tasks_foundation.sql')
const connections = migration('202609240002_communication_connections.sql')
const conversations = migration('202609240003_conversations.sql')
const messages = migration('202609240004_messages.sql')
const identities = migration('202609240005_communication_identities.sql')
const operations = migration('202609240006_communication_operations.sql')
const messagingRpcs = migration('202609240007_communication_messaging_rpcs.sql')
const sendEmail = readSrc('../supabase/functions/send-email/index.ts')
const webhook = readSrc('../supabase/functions/communication-webhook/index.ts')

describe('communication hub guard — send-email é autenticado e sem conteúdo fixo', () => {
  it('usa context() (Bearer + organização resolvida), diferente do lead-intake público', () => {
    expect(sendEmail).toContain('await context(req)')
  })
  it('assunto/corpo vêm sempre do chamador — nenhum texto de e-mail fixo tipo "Minha RUAH"/"CRIAR MINHA SENHA"', () => {
    expect(sendEmail).not.toMatch(/minha ruah|criar minha senha/i)
  })
})

describe('communication hub guard — Core não conhece nenhum provider por nome', () => {
  const forbiddenProviderNames = ['manychat', 'twilio', 'zenvia', 'gti']
  const CORE_FILES = ['lib/communications.ts', 'pages/ConversationsPage.tsx', 'pages/CommunicationsSettingsPage.tsx', 'components/NewConversationModal.tsx', 'components/EntityConversationsBlock.tsx']
  it('nenhum arquivo do Core cita ManyChat/Twilio/Zenvia/GTI — só "resend"/"mock" como valores de provider, nunca como lógica de negócio', () => {
    for (const file of CORE_FILES) {
      const content = readSrc(file).toLowerCase()
      for (const name of forbiddenProviderNames) expect(content, `${file} não pode citar "${name}"`).not.toContain(name)
    }
  })
  it('as colunas de schema (channel/provider) de conversations/messages/identities nunca fixam um provider como valor — são texto livre preenchido em runtime', () => {
    for (const sql of [conversations, messages, identities]) {
      expect(sql).not.toMatch(/provider text.*check \(provider in/)
    }
  })
})

describe('communication hub guard — channel é texto livre, nunca um enum rígido', () => {
  it('conversations.channel e messages.channel não têm CHECK IN (...) restringindo valores', () => {
    expect(conversations).toMatch(/channel text not null check \(btrim\(channel\)/)
    expect(conversations).not.toMatch(/channel text.*check \(channel in/)
    expect(messages).toMatch(/channel text not null check \(btrim\(channel\)/)
    expect(messages).not.toMatch(/channel text.*check \(channel in/)
  })
})

describe('communication hub guard — escrita de conversations/messages só via RPC SECURITY DEFINER', () => {
  it('nenhuma das duas tabelas concede insert/update a authenticated diretamente', () => {
    expect(conversations).not.toMatch(/grant\s+(insert|update).*on public\.conversations\s+to\s+authenticated/i)
    expect(messages).not.toMatch(/grant\s+(insert|update).*on public\.messages\s+to\s+authenticated/i)
  })
  it('send_communication_message e update_message_delivery_status são SECURITY DEFINER com checagem de permissão/role em runtime', () => {
    expect(messagingRpcs).toContain("auth.role() <> 'service_role' and not public.has_org_permission(p_organization_id, 'communications.send')")
    expect(messagingRpcs).toContain("if auth.role() <> 'service_role' then")
  })
})

describe('communication hub guard — idempotência e não-regressão de status', () => {
  it('messages é idempotente por (organization_id, provider, provider_message_id)', () => {
    expect(messages).toContain('create unique index messages_org_provider_message_idx')
  })
  it('update_message_delivery_status nunca regride um status que já avançou', () => {
    expect(messagingRpcs).toContain('v_rank_new < v_rank_current')
    expect(messagingRpcs).toContain("'ignored_out_of_order'")
  })
  it('conversations é idempotente por (organization_id, provider, external_thread_id) quando ambos existem', () => {
    expect(conversations).toContain('create unique index conversations_org_provider_thread_idx')
  })
})

describe('communication hub guard — webhook nunca confia no payload para identidade/organização', () => {
  it('a resolução de tenant vem SEMPRE da message já existente (por provider_message_id), nunca de um campo do corpo recebido', () => {
    expect(webhook).not.toMatch(/organization_id\s*[:=]\s*event/i)
    expect(webhook).toContain('p_provider_message_id: providerMessageId')
  })
  it('o webhook verifica assinatura Svix (HMAC) antes de tocar no payload, com janela de replay limitada', () => {
    expect(webhook).toContain('verifySvixSignature')
    expect(webhook).toContain('crypto.subtle.sign')
    expect(webhook).toMatch(/Math\.abs\(Date\.now\(\) \/ 1000 - timestampSeconds\) > 300/)
  })
  it('tipos de evento não mapeados retornam 200 (nunca erro) para não causar retry infinito do provider', () => {
    expect(webhook).toContain("json({ data: { status: 'ignored' } }, 200)")
  })
})

describe('communication hub guard — segredos nunca em VITE_/frontend', () => {
  it('RESEND_API_KEY/RESEND_WEBHOOK_SECRET só aparecem em código de Edge Function, nunca em src/lib ou src/pages', () => {
    for (const file of ['lib/communications.ts', 'pages/ConversationsPage.tsx', 'pages/CommunicationsSettingsPage.tsx']) {
      const content = readSrc(file)
      expect(content).not.toMatch(/RESEND_API_KEY|RESEND_WEBHOOK_SECRET/)
      expect(content).not.toMatch(/VITE_RESEND|VITE_WHATSAPP|VITE_MANYCHAT/)
    }
  })
  it('a UI de conexão de e-mail nunca pede/mostra campo de API key — só remetente/nome', () => {
    const settingsPage = readSrc('pages/CommunicationsSettingsPage.tsx')
    expect(settingsPage.toLowerCase()).not.toMatch(/api[_\s-]?key|token/)
  })
})

describe('communication hub guard — conexões falsas não são oferecidas (briefing §60)', () => {
  it('WhatsApp/SMS/Instagram mostram "Em breve", sem botão de conectar', () => {
    const settingsPage = readSrc('pages/CommunicationsSettingsPage.tsx')
    expect(settingsPage).toContain('EM BREVE')
    expect(settingsPage).not.toMatch(/Conectar\s+(WhatsApp|SMS|Instagram)/)
  })
})

describe('communication hub guard — não decide pipeline nem abre entity_type novo em tasks', () => {
  it('create_task ganhou p_metadata opcional nesta sprint', () => {
    expect(operations).toContain('p_metadata jsonb default \'{}\'::jsonb')
  })
  it('a migration original de tasks (Sprint K/L) nunca foi reescrita para incluir conversation em tasks.entity_type — a integração usa metadata, não um novo caso de entity_type', () => {
    expect(tasksFoundation).not.toMatch(/entity_type in \([^)]*'conversation'/)
  })
})

describe('communication hub guard — nenhum arquivo novo contém termos verticais nem nomes de pessoas da operação antiga', () => {
  // \b...\b: "apc" como PALAVRA — "mapConversation" (nome de helper
  // desta própria sprint) contém a substring "apC" sem ter relação
  // nenhuma com o termo vertical "APC" — mesma classe de falso positivo
  // já vista em sprints anteriores (substring sem word-boundary).
  const forbidden = [/perfume/, /frasco/, /splitar/, /bottle/, /\bapc\b/]
  const NEW_FILES = [
    'lib/communications.ts', 'pages/ConversationsPage.tsx', 'pages/CommunicationsSettingsPage.tsx',
    'components/NewConversationModal.tsx', 'components/EntityConversationsBlock.tsx', 'components/SettingsTabs.tsx',
  ]
  it('nenhum arquivo novo contém termos verticais', () => {
    for (const file of NEW_FILES) {
      const content = readSrc(file).toLowerCase()
      for (const word of forbidden) expect(content, `${file} não pode conter "${word}"`).not.toMatch(word)
    }
  })
  it('nenhuma pessoa da operação antiga aparece nos arquivos novos', () => {
    for (const file of NEW_FILES) expect(readSrc(file)).not.toMatch(/\b(Davi|Gabriel|Emily|Ilde|Gabi)\b/)
  })
})

describe('communication hub guard — nome da UI é provider-agnostic (briefing §63)', () => {
  it('a página nunca se chama "WhatsApp Inbox" em nenhum lugar visível', () => {
    for (const file of ['pages/ConversationsPage.tsx', 'routing.ts']) {
      expect(readSrc(file)).not.toMatch(/whatsapp\s*inbox/i)
    }
  })
})

describe('communication hub guard — connections nunca guardam segredo em texto', () => {
  it('communication_connections só tem credentials_reference (rótulo) e configuration (não-sensível) — nenhuma coluna literal "secret"/"token"/"api_key"', () => {
    expect(connections).not.toMatch(/\b(api_key|secret|token)\s+text/)
    expect(connections).toContain('credentials_reference text')
  })
})
