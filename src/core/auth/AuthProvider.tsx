import {
  createContext,
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import type { Session, User } from '@supabase/supabase-js'
import { supabase } from '../../shared/lib/supabase'

type AuthContextValue = {
  user: User | null
  session: Session | null
  loading: boolean

  signUp: (
    fullName: string,
    email: string,
    password: string,
  ) => Promise<{
    error: string | null
    needsConfirmation: boolean
  }>

  signInWithPassword: (
    email: string,
    password: string,
  ) => Promise<{
    error: string | null
  }>

  signInWithMagicLink: (
    email: string,
  ) => Promise<{
    error: string | null
  }>

  resetPassword: (
    email: string,
  ) => Promise<{
    error: string | null
  }>

  signOut: () => Promise<{
    error: string | null
  }>
}

export const AuthContext = createContext<AuthContextValue | undefined>(
  undefined,
)

type AuthProviderProps = {
  children: ReactNode
}

export function AuthProvider({ children }: AuthProviderProps) {
  const [session, setSession] = useState<Session | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let mounted = true

    async function loadSession() {
      const {
        data: { session },
        error,
      } = await supabase.auth.getSession()

      if (error) {
        console.error(
          'Erro ao carregar sessão:',
          error.message,
        )
      }

      if (mounted) {
        setSession(session)
        setLoading(false)
      }
    }

    void loadSession()

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange(
      (_event, nextSession) => {
        if (!mounted) {
          return
        }

        setSession(nextSession)
        setLoading(false)
      },
    )

    return () => {
      mounted = false
      subscription.unsubscribe()
    }
  }, [])

  const signUp = useCallback(
    async (
      fullName: string,
      email: string,
      password: string,
    ) => {
      const { data, error } = await supabase.auth.signUp({
        email: email.trim().toLowerCase(),
        password,
        options: {
          emailRedirectTo: `${window.location.origin}/auth/callback`,
          data: {
            full_name: fullName.trim(),
          },
        },
      })

      return {
        error: error?.message ?? null,
        needsConfirmation: !data.session,
      }
    },
    [],
  )

  const signInWithPassword = useCallback(
    async (
      email: string,
      password: string,
    ) => {
      const { error } =
        await supabase.auth.signInWithPassword({
          email: email.trim().toLowerCase(),
          password,
        })

      return {
        error: error?.message ?? null,
      }
    },
    [],
  )

  const signInWithMagicLink = useCallback(
    async (email: string) => {
      const { error } = await supabase.auth.signInWithOtp({
        email: email.trim().toLowerCase(),
        options: {
          emailRedirectTo: `${window.location.origin}/auth/callback`,
        },
      })

      return {
        error: error?.message ?? null,
      }
    },
    [],
  )

  const resetPassword = useCallback(
    async (email: string) => {
      const { error } =
        await supabase.auth.resetPasswordForEmail(
          email.trim().toLowerCase(),
          {
            redirectTo: `${window.location.origin}/auth/reset-password`,
          },
        )

      return {
        error: error?.message ?? null,
      }
    },
    [],
  )

  const signOut = useCallback(async () => {
    const { error } = await supabase.auth.signOut()

    if (error) {
      console.error(
        'Erro ao encerrar sessão:',
        error.message,
      )
    }

    return {
      error: error?.message ?? null,
    }
  }, [])

  const value = useMemo<AuthContextValue>(
    () => ({
      user: session?.user ?? null,
      session,
      loading,
      signUp,
      signInWithPassword,
      signInWithMagicLink,
      resetPassword,
      signOut,
    }),
    [
      session,
      loading,
      signUp,
      signInWithPassword,
      signInWithMagicLink,
      resetPassword,
      signOut,
    ],
  )

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  )
}