import { resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

export const adminStaticRoot = fileURLToPath(new URL('../../../guandan-admin/', import.meta.url)).replace(/[\\/]$/, '')
export const assertPrivateAdminLocation = file => {
  if (file === adminStaticRoot || file.startsWith(`${adminStaticRoot}${sep}`)) throw new Error('Admin credentials must be outside the admin static directory')
}

export const isLoopback = value => ['localhost', '127.0.0.1', '::1', '[::1]', '::ffff:127.0.0.1'].includes(value)

export function loadAdminConfig (env = process.env) {
  const credentialsFile = String(env.ADMIN_CREDENTIALS_FILE || '').trim()
  const originValue = String(env.ADMIN_ORIGIN || '').trim()
  if (!credentialsFile) {
    if (originValue || env.ADMIN_ALLOW_INSECURE_LOCALHOST || env.ADMIN_SESSION_TTL_MS || env.ADMIN_ALLOW_PASSWORD_ONLY_LOCALHOST) throw new Error('Admin settings require ADMIN_CREDENTIALS_FILE; omit all settings to disable admin')
    return null
  }
  let origin
  try { origin = new URL(originValue) } catch { throw new Error('ADMIN_ORIGIN must be an exact HTTP(S) origin') }
  if (!['https:', 'http:'].includes(origin.protocol) || origin.username || origin.password || origin.pathname !== '/' || origin.search || origin.hash || origin.origin !== originValue) {
    throw new Error('ADMIN_ORIGIN must be an exact HTTP(S) origin without a trailing slash')
  }
  const insecureLocalhost = env.ADMIN_ALLOW_INSECURE_LOCALHOST === 'true'
  if (insecureLocalhost && (env.NODE_ENV === 'production' || !isLoopback(origin.hostname) || !isLoopback(env.PLATFORM_HOST || '127.0.0.1'))) {
    throw new Error('ADMIN_ALLOW_INSECURE_LOCALHOST requires non-production loopback origin and bind host')
  }
  if (origin.protocol !== 'https:' && !insecureLocalhost) throw new Error('ADMIN_ORIGIN requires HTTPS (or explicit insecure localhost development mode)')
  const passwordOnlyLocalhost = env.ADMIN_ALLOW_PASSWORD_ONLY_LOCALHOST === 'true'
  if (passwordOnlyLocalhost && !insecureLocalhost) throw new Error('Password-only testing requires explicit non-production loopback mode')
  const ttlMs = Number(env.ADMIN_SESSION_TTL_MS || 8 * 60 * 60_000)
  if (!Number.isSafeInteger(ttlMs) || ttlMs < 5 * 60_000 || ttlMs > 12 * 60 * 60_000) throw new Error('ADMIN_SESSION_TTL_MS must be 300000–43200000')
  const file = resolve(credentialsFile)
  assertPrivateAdminLocation(file)
  if (env.PLATFORM_JSON_FILE && file === resolve(env.PLATFORM_JSON_FILE)) throw new Error('Admin credentials and platform data require separate files')
  return { credentialsFile: file, origin: origin.origin, insecureLocalhost, passwordOnlyLocalhost, ttlMs }
}
