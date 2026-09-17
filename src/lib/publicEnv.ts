const supabaseUrl = import.meta.env.VITE_SUPABASE_URL?.trim()
const supabasePublishableKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY?.trim()
const customerMfaRequired = import.meta.env.VITE_CUSTOMER_MFA_REQUIRED?.trim().toLowerCase() === 'true'

/**
 * Allowlist explícita de infraestrutura do Mugô One. Proteção contra
 * conexão acidental a qualquer outro projeto Supabase (ex: o projeto
 * legado da RUAH) — nunca um fallback, nunca silencioso. Se
 * VITE_SUPABASE_URL não bater com um host permitido, o client
 * simplesmente não é criado (ver supabase.ts): a aplicação falha com
 * uma mensagem clara em vez de conectar em outro lugar.
 *
 * Isto vira configuração por ambiente/organização no futuro; por
 * enquanto é proteção explícita contra o risco concreto já visto neste
 * projeto (ambientes Preview/Development sem env var configurada e um
 * CSP que chegou a permitir o host antigo simultaneamente ao atual).
 */
const ALLOWED_SUPABASE_HOSTS = ['otresxebmpfwqwawdsxh.supabase.co']

function extractHost(url: string | undefined): string | null {
  if (!url) return null
  try {
    return new URL(url).host
  } catch {
    return null
  }
}

const supabaseHost = extractHost(supabaseUrl)
const supabaseHostAllowed = supabaseHost !== null && ALLOWED_SUPABASE_HOSTS.includes(supabaseHost)

if (supabaseUrl && !supabaseHostAllowed) {
  // Nunca silencioso: mesmo em produção, isto precisa aparecer no console
  // para qualquer engenheiro investigando um ambiente mal configurado.
  console.error(
    `[Mugô One] Configuração de backend inválida: VITE_SUPABASE_URL ("${supabaseHost ?? supabaseUrl}") não está na allowlist de infraestrutura Mugô One. Conexão recusada.`,
  )
}

export const publicEnv = {
  supabaseUrl,
  supabasePublishableKey,
  customerMfaRequired,
  isDevelopment: import.meta.env.DEV,
  isConfigured: Boolean(supabaseUrl && supabasePublishableKey && supabaseHostAllowed),
  backendConfigError: supabaseUrl && !supabaseHostAllowed ? 'Configuração de backend inválida para Mugô One.' : null,
} as const
