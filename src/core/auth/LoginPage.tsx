import { useState, type FormEvent } from 'react'
import { Navigate } from 'react-router-dom'
import { useAuth } from './useAuth'

export function LoginPage() {
  const {
    user,
    loading,
    signInWithPassword,
    signInWithMagicLink,
    signInWithOAuth,
    resetPassword,
  } = useAuth()

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [message, setMessage] = useState('')
  const [submitting, setSubmitting] = useState(false)

  if (loading) {
    return <div>Carregando...</div>
  }

  if (user) {
    return <Navigate to="/" replace />
  }

  async function handlePasswordLogin(event: FormEvent) {
    event.preventDefault()

    setMessage('')
    setSubmitting(true)

    const result = await signInWithPassword(email, password)

    setSubmitting(false)

    if (result.error) {
      setMessage(result.error)
    }
  }

  async function handleMagicLink() {
    if (!email.trim()) {
      setMessage('Digite seu e-mail primeiro.')
      return
    }

    setSubmitting(true)

    const result = await signInWithMagicLink(email)

    setSubmitting(false)

    if (result.error) {
      setMessage(result.error)
      return
    }

    setMessage(
      'Enviamos um link de acesso para o seu e-mail.',
    )
  }

  async function handleResetPassword() {
    if (!email.trim()) {
      setMessage(
        'Digite seu e-mail para recuperar sua senha.',
      )
      return
    }

    setSubmitting(true)

    const result = await resetPassword(email)

    setSubmitting(false)

    if (result.error) {
      setMessage(result.error)
      return
    }

    setMessage(
      'Enviamos as instruções de recuperação para o seu e-mail.',
    )
  }

  return (
    <main
      style={{
        minHeight: '100vh',
        display: 'grid',
        placeItems: 'center',
        padding: 24,
      }}
    >
      <section style={{ width: '100%', maxWidth: 420 }}>
        <p>MUGÔ</p>

        <h1>Entre no Mugô One</h1>

        <p>
          Sua operação, clientes e automações em um só lugar.
        </p>

        <form onSubmit={handlePasswordLogin}>
          <label>
            E-mail
            <input
              type="email"
              value={email}
              autoComplete="email"
              required
              onChange={(event) =>
                setEmail(event.target.value)
              }
            />
          </label>

          <label>
            Senha
            <input
              type="password"
              value={password}
              autoComplete="current-password"
              required
              onChange={(event) =>
                setPassword(event.target.value)
              }
            />
          </label>

          <button type="submit" disabled={submitting}>
            Entrar
          </button>
        </form>

        <button
          type="button"
          disabled={submitting}
          onClick={handleMagicLink}
        >
          Receber link mágico
        </button>

        <button
          type="button"
          disabled={submitting}
          onClick={() => void signInWithOAuth('google')}
        >
          Continuar com Google
        </button>

        <button
          type="button"
          disabled={submitting}
          onClick={() => void signInWithOAuth('azure')}
        >
          Continuar com Microsoft
        </button>

        <button
          type="button"
          disabled={submitting}
          onClick={handleResetPassword}
        >
          Esqueci minha senha
        </button>

        {message && <p>{message}</p>}

        <footer style={{ marginTop: 32 }}>
          <small>
            Ao utilizar o Mugô One, você reconhece nossos
            Termos de Uso e nossa Política de Privacidade.
          </small>
        </footer>
      </section>
    </main>
  )
}
