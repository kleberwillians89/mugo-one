type AdminClient = {
  rpc: (name: string, args: Record<string, unknown>) => PromiseLike<{ data: unknown; error: unknown }>
}

const encoder = new TextEncoder()

function requestAddress(req: Request) {
  const forwarded = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
  return req.headers.get('cf-connecting-ip')?.trim()
    || forwarded
    || req.headers.get('x-real-ip')?.trim()
    || 'unknown'
}

async function hmacHex(secret: string, value: string) {
  const key = await crypto.subtle.importKey(
    'raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
  )
  const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(value))
  return [...new Uint8Array(signature)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

export async function publicRateLimit(options: {
  admin: AdminClient
  req: Request
  serviceRoleKey: string
  scope: string
  identifier?: string
  includeAddress?: boolean
  limit: number
  windowSeconds: number
}) {
  const normalizedIdentifier = String(options.identifier ?? '').trim().toLowerCase().slice(0, 320)
  const address = options.includeAddress === false ? '' : requestAddress(options.req)
  const rawKey = `${options.scope}|${address}|${normalizedIdentifier}`
  const keyHash = await hmacHex(options.serviceRoleKey, rawKey)
  const { data, error } = await options.admin.rpc('consume_public_endpoint_rate_limit', {
    p_scope: options.scope,
    p_key_hash: keyHash,
    p_limit: options.limit,
    p_window_seconds: options.windowSeconds,
  })
  if (error) throw new Error('rate_limit_unavailable')
  return data === true
}
