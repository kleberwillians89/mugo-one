const allowedOrigins = new Set([
  'https://crm.ruahparfums.com.br',
  'https://crmruahparfums.vercel.app',
  'http://localhost:5173',
])

export const corsHeaders = (req: Request) => {
  const origin = req.headers.get('origin') ?? ''
  return {
    ...(allowedOrigins.has(origin) ? { 'access-control-allow-origin': origin } : {}),
    'access-control-allow-methods': 'POST, OPTIONS',
    'access-control-allow-headers': 'authorization, apikey, content-type, x-client-info',
    'access-control-max-age': '86400',
    vary: 'Origin',
  }
}

export const json = (body: unknown, status = 200, req?: Request) => new Response(JSON.stringify(body), {
  status,
  headers: { 'content-type': 'application/json', ...(req ? corsHeaders(req) : {}) },
})
