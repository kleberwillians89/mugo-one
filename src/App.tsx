import {
  BrowserRouter,
  Navigate,
  Route,
  Routes,
} from 'react-router-dom'

import { AuthProvider } from './core/auth/AuthProvider'
import { LoginPage } from './core/auth/LoginPage'
import { SignUpPage } from './core/auth/SignUpPage'
import { RequireAuth } from './core/auth/RequireAuth'

import { OrganizationProvider } from './core/organizations/OrganizationProvider'
import { OrganizationOnboardingPage } from './core/organizations/OrganizationOnboardingPage'
import { useOrganization } from './core/organizations/useOrganization'

import { DashboardPage } from './modules/dashboard/DashboardPage'

function AuthCallback() {
  return <Navigate to="/" replace />
}

function ProtectedDashboard() {
  const { organizations, loading } = useOrganization()

  if (loading) {
    return <div>Carregando empresa...</div>
  }

  if (organizations.length === 0) {
    return <Navigate to="/onboarding" replace />
  }

  return <DashboardPage />
}

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <OrganizationProvider>
          <Routes>
            <Route
              path="/login"
              element={<LoginPage />}
            />

            <Route
              path="/cadastro"
              element={<SignUpPage />}
            />

            <Route
              path="/auth/callback"
              element={<AuthCallback />}
            />

            <Route
              path="/onboarding"
              element={
                <RequireAuth>
                  <OrganizationOnboardingPage />
                </RequireAuth>
              }
            />

            <Route
              path="/"
              element={
                <RequireAuth>
                  <ProtectedDashboard />
                </RequireAuth>
              }
            />

            <Route
              path="*"
              element={<Navigate to="/" replace />}
            />
          </Routes>
        </OrganizationProvider>
      </AuthProvider>
    </BrowserRouter>
  )
}