const supabaseUrl = import.meta.env.VITE_SUPABASE_URL?.trim()
const supabasePublishableKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY?.trim()
const customerMfaRequired = import.meta.env.VITE_CUSTOMER_MFA_REQUIRED?.trim().toLowerCase() === 'true'

export const publicEnv = {
  supabaseUrl,
  supabasePublishableKey,
  customerMfaRequired,
  isDevelopment: import.meta.env.DEV,
  isConfigured: Boolean(supabaseUrl && supabasePublishableKey),
} as const
