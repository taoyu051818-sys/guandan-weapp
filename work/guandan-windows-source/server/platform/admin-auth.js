import { createHash, randomBytes } from 'node:crypto'
import { PlatformError, forbidden, unauthorized } from './errors.js'
import { matchingTotpStep, safeEqual, verifyAdminPassword } from './admin-credentials.js'
import { isLoopback } from './admin-config.js'

const digest = value => createHash('sha256').update(value).digest('hex')
const limited = () => new PlatformError(429, 'ADMIN_RATE_LIMITED', '登录尝试过于频繁，请稍后重试')

// Bounded, fail-closed rate table. Proxy-supplied address headers are intentionally ignored.
export class BoundedRateLimiter {
  constructor ({ now = () => Date.now(), windowMs = 15 * 60_000, limit = 10, capacity = 10_000 } = {}) {
    Object.assign(this, { now, windowMs, limit, capacity })
    this.entries = new Map()
  }
  consume (key) {
    const now = this.now()
    for (const [id, entry] of this.entries) if (entry.expiresAt <= now) this.entries.delete(id)
    let entry = this.entries.get(key)
    if (!entry) {
      if (this.entries.size >= this.capacity) throw limited()
      entry = { count: 0, expiresAt: now + this.windowMs }
      this.entries.set(key, entry)
    }
    entry.count += 1
    if (entry.count > this.limit) throw limited()
  }
}

export class AdminAuth {
  constructor ({ credentials, config, store, now = () => Date.now() }) {
    Object.assign(this, { credentials, config, store, now })
    this.sessions = new Map()
    this.limiter = new BoundedRateLimiter({ now })
    this.activeLogins = 0
    this.cookieName = config.insecureLocalhost ? 'guandan_admin_dev' : '__Host-guandan_admin'
  }

  assertOrigin (request) {
    if (request.headers.origin !== this.config.origin || (this.config.insecureLocalhost && !isLoopback(request.socket.remoteAddress))) throw forbidden('管理请求来源不匹配')
  }

  cookie (token = '', maxAge = Math.floor(this.config.ttlMs / 1000)) {
    return `${this.cookieName}=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${this.config.insecureLocalhost ? '' : '; Secure'}`
  }

  cleanup () {
    for (const [token, session] of this.sessions) if (session.expiresAt <= this.now()) this.sessions.delete(token)
  }

  loginOptions () {
    return { totpRequired: this.config.passwordOnlyLocalhost !== true }
  }

  async login (request, body) {
    this.assertOrigin(request)
    const username = typeof body.username === 'string' ? body.username : ''
    this.limiter.consume(`ip:${request.socket.remoteAddress || 'unknown'}`)
    this.limiter.consume(`name:${digest(username.slice(0, 64))}`)
    if (this.activeLogins >= 4) throw limited()
    this.activeLogins += 1
    try {
      const admin = this.credentials.find(candidate => candidate.username === username && !candidate.disabled)
      const password = typeof body.password === 'string' && body.password.length <= 256 ? body.password : ''
      const passwordValid = await verifyAdminPassword(password, (admin || this.credentials[0]).passwordHash)
      const { totpRequired } = this.loginOptions()
      const step = totpRequired ? matchingTotpStep((admin || this.credentials[0]).totpSecret, body.totp, this.now()) : null
      if (!admin || !passwordValid || (totpRequired && step === null)) throw unauthorized('管理员凭证无效')
      // Shared platform transaction prevents simultaneous logins reusing a code; only counter metadata persists.
      if (totpRequired) await this.store.transaction(state => {
        state.adminSecurity ||= { lastTotpSteps: {} }
        state.adminSecurity.lastTotpSteps ||= {}
        const actorKey = digest(admin.id)
        if ((state.adminSecurity.lastTotpSteps[actorKey] ?? -1) >= step) throw unauthorized('管理员凭证无效')
        state.adminSecurity.lastTotpSteps[actorKey] = step
      })
      this.cleanup()
      if (this.sessions.size >= 10_000) throw limited()
      const owned = [...this.sessions.entries()].filter(([, session]) => session.admin.id === admin.id)
      if (owned.length >= 5) this.sessions.delete(owned[0][0])
      const token = randomBytes(32).toString('base64url')
      const session = { admin: { id: admin.id, role: admin.role }, csrfToken: randomBytes(32).toString('base64url'), expiresAt: this.now() + this.config.ttlMs }
      this.sessions.set(digest(token), session)
      return { token, session }
    } finally { this.activeLogins -= 1 }
  }

  session (request, { write = false, roles } = {}) {
    this.cleanup()
    if (this.config.insecureLocalhost && !isLoopback(request.socket.remoteAddress)) throw forbidden()
    const cookies = String(request.headers.cookie || '').split(';').map(item => item.trim()).filter(item => item.startsWith(`${this.cookieName}=`))
    const token = cookies.length === 1 ? cookies[0].slice(this.cookieName.length + 1) : ''
    const session = /^[A-Za-z0-9_-]{43}$/.test(token) ? this.sessions.get(digest(token)) : null
    if (!session) throw unauthorized('请先登录管理后台')
    if (write) {
      this.assertOrigin(request)
      if (!safeEqual(request.headers['x-csrf-token'], session.csrfToken)) throw forbidden('CSRF 校验失败')
    }
    if (roles && !roles.includes(session.admin.role)) throw forbidden()
    return { ...session, key: digest(token) }
  }

  logout (request) {
    const session = this.session(request, { write: true })
    this.sessions.delete(session.key)
  }
}
