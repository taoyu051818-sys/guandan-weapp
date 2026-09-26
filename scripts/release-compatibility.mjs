import assert from 'node:assert/strict'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

// Major contract versions, not feature-open switches. Bump on incompatible changes.
export const requiredContracts = Object.freeze({ lobbyServices: 1, messages: 1, feedback: 1 })

export function validateApiBase (value, allowLoopback = false) {
  const url = new URL(value)
  assert.ok(!url.username && !url.password && !url.search && !url.hash, 'API base must not contain credentials/query/fragment')
  assert.ok(url.protocol === 'https:' || (allowLoopback && url.protocol === 'http:' && ['127.0.0.1', '[::1]'].includes(url.hostname)), 'HTTPS API required (loopback only for explicit tests)')
  return url.href.replace(/\/$/, '')
}

export async function verifyCompatibility (base, { fetcher = fetch, allowLoopback = false } = {}) {
  base = validateApiBase(base, allowLoopback)
  const checks = []
  const get = async path => {
    const response = await fetcher(`${base}${path}`, { method: 'GET', redirect: 'error', signal: AbortSignal.timeout(8000), headers: { accept: 'application/json' } })
    assert.equal(response.status, 200, `Server compatibility failed: ${path} HTTP ${response.status}; deploy compatible server before client upload`)
    assert.match(response.headers.get('content-type') || '', /application\/json/i, `Expected JSON: ${path}`)
    const body = await response.json()
    assert.equal(body?.ok, true, `API rejected: ${path}`)
    checks.push(path)
    return body.data
  }
  const capabilities = await get('/api/v1/capabilities')
  for (const [name, version] of Object.entries(requiredContracts)) assert.equal(capabilities?.contracts?.[name], version, `Incompatible contract: ${name}`)
  for (const id of Object.keys(requiredContracts).filter(id => id !== 'lobbyServices').concat('membership')) {
    const notice = await get(`/api/v1/lobby/services/${id}`)
    assert.ok(notice?.id === id && ['open', 'closed', 'maintenance'].includes(notice.status) &&
      typeof notice.title === 'string' && notice.title.trim() && notice.title.length <= 40 &&
      typeof notice.detail === 'string' && notice.detail.length <= 300 &&
      Number.isSafeInteger(notice.version) && notice.version > 0 &&
      Number.isSafeInteger(notice.updatedAt) && notice.updatedAt >= 0, `Invalid service contract: ${id}`)
  }
  return { checkedAt: new Date().toISOString(), apiBase: base, contracts: capabilities.contracts, checks }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  assert.equal(process.argv.length, 3, 'Usage: release-compatibility.mjs HTTPS_API_BASE (without /api/v1)')
  console.log(JSON.stringify(await verifyCompatibility(process.argv[2]), null, 2))
}
