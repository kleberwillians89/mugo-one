import { performance } from 'node:perf_hooks'

const percentile = (values, fraction) => {
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * fraction) - 1)]
}

const resolve = (organization, email, phone, clients) => {
  const eligible = clients.filter((client) =>
    client.organization === organization &&
    client.status === 'active' &&
    client.deletedAt === null &&
    client.mergedIntoId === null,
  )
  const emailIds = eligible.filter((client) => client.email === email).map((client) => client.id)
  const phoneIds = eligible.filter((client) => client.whatsapp === phone).map((client) => client.id)
  if (emailIds.length > 1 || phoneIds.length > 1 ||
      (emailIds.length === 1 && phoneIds.length === 1 && emailIds[0] !== phoneIds[0])) {
    return 'review_required'
  }
  return emailIds[0] ?? phoneIds[0] ?? 'new_client'
}

const benchmark = (volume) => {
  const clients = Array.from({ length: volume }, (_, index) => ({
    id: `client-${index}`,
    organization: index % 2 === 0 ? 'org-a' : 'org-b',
    email: `customer-${index}@qa.test`,
    whatsapp: `55${String(index).padStart(11, '0')}`,
    status: 'active',
    deletedAt: null,
    mergedIntoId: null,
  }))
  const latencies = []
  const results = []
  for (const client of clients) {
    const started = performance.now()
    results.push(resolve(client.organization, client.email, client.whatsapp, clients))
    latencies.push(performance.now() - started)
  }
  const duplicates = results.length - new Set(results).size
  return {
    requests: volume,
    p50_ms: Number(percentile(latencies, 0.5).toFixed(4)),
    p95_ms: Number(percentile(latencies, 0.95).toFixed(4)),
    errors: results.filter((result) => result === 'review_required').length,
    timeouts: 0,
    duplicate_links: duplicates,
    deadlocks: 0,
  }
}

console.log(JSON.stringify({
  kind: 'synthetic_in_process_identity_resolution',
  warning: 'This does not measure PostgreSQL locks, index scans, network latency, or database deadlocks.',
  runs: [10, 50, 100].map(benchmark),
}, null, 2))
