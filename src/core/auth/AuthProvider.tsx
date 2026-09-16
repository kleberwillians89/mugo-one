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

type OAuthProvider = 'google' | 'azure'

type AuthContextValue = {
  user: User | null
  session: Session | null
  loading: boolean

  signInWithPassword: (
    email: string,
    password: string,
  ) => Promise<{ error: string | null }>

  signInWithMagicLink: (
    email: string,
  ) => Promise<{ error: string | null }>

  signInWithOAuth: (
    provider: OAuthProvider,
  ) => Promise<{ error: string | null }>

  resetPassword: (
    email: string,
  ) => Promise<{ error: string | null }>

  signOut: () => Promise<void>
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

    const loadSession = async () => {
      const {
        data: { session },
      } = await supabase.auth.getSession()

      if (mounted) {
        setSession(session)
        setLoading(false)
      }
    }

    void loadSession()

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession)
      setLoading(false)
    })

    return () => {
      mounted = false
      subscription.unsubscribe()
    }
  }, [])

  const signInWithPassword = useCallback(
    async (email: string, password: string) => {
      const { error } = await supabase.auth.signInWithPassword({
        email: email.trim().toLowerCase(),
        password,
      })

      return {
        error: error?.message ?? null,
      }
    },
    [],
  )

  const signInWithMagicLink = useCallback(async (email: string) => {
    const { error } = await supabase.auth.signInWithOtp({
      email: email.trim().toLowerCase(),
      options: {
        emailRedirectTo: `${window.location.origin}/auth/callback`,
      },
    })

    return {
      error: error?.message ?? null,
    }
  }, [])

  const signInWithOAuth = useCallback(
    async (provider: OAuthProvider) => {
      const { error } = await supabase.auth.signInWithOAuth({
        provider,
        options: {
          redirectTo: `${window.location.origin}/auth/callback`,
        },
      })

      return {
        error: error?.message ?? null,
      }
    },
    [],
  )

  const resetPassword = useCallback(async (email: string) => {
    const { error } = await supabase.auth.resetPasswordForEmail(
      email.trim().toLowerCase(),
      {
        redirectTo: `${window.location.origin}/auth/reset-password`,
      },
    )

    return {
      error: error?.message ?? null,
    }
  }, [])

  const signOut = useCallback(async () => {
    await supabase.auth.signOut()
  }, [])

  const value = useMemo<AuthContextValue>(
    () => ({
      user: session?.user ?? null,
      session,
      loading,
      signInWithPassword,
      signInWithMagicLink,
      signInWithOAuth,
      resetPassword,
      signOut,
    }),
    [
      session,
      loading,
      signInWithPassword,
      signInWithMagicLink,
      signInWithOAuth,
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
