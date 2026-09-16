import { useState, type FormEvent } from 'react'
import { Link, Navigate } from 'react-router-dom'
import { useAuth } from './useAuth'

export function SignUpPage() {
  const { user, loading, signUp } = useAuth()

  const [fullName, setFullName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [message, setMessage] = useState('')
  const [submitting, setSubmitting] = useState(false)

  if (loading) {
    return <div>Carregando...</div>
  }

  if (user) {
    return <Navigate to="/" replace />
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    setMessage('')

    if (password.length < 8) {
      setMessage('A senha precisa ter pelo menos 8 caracteres.')
      return
    }

    if (password !== confirmPassword) {
      setMessage('As senhas não coincidem.')
      return
    }

    setSubmitting(true)

    const result = await signUp(
      fullName,
      email,
      password,
    )

    setSubmitting(false)

    if (result.error) {
      setMessage(result.error)
      return
    }

    if (result.needsConfirmation) {
      setMessage(
        'Conta criada. Confira seu e-mail para confirmar o cadastro.',
      )
      return
    }

    setMessage('Conta criada com sucesso.')
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
        <p>MUGÔ ONE</p>

        <h1>Crie sua conta</h1>

        <form onSubmit={handleSubmit}>
          <label>
            Nome
            <input
              value={fullName}
              required
              autoComplete="name"
              onChange={(event) =>
                setFullName(event.target.value)
              }
            />
          </label>

          <label>
            E-mail
            <input
              type="email"
              value={email}
              required
              autoComplete="email"
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
              required
              minLength={8}
              autoComplete="new-password"
              onChange={(event) =>
                setPassword(event.target.value)
              }
            />
          </label>

          <label>
            Confirmar senha
            <input
              type="password"
              value={confirmPassword}
              required
              minLength={8}
              autoComplete="new-password"
              onChange={(event) =>
                setConfirmPassword(event.target.value)
              }
            />
          </label>

          <button type="submit" disabled={submitting}>
            Criar conta
          </button>
        </form>

        {message && <p>{message}</p>}

        <p>
          Já possui uma conta?{' '}
          <Link to="/login">Entrar</Link>
        </p>

        <small>
          Ao criar sua conta, você declara ter lido os Termos
          de Uso e a Política de Privacidade do Mugô One.
        </small>
      </section>
    </main>
  )
}