import { useAuth } from '../../core/auth/useAuth'

export function DashboardPage() {
  const { user, signOut } = useAuth()

  return (
    <main style={{ padding: 40 }}>
      <p>MUGÔ ONE</p>

      <h1>Visão Geral</h1>

      <p>
        Autenticado como: {user?.email}
      </p>

      <button
        type="button"
        onClick={() => void signOut()}
      >
        Sair
      </button>
    </main>
  )
}
