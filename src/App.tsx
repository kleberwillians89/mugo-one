import {
  BrowserRouter,
  Navigate,
  Route,
  Routes,
} from 'react-router-dom'

import { AuthProvider } from './core/auth/AuthProvider'
import { LoginPage } from './core/auth/LoginPage'
import { RequireAuth } from './core/auth/RequireAuth'
import { DashboardPage } from './modules/dashboard/DashboardPage'

function AuthCallback() {
  return <Navigate to="/" replace />
}

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <Routes>
          <Route
            path="/login"
            element={<LoginPage />}
          />

          <Route
            path="/auth/callback"
            element={<AuthCallback />}
          />

          <Route
            path="/"
            element={
              <RequireAuth>
                <DashboardPage />
              </RequireAuth>
            }
          />

          <Route
            path="*"
            element={<Navigate to="/" replace />}
          />
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  )
}
