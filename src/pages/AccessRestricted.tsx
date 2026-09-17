import { ShieldAlert } from 'lucide-react'

/**
 * Digitar a URL de um módulo sem permissão nunca deve dar 404 (briefing
 * "ROTAS E MENU": "mostrar ACESSO RESTRITO, não 404") — 404 sugere "essa
 * página não existe", quando na verdade existe e só está bloqueada. O
 * backend nega a mesma coisa de qualquer forma (RPC/RLS); isto é só a
 * mensagem certa em vez de uma tela quebrada.
 */
export function AccessRestricted() {
  return (
    <div className="page">
      <div className="empty card">
        <div className="empty-icon"><ShieldAlert /></div>
        <h3>ACESSO RESTRITO</h3>
        <p>Seu perfil não tem permissão para ver esta área. Fale com quem administra sua conta no Mugô One se precisar de acesso.</p>
      </div>
    </div>
  )
}
