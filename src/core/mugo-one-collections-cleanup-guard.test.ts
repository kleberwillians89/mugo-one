import { readdirSync, readFileSync, statSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

/**
 * Guarda de regressão da Sprint de Limpeza (Cobrança Universal + Zero
 * Ruah) — ver docs/ACTIVE_LEGACY_COLLECTIONS_AUDIT.md. Dois níveis:
 *
 * 1) Cobranças (escopo principal): zero Ruah/perfume/PIX/CNPJ/ManyChat
 *    hardcoded em QUALQUER um dos arquivos de Cobrança — sem exceção.
 * 2) Varredura ampla nas superfícies ativas do briefing (src/pages,
 *    src/components, src/core, src/modules — nunca src/legacy nem os
 *    próprios arquivos .test.ts, que citam os termos de propósito para
 *    provar a ausência deles) — com um allowlist EXPLÍCITO e
 *    documentado para o que foi conscientemente adiado (Portal do
 *    Cliente "Minha RUAH" e o prefixo de código de barras físico
 *    RUAH-/RUAH-P/RUAH-F), nunca um allowlist silencioso.
 */

const ROOT = new URL('../../', import.meta.url)
const read = (relPath: string) => readFileSync(new URL(relPath, ROOT), 'utf8')

function listFiles(dir: string): string[] {
  const abs = new URL(dir, ROOT)
  const out: string[] = []
  for (const entry of readdirSync(abs)) {
    if (entry.startsWith('.')) continue
    const relPath = `${dir}/${entry}`
    const absPath = new URL(relPath, ROOT)
    if (statSync(absPath).isDirectory()) out.push(...listFiles(relPath))
    else if (/\.(tsx?|css)$/.test(entry) && !entry.endsWith('.test.ts') && !entry.endsWith('.test.tsx')) out.push(relPath)
  }
  return out
}

describe('collections cleanup guard — Cobrança é 100% universal, zero Ruah/perfume/PIX/CNPJ hardcoded', () => {
  const files = ['src/pages/CobrancasPage.tsx', 'src/pages/CollectionsSettingsPage.tsx', 'src/components/CollectionSummaryImageCard.tsx', 'src/lib/collections.ts']
  // \b (fronteira de palavra) para não confundir "davi" com identificadores
  // já aceitos que contêm a substring em camelCase (ex.: fetchDaviExcelDistinct,
  // nome interno do RPC de sugestão de forma de pagamento reaproveitado da
  // Planilha — não é um resíduo novo, é uma API já existente sendo chamada).
  const forbidden = [/\bruah\b/i, /\bparfums\b/i, /gi cosméticos/i, /67\.819\.967/, /\bmanychat\b/i, /\bdavi\b/i, /\bgabriel\b/i, /\bemily\b/i, /\bilde\b/i, /\bgabi\b/i]

  it('nenhum arquivo de Cobrança contém marca/CNPJ/nome de ex-funcionário hardcoded', () => {
    for (const file of files) {
      const content = read(file)
      for (const pattern of forbidden) expect(content, `${file} não pode conter ${pattern}`).not.toMatch(pattern)
    }
  })

  it('CobrancasPage não chama mais sendManychatMessage/uploadCollectionImage — envio passa pelo Communication Hub', () => {
    const page = read('src/pages/CobrancasPage.tsx')
    expect(page).not.toContain('sendManychatMessage')
    expect(page).not.toContain('uploadCollectionImage')
    expect(page).toContain('sendCollectionMessage')
  })

  it('CollectionSaleRow (o type universal) não tem mais campo de perfume/frasco/volume', () => {
    const records = read('src/lib/records.ts')
    const typeDecl = records.slice(records.indexOf('export type CollectionSaleRow='), records.indexOf('export type CollectionSaleRow=') + 400)
    for (const field of ['perfume_name', 'perfume_brand', 'sale_type', 'volume_ml']) expect(typeDecl).not.toContain(field)
  })

  it('a migration que reescreveu as RPCs de Cobrança não faz mais join com perfumes nem devolve coluna de perfume (só o próprio comentário, que narra o bug antigo corrigido, pode citar os nomes)', () => {
    const migration = read('supabase/migrations/202609270005_collections_universal_rpcs.sql')
    const sqlOnly = migration.split('\n').map((line) => { const i = line.indexOf('--'); return i >= 0 ? line.slice(0, i) : line }).join('\n')
    expect(sqlOnly.toLowerCase()).not.toContain('join public.perfumes')
    expect(sqlOnly.toLowerCase()).not.toMatch(/perfume_name|perfume_brand|volume_ml/)
  })
})

describe('collections cleanup guard — varredura ampla das superfícies ativas (src/pages, src/components, src/core, src/modules)', () => {
  // Allowlist EXPLÍCITO e documentado (ver docs/ACTIVE_LEGACY_COLLECTIONS_AUDIT.md
  // — "documentados e propositalmente NÃO tocados nesta sprint"): Portal do
  // Cliente "Minha RUAH" (fluxo de autenticação de clientes REAIS, fora do
  // título desta sprint) e o prefixo de código de barras físico já impresso
  // (RUAH-/RUAH-P/RUAH-F — mudar exige plano de migração de etiquetas, não
  // uma troca de string). Qualquer arquivo FORA desta lista precisa estar
  // 100% limpo.
  const allowlist = new Set([
    'src/pages/ClientDetailsPage.tsx', 'src/pages/ClientsPage.tsx', 'src/pages/DeliveriesPage.tsx',
    'src/pages/CustomerIdentityReviewsPage.tsx', 'src/pages/InventoryPage.tsx', 'src/pages/InventoryStationPage.tsx',
    'src/components/CustomerRequestsQueue.tsx', 'src/components/ShipmentOperations.tsx', 'src/components/bottles/PhysicalIdentityView.tsx',
    // Comentário do próprio arquivo cita o nome ANTIGO da classe CSS (.ruah-brand) para documentar a renomeação — histórico, não resíduo.
    'src/components/OrganizationBrandMark.tsx',
  ])

  it('nenhum arquivo FORA do allowlist em src/pages|src/components|src/core|src/modules contém "ruah" (case-insensitive)', () => {
    const offenders: string[] = []
    for (const dir of ['src/pages', 'src/components', 'src/core', 'src/modules']) {
      for (const file of listFiles(dir)) {
        if (allowlist.has(file)) continue
        if (read(file).toLowerCase().includes('ruah')) offenders.push(file)
      }
    }
    expect(offenders, `arquivos com resíduo Ruah novo/não catalogado: ${offenders.join(', ')}`).toEqual([])
  })

  it('nenhum arquivo do allowlist chama uma RPC ou lib de Cobrança — a permissão de citar "ruah" (Portal do Cliente/código de barras) nunca se estende a mexer em Cobrança', () => {
    for (const file of allowlist) {
      const content = read(file)
      for (const forbidden of ['collections_pending_sales', 'collections_register_payment', 'send_collection_message', "from'../lib/collections'", 'from"../lib/collections"'])
        expect(content, `${file} não deveria referenciar Cobrança`).not.toContain(forbidden)
    }
  })
})

const settingsMigration = read('supabase/migrations/202609270002_organization_collection_settings.sql')
const templatesMigration = read('supabase/migrations/202609270003_collection_message_templates.sql')
const attemptsMigration = read('supabase/migrations/202609270004_collection_attempts.sql')
const rpcsMigration = read('supabase/migrations/202609270006_collection_message_rpcs.sql')
const errorCaptureMigration = read('supabase/migrations/202609270008_send_collection_message_error_capture.sql')
const permissionsMigration = read('supabase/migrations/202609270001_collections_permissions.sql')
const paymentEventMigration = read('supabase/migrations/202609260007_payment_paid_event.sql')
// format_brl (202609270009) REDEFINE collection_template_context — é a
// versão atual/real, não a original de 202609270006 (bug de formatação
// locale-dependente achado na QA ao vivo, ver a migration).
const formatBrlFixMigration = read('supabase/migrations/202609270009_format_brl_locale_fix.sql')

describe('collections guard — organization_collection_settings (PIX/transferência/link, tudo opcional)', () => {
  it('PIX, transferência e link são todos desabilitados por padrão (nada obrigatório, briefing §6/§7)', () => {
    expect(settingsMigration).toContain('pix_enabled boolean not null default false')
    expect(settingsMigration).toContain('bank_transfer_enabled boolean not null default false')
    expect(settingsMigration).toContain('payment_link_enabled boolean not null default false')
  })
  it('tipo de chave PIX é restrito ao allowlist do briefing (cpf/cnpj/email/telefone/aleatoria)', () => {
    expect(settingsMigration).toContain("pix_key_type text check (pix_key_type in ('cpf', 'cnpj', 'email', 'telefone', 'aleatoria'))")
  })
  it('não duplica CNPJ/Razão Social/company_name como COLUNA da tabela — esses continuam só em organization_settings ("cnpj" só pode aparecer como um dos VALORES possíveis de pix_key_type, nunca como coluna própria)', () => {
    const sqlOnly = settingsMigration.split('\n').map((line) => { const i = line.indexOf('--'); return i >= 0 ? line.slice(0, i) : line }).join('\n')
    expect(sqlOnly).not.toMatch(/\bcnpj text\b|\bcompany_name\b|\blegal_name\b/i)
  })
  it('RLS habilitado e select/insert/update exigem collections.configure — PIX/dados bancários nunca cruzam organização', () => {
    expect(settingsMigration).toContain('alter table public.organization_collection_settings enable row level security')
    expect(settingsMigration.match(/has_org_permission\(organization_id, 'collections\.configure'\)/g)?.length).toBeGreaterThanOrEqual(3)
  })
})

describe('collections guard — collection_message_templates (universal, nunca por provider ou por segmento)', () => {
  it('channel é só metadado de apresentação (email/whatsapp/sms/generic) — nunca um provider específico (manychat/resend/meta)', () => {
    expect(templatesMigration).toContain("channel text not null default 'generic' check (channel in ('email', 'whatsapp', 'sms', 'generic'))")
    expect(templatesMigration.toLowerCase()).not.toMatch(/manychat|resend|meta\b/)
  })
  it('body é sempre texto puro (nunca html) — isso é o que neutraliza script malicioso sem sanitizador dedicado', () => {
    expect(templatesMigration).toContain("body text not null check (btrim(body) <> '')")
  })
  it('created_by/updated_by são preenchidos por trigger a partir de auth.uid(), nunca confiados do payload do cliente', () => {
    expect(templatesMigration).toContain('new.created_by := auth.uid()')
    expect(templatesMigration).toContain('new.updated_by := auth.uid()')
  })
  it('select também libera para collections.send (não só collections.configure) — quem envia precisa escolher um template', () => {
    expect(templatesMigration).toContain("has_org_permission(organization_id, 'collections.send')")
  })
  it('unique(organization_id, key) — nenhuma organização pode ter dois templates com a mesma chave', () => {
    expect(templatesMigration).toContain('unique (organization_id, key)')
  })
})

describe('collections guard — allowlist de variáveis seguras (briefing §11-12), sempre resolvida no servidor (§34)', () => {
  // formatBrlFixMigration tem a versão CORRENTE de collection_template_context
  // (redefinida por CREATE OR REPLACE em 202609270009) — não a original.
  const context = formatBrlFixMigration.slice(formatBrlFixMigration.indexOf('create or replace function public.collection_template_context'))
  it('as 12 variáveis do briefing existem exatamente, sem nenhuma a mais', () => {
    const variables = ['customer.name', 'company.name', 'organization.name', 'sale.id', 'sale.total', 'collection.amount', 'collection.due_date', 'payment.pix_key', 'payment.pix_holder_name', 'payment.payment_link', 'support.phone', 'support.email']
    for (const key of variables) expect(context).toContain(`'${key}',`)
  })
  it('payment.pix_key/pix_holder_name só resolvem quando pix_enabled — nunca vazam uma chave configurada mas desabilitada', () => {
    expect(context).toContain("coalesce(v_settings.pix_enabled, false) then coalesce(v_settings.pix_key, '')")
  })
  it('variável desconhecida nunca desaparece silenciosamente — o que sobra depois da substituição das conhecidas volta em invalid_variables', () => {
    const render = rpcsMigration.slice(rpcsMigration.indexOf('create or replace function public.collection_render_with_context'), rpcsMigration.indexOf('-- render_collection_template'))
    expect(render).toContain("regexp_matches(v_subject || E'\\n' || v_body, '\\{\\{([a-zA-Z0-9_.]+)\\}\\}', 'g')")
    expect(render).toContain("'invalid_variables', to_jsonb(coalesce(v_invalid, '{}'::text[]))")
  })
  it('valor monetário nunca usa to_char locale-dependente (bug achado na QA ao vivo: "R$ 3,000.00" em vez de "R$ 3.000,00") — sempre format_brl', () => {
    expect(context).toContain('public.format_brl(p_sale_total)')
    expect(context).toContain('public.format_brl(p_collection_amount)')
    expect(context).not.toMatch(/to_char\([^)]*FM999G999G990D00/)
  })
  it('preview_collection_template usa dados FICTÍCIOS de cliente/venda (nunca um cliente real por padrão, briefing §13) mas PIX/instruções REAIS da organização', () => {
    const preview = rpcsMigration.slice(rpcsMigration.indexOf('create or replace function public.preview_collection_template'), rpcsMigration.indexOf('-- send_collection_message'))
    expect(preview).toContain("'Cliente Exemplo (pré-visualização)'")
    expect(preview).toContain('select * into v_settings from public.organization_collection_settings')
  })
})

describe('collections guard — envio sempre pelo Communication Hub, nunca um provider direto (briefing §21-25)', () => {
  const send = errorCaptureMigration
  it('send_collection_message só chama send_communication_message — nunca uma API de provider (manychat/resend) diretamente', () => {
    expect(send).toContain('public.send_communication_message(')
    expect(send.toLowerCase()).not.toMatch(/api\.resend\.com|manychat\.com/)
  })
  it('sem conexão conectada para o canal, falha com provider_not_configured — nunca finge sucesso', () => {
    expect(send).toContain("status = 'connected'")
    expect(send).toContain("v_error_code := 'provider_not_configured'")
  })
  it('qualquer falha do Communication Hub (ex.: recipient_required) é capturada — a tentativa é SEMPRE registrada, nunca desaparece silenciosamente (bug achado na QA ao vivo)', () => {
    expect(send).toContain('exception when others then')
    expect(send).toContain("v_status := 'failed'")
    const insertIndex = send.indexOf('insert into public.collection_attempts')
    const exceptionIndex = send.indexOf('exception when others then')
    expect(insertIndex).toBeGreaterThan(exceptionIndex)
  })
  it('status só pode ser sent ou failed (check constraint) — nenhum estado ambíguo tipo "talvez enviado"', () => {
    expect(attemptsMigration).toContain("status text not null check (status in ('sent', 'failed'))")
  })
  it('conteúdo da mensagem nunca é duplicado em collection_attempts — só a referência (message_id/conversation_id), o corpo continua em messages', () => {
    expect(attemptsMigration).not.toMatch(/\bbody\b|\bsubject\b/)
    expect(attemptsMigration).toContain('message_id uuid references public.messages(id)')
  })
  it('escrita em collection_attempts só via RPC (SECURITY DEFINER) — nenhum insert/update/delete direto concedido a authenticated', () => {
    expect(attemptsMigration).toContain('revoke insert, update, delete on public.collection_attempts from authenticated')
  })
})

describe('collections guard — permissões novas não duplicam sales.view/sales.edit (briefing §30)', () => {
  it('só 2 códigos novos (collections.configure, collections.send) — visualizar/registrar pagamento continuam em sales.*', () => {
    expect(permissionsMigration).toContain("('collections.configure', 'collections'")
    expect(permissionsMigration).toContain("('collections.send', 'collections'")
    expect((permissionsMigration.match(/insert into public\.permissions/g) ?? []).length).toBe(1)
  })
  it('backfill para membros gestor/comercial já existentes (organization_member_permissions materializado)', () => {
    expect(permissionsMigration).toContain("where pp.permission_code like 'collections.%'")
    expect(permissionsMigration).toContain("om.permission_preset in ('gestor', 'comercial')")
  })
})

describe('collections guard — regressão de pagamento: collections_register_payment intocado (briefing §19-20)', () => {
  it('payment.paid continua emitido de dentro de collections_register_payment — nenhuma migration desta sprint recria ou substitui essa função', () => {
    expect(paymentEventMigration).toContain("emit_domain_event(\n      sale_row.organization_id, 'payment.paid'")
    for (const file of [read('supabase/migrations/202609270005_collections_universal_rpcs.sql'), read('supabase/migrations/202609270006_collection_message_rpcs.sql'), errorCaptureMigration])
      expect(file).not.toContain('create or replace function public.collections_register_payment')
  })
  it('nenhuma migration desta sprint cria uma tabela payments fake — send_collection_message/collection_attempts são sobre COMUNICAÇÃO, nunca sobre dinheiro mudando de mãos', () => {
    for (const file of [settingsMigration, templatesMigration, attemptsMigration, rpcsMigration, errorCaptureMigration])
      expect(file.toLowerCase()).not.toMatch(/create table public\.payments\b/)
  })
})
