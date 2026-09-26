import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { request as httpRequest } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createPlatformRuntime } from '../platform-server.js'
import { createAdminCredential, totpAtStep } from './admin-credentials.js'

const directory = await mkdtemp(join(tmpdir(), 'guandan-admin-http-'))
const password = 'test-only-admin-http-password-2026'
const origin = 'http://localhost:3003'
const baseEnv = { NODE_ENV: 'test', PLATFORM_ENABLE_DEV_LOGIN: 'true' }
const logger = { error () {} }
const listen = async runtime => {
  await new Promise(resolve => runtime.server.listen(0, '127.0.0.1', resolve))
  return `http://127.0.0.1:${runtime.server.address().port}`
}
const close = runtime => new Promise(resolve => { runtime.server.closeAllConnections(); runtime.server.close(resolve) })
const call = async (base, path, { method = 'GET', body, token, session, headers = {} } = {}) => {
  const response = await fetch(`${base}${path}`, { method, headers: {
    ...(body === undefined ? {} : { 'content-type': 'application/json' }),
    ...(token ? { authorization: `Bearer ${token}` } : {}),
    ...(session ? { cookie: session.cookie, origin, 'x-csrf-token': session.csrfToken } : {}),
    ...headers,
  }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) })
  return { status: response.status, payload: await response.json(), headers: response.headers }
}
const credentials = await Promise.all(['admin', 'operator', 'support'].map(role => createAdminCredential({ username: `${role}.test`, password, role })))
const file = join(directory, 'admins.json')
await writeFile(file, JSON.stringify({ schemaVersion: 1, admins: credentials }), { mode: 0o600 })
const env = { ...baseEnv, ADMIN_CREDENTIALS_FILE: file, ADMIN_ORIGIN: origin, ADMIN_ALLOW_INSECURE_LOCALHOST: 'true', PLATFORM_STORE_MODE: 'json-single-instance', PLATFORM_JSON_FILE: join(directory, 'platform.json') }
let runtime
try {
  runtime = await createPlatformRuntime({ env: baseEnv, logger })
  let base = await listen(runtime)
  for (const path of ['/admin/', '/api/v1/admin/session', '/api/v1/admin/features', '/api/v1/admin/login-options']) assert.equal((await call(base, path)).status, 404)
  const noAdminPlayer = (await call(base, '/api/v1/auth/dev-login', { method: 'POST', body: { deviceId: 'no-admin' } })).payload.data
  assert.equal((await call(base, '/api/v1/messages', { token: noAdminPlayer.accessToken })).status, 200, 'player operations available when admin disabled')
  await close(runtime)

  runtime = await createPlatformRuntime({ env, logger })
  base = await listen(runtime)
  assert.deepEqual((await call(base, '/api/v1/admin/login-options')).payload.data, { totpRequired: true })
  assert.equal((await call(base, '/api/v1/admin/session', { method: 'POST', headers: { origin }, body: { username: credentials[0].username, password, totpRequired: false } })).status, 401, 'browser cannot opt out of required TOTP')
  let now = 1_800_000_000_000
  runtime.adminAuth.now = () => now
  runtime.adminAuth.limiter.now = () => now
  const adminBody = index => ({ username: credentials[index].username, password, totp: totpAtStep(credentials[index].totpSecret, Math.floor(now / 30_000)) })
  const login = async index => {
    const result = await call(base, '/api/v1/admin/session', { method: 'POST', headers: { origin }, body: adminBody(index) })
    assert.equal(result.status, 200)
    assert.equal(result.headers.get('access-control-allow-origin'), null, 'admin endpoints must not inherit player wildcard CORS')
    return { cookie: result.headers.get('set-cookie').split(';')[0], ...result.payload.data }
  }
  const player = (await call(base, '/api/v1/auth/dev-login', { method: 'POST', body: { deviceId: 'alice' } })).payload.data
  const secondPlayer = (await call(base, '/api/v1/auth/dev-login', { method: 'POST', body: { deviceId: 'bob' } })).payload.data
  assert.equal((await call(base, '/api/v1/admin/features', { token: player.accessToken })).status, 401)
  assert.equal((await call(base, '/api/v1/admin/session', { method: 'POST', body: adminBody(0) })).status, 403)
  assert.equal((await call(base, '/api/v1/admin/session', { method: 'POST', headers: { origin: 'https://evil.test' }, body: adminBody(0) })).status, 403)
  assert.equal((await call(base, '/api/v1/admin/session', { method: 'POST', headers: { origin }, body: { ...adminBody(0), password: 'wrong' } })).status, 401)
  assert.equal((await call(base, '/api/v1/admin/session', { method: 'POST', headers: { origin }, body: { ...adminBody(0), totp: 'invalid' } })).status, 401)
  const admin = await login(0), operator = await login(1), support = await login(2)
  assert.equal((await call(base, '/api/v1/admin/session', { session: admin })).payload.data.admin.role, 'admin')
  assert.equal((await call(base, '/api/v1/admin/session', { method: 'POST', headers: { origin }, body: adminBody(0) })).status, 401, 'TOTP replay rejected')
  assert.equal((await call(base, '/api/v1/admin/audit', { session: operator })).status, 403)
  assert.equal((await call(base, '/api/v1/admin/features', { session: support })).status, 403)
  assert.equal((await call(base, '/api/v1/admin/announcements', { method: 'POST', session: support, body: { title: 'x', content: 'y' } })).status, 403)
  for (const headers of [{ 'x-csrf-token': '' }, { 'x-csrf-token': 'forged' }, { origin: 'https://evil.test' }, { origin: '' }]) {
    assert.equal((await call(base, '/api/v1/admin/announcements', { method: 'POST', session: admin, headers, body: { title: 'x', content: 'y' } })).status, 403)
  }
  assert.equal((await call(base, '/api/v1/messages', { session: admin })).status, 401, 'admin cookie does not become a player token')
  const created = await call(base, '/api/v1/admin/announcements', { method: 'POST', session: operator, body: { title: '<b>plain title</b>', content: '<script>alert(1)</script>', startsAt: null, endsAt: null } })
  assert.equal(created.status, 200)
  const announcement = created.payload.data.announcement
  assert.equal((await call(base, '/api/v1/messages', { token: player.accessToken })).payload.data.total, 0, 'draft hidden')
  const publishBody = { version: announcement.version, title: announcement.title, content: announcement.content, startsAt: null, endsAt: null, status: 'published' }
  assert.equal((await call(base, `/api/v1/admin/announcements/${announcement.id}`, { method: 'PATCH', session: admin, body: publishBody })).status, 200)
  assert.equal((await call(base, `/api/v1/admin/announcements/${announcement.id}`, { method: 'PATCH', session: admin, body: publishBody })).status, 409, 'optimistic version conflict')
  const messages = await call(base, '/api/v1/messages', { token: player.accessToken })
  assert.equal(messages.payload.data.total, 1)
  assert.equal(messages.payload.data.items[0].content, '<script>alert(1)</script>', 'plain text data preserved')
  assert.equal((await call(base, `/api/v1/messages/${encodeURIComponent(messages.payload.data.items[0].id)}/read`, { method: 'POST', token: player.accessToken })).status, 200)
  assert.equal((await call(base, '/api/v1/messages', { token: player.accessToken })).payload.data.unreadCount, 0)
  assert.equal((await call(base, '/api/v1/messages', { token: secondPlayer.accessToken })).payload.data.unreadCount, 1)

  assert.equal((await call(base, '/api/v1/feedback', { method: 'POST', token: player.accessToken, body: { category: 'bug', content: 'problem' } })).status, 400)
  assert.equal((await call(base, '/api/v1/feedback', { method: 'POST', token: player.accessToken, headers: { 'idempotency-key': 'spoof' }, body: { userId: secondPlayer.user.id, category: 'bug', content: 'problem' } })).status, 400)
  const feedbackOptions = { method: 'POST', token: player.accessToken, headers: { 'idempotency-key': 'feedback-1' }, body: { category: 'bug', content: 'problem' } }
  const feedback = (await call(base, '/api/v1/feedback', feedbackOptions)).payload.data.feedback
  assert.equal((await call(base, '/api/v1/feedback', feedbackOptions)).payload.data.feedback.id, feedback.id)
  assert.equal((await call(base, '/api/v1/feedback', { token: secondPlayer.accessToken })).payload.data.total, 0, 'feedback isolation')
  const replied = await call(base, `/api/v1/admin/feedback/${feedback.id}/replies`, { method: 'POST', session: support, body: { version: feedback.version, content: 'We are investigating.' } })
  assert.equal(replied.status, 200)
  assert.equal((await call(base, '/api/v1/messages', { token: player.accessToken })).payload.data.total, 2)
  assert.equal((await call(base, '/api/v1/messages', { token: secondPlayer.accessToken })).payload.data.total, 1)
  const mine = (await call(base, '/api/v1/feedback', { token: player.accessToken })).payload.data.items[0]
  assert.ok(!JSON.stringify(mine).includes(support.admin.id), 'admin identity is audit-only')
  assert.equal((await call(base, `/api/v1/admin/feedback/${feedback.id}`, { method: 'PATCH', session: support, body: { version: replied.payload.data.feedback.version, status: 'resolved' } })).status, 200)
  const feature = (await call(base, '/api/v1/admin/features', { session: operator })).payload.data.items.find(item => item.id === 'feedback')
  assert.equal((await call(base, '/api/v1/admin/features/feedback', { method: 'PATCH', session: admin, body: { ...feature, updatedAt: undefined, id: undefined, status: 'maintenance' } })).status, 200)
  assert.equal((await call(base, '/api/v1/feedback', { token: player.accessToken })).status, 503)
  assert.equal((await call(base, '/api/v1/lobby/services/feedback')).payload.data.status, 'maintenance')
  assert.equal((await call(base, '/api/v1/admin/features/membership', { method: 'PATCH', session: admin, body: { version: 1, status: 'open', title: '会员', detail: '' } })).status, 400)
  const audit = await call(base, '/api/v1/admin/audit', { session: admin })
  assert.ok(audit.payload.data.items.length >= 5)
  assert.ok(!JSON.stringify(audit.payload).includes(password))
  assert.equal((await call(base, '/api/v1/admin/feedback?pageSize=999', { session: support })).status, 400)
  assert.equal((await call(base, '/api/v1/admin/announcements', { method: 'POST', session: admin, body: { title: 'x', content: 'x'.repeat(20_000) } })).status, 413)
  for (const body of [null, [], 7, 'text', { title: ['invalid'], content: 'x' }, { title: 'x', content: 'y', actor: { id: 'forged', role: 'admin' } }, { title: 'x', content: 'y', startsAt: 'now' }]) {
    assert.equal((await call(base, '/api/v1/admin/announcements', { method: 'POST', session: admin, body })).status, 400, `malformed announcement: ${JSON.stringify(body)}`)
  }
  assert.equal((await call(base, '/api/v1/admin/announcements/%ZZ', { method: 'PATCH', session: admin, body: publishBody })).status, 400)
  assert.equal((await call(base, '/api/v1/admin/announcements', { method: 'POST', session: admin, headers: { 'content-type': 'text/plain' }, body: { title: 'x', content: 'y' } })).status, 415)
  const invalidJson = await fetch(`${base}/api/v1/admin/announcements`, { method: 'POST', headers: { origin, cookie: admin.cookie, 'x-csrf-token': admin.csrfToken, 'content-type': 'application/json' }, body: '{' })
  assert.equal(invalidJson.status, 400)
  const html = await fetch(`${base}/admin/`)
  assert.equal(html.status, 200)
  assert.match(html.headers.get('content-type'), /^text\/html/)
  assert.ok(html.headers.get('content-security-policy').includes("script-src 'self'"))
  assert.ok(!html.headers.get('content-security-policy').includes('unsafe-inline'))
  assert.equal(html.headers.get('x-content-type-options'), 'nosniff')
  for (const path of ['/admin/package.json', '/admin/README.md', '/admin/.env', '/admin/src/not-approved.js', '/admin/%2e%2e/server/platform/admin-credentials.js', '/admin/src%2fapp.js']) {
    const status = await new Promise((resolve, reject) => { const req = httpRequest(`${base}`, { path }, response => { response.resume(); resolve(response.statusCode) }); req.on('error', reject); req.end() })
    assert.equal(status, 404, `static allowlist: ${path}`)
  }
  const logout = await call(base, '/api/v1/admin/logout', { method: 'POST', session: support })
  assert.equal(logout.status, 200); assert.match(logout.headers.get('set-cookie'), /Max-Age=0/)
  assert.equal((await call(base, '/api/v1/admin/feedback', { session: support })).status, 401)
  now += runtime.adminAuth.config.ttlMs
  assert.equal((await call(base, '/api/v1/admin/session', { session: admin })).status, 401)
  for (let count = 0; count < 10; count += 1) assert.equal((await call(base, '/api/v1/admin/session', { method: 'POST', headers: { origin, 'x-forwarded-for': `192.0.2.${count}` }, body: { username: `missing${count}`, password: 'wrong', totp: '000000' } })).status, 401)
  assert.equal((await call(base, '/api/v1/admin/session', { method: 'POST', headers: { origin, 'x-forwarded-for': '198.51.100.1' }, body: adminBody(0) })).status, 429, 'forged proxy headers and changing usernames cannot evade socket IP limit')
  const stored = await readFile(env.PLATFORM_JSON_FILE, 'utf8')
  assert.ok(!stored.includes(password) && !stored.includes(credentials[0].passwordHash) && !stored.includes(credentials[0].totpSecret))
  await close(runtime)
  runtime = await createPlatformRuntime({ env, logger })
  runtime.adminAuth.now = () => 1_800_000_000_000
  base = await listen(runtime)
  assert.equal((await call(base, '/api/v1/admin/session', { method: 'POST', headers: { origin }, body: { username: credentials[0].username, password, totp: totpAtStep(credentials[0].totpSecret, 60_000_000) } })).status, 401, 'TOTP replay survives JSON-store restart')
  assert.equal((await call(base, '/api/v1/admin/session', { session: operator })).status, 401, 'sessions invalidated on restart')
  await close(runtime)
  runtime = await createPlatformRuntime({ env: { ...env, ADMIN_ALLOW_PASSWORD_ONLY_LOCALHOST: 'true' }, logger })
  base = await listen(runtime)
  const options = await call(base, '/api/v1/admin/login-options')
  assert.deepEqual(options.payload.data, { totpRequired: false })
  assert.equal(options.headers.get('access-control-allow-origin'), null)
  assert.match(options.headers.get('cache-control'), /no-store/)
  const simpleBody = { username: credentials[0].username, password }
  assert.equal((await call(base, '/api/v1/admin/session', { method: 'POST', headers: { origin }, body: { ...simpleBody, password: 'wrong' } })).status, 401)
  assert.equal((await call(base, '/api/v1/admin/session', { method: 'POST', headers: { origin: 'https://evil.test' }, body: simpleBody })).status, 403)
  const simpleLogin = await call(base, '/api/v1/admin/session', { method: 'POST', headers: { origin }, body: simpleBody })
  assert.equal(simpleLogin.status, 200, 'loopback preview accepts password without TOTP')
  const simpleSession = { cookie: simpleLogin.headers.get('set-cookie').split(';')[0], ...simpleLogin.payload.data }
  assert.equal((await call(base, '/api/v1/admin/features', { session: simpleSession })).status, 200)
  assert.equal((await call(base, '/api/v1/admin/announcements', { method: 'POST', session: simpleSession, headers: { 'x-csrf-token': 'wrong' }, body: { title: 'x', content: 'y' } })).status, 403)
  assert.equal((await call(base, '/api/v1/admin/logout', { method: 'POST', session: simpleSession })).status, 200)
  assert.equal((await call(base, '/api/v1/admin/features', { session: simpleSession })).status, 401)
  for (let count = 0; count < 8; count += 1) assert.equal((await call(base, '/api/v1/admin/session', { method: 'POST', headers: { origin }, body: { ...simpleBody, password: 'wrong' } })).status, 401)
  assert.equal((await call(base, '/api/v1/admin/session', { method: 'POST', headers: { origin }, body: simpleBody })).status, 429, 'password-only preview retains login rate limit')
} finally {
  if (runtime?.server.listening) await close(runtime)
  await rm(directory, { recursive: true, force: true })
}
console.log('real HTTP admin security and player operations integration tests passed')
