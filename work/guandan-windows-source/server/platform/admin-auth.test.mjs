import assert from 'node:assert/strict'
import { chmod, mkdtemp, readFile, rm, stat, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { AdminAuth, BoundedRateLimiter } from './admin-auth.js'
import { loadAdminConfig } from './admin-config.js'
import { adminStaticRoot } from './admin-config.js'
import { createAdminCredential, hashAdminPassword, matchingTotpStep, readAdminCredentials, totpAtStep, verifyAdminPassword } from './admin-credentials.js'
import { provisionAdminFiles } from './admin-provision.mjs'
import { MemoryPlatformStore } from './storage.js'

const password = 'test-only-strong-password-2026'
const directory = await mkdtemp(join(tmpdir(), 'guandan-admin-auth-'))
try {
  for (const simple of ['abcdef', '246810', '容易记住的口令']) {
    assert.equal(await verifyAdminPassword(simple, await hashAdminPassword(simple)), true, 'six or more characters require no character-type mixture')
  }
  for (const invalid of ['', 'abcde', 'a'.repeat(257), null, 123456]) {
    await assert.rejects(() => hashAdminPassword(invalid), /6–256/)
  }
  const longest = 'a'.repeat(256)
  assert.equal(await verifyAdminPassword(longest, await hashAdminPassword(longest)), true)
  const hash = await hashAdminPassword(password)
  assert.notEqual(hash, await hashAdminPassword(password), 'independent salts')
  assert.equal(await verifyAdminPassword(password, hash), true)
  assert.equal(await verifyAdminPassword('wrong', hash), false)
  assert.equal(await verifyAdminPassword(password, 'scrypt$1$1$1$bad$bad'), false)
  assert.equal(totpAtStep('GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ', 1), '287082', 'RFC 6238 SHA-1 vector, six digits')
  assert.equal(matchingTotpStep('GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ', '287082', 59000), 1)
  assert.equal(matchingTotpStep('GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ', '287082', 150000), null)
  assert.equal(loadAdminConfig({}), null)
  const localPasswordEnv = { NODE_ENV: 'test', ADMIN_CREDENTIALS_FILE: '/tmp/private.json', ADMIN_ORIGIN: 'http://localhost:3003', ADMIN_ALLOW_INSECURE_LOCALHOST: 'true', ADMIN_ALLOW_PASSWORD_ONLY_LOCALHOST: 'true' }
  assert.equal(loadAdminConfig(localPasswordEnv).passwordOnlyLocalhost, true)
  for (const overrides of [{ NODE_ENV: 'production' }, { PLATFORM_HOST: '0.0.0.0' }, { ADMIN_ORIGIN: 'http://evil.test' }, { ADMIN_ALLOW_INSECURE_LOCALHOST: 'false', ADMIN_ORIGIN: 'https://localhost' }]) {
    assert.throws(() => loadAdminConfig({ ...localPasswordEnv, ...overrides }), /loopback/)
  }
  assert.throws(() => loadAdminConfig({ ADMIN_ALLOW_PASSWORD_ONLY_LOCALHOST: 'true' }), /require/)
  for (const env of [
    { ADMIN_ORIGIN: 'https://ops.example.test' },
    { ADMIN_CREDENTIALS_FILE: '/tmp/private.json' },
    { ADMIN_CREDENTIALS_FILE: '/tmp/private.json', ADMIN_ORIGIN: '*' },
    { ADMIN_CREDENTIALS_FILE: '/tmp/private.json', ADMIN_ORIGIN: 'https://ops.example.test/path' },
    { ADMIN_CREDENTIALS_FILE: '/tmp/private.json', ADMIN_ORIGIN: 'http://localhost:3003' },
    { ADMIN_CREDENTIALS_FILE: '/tmp/private.json', ADMIN_ORIGIN: 'http://evil.test', ADMIN_ALLOW_INSECURE_LOCALHOST: 'true' },
    { NODE_ENV: 'production', ADMIN_CREDENTIALS_FILE: '/tmp/private.json', ADMIN_ORIGIN: 'http://localhost:3003', ADMIN_ALLOW_INSECURE_LOCALHOST: 'true' },
    { PLATFORM_HOST: '0.0.0.0', ADMIN_CREDENTIALS_FILE: '/tmp/private.json', ADMIN_ORIGIN: 'http://localhost:3003', ADMIN_ALLOW_INSECURE_LOCALHOST: 'true' },
    { ADMIN_CREDENTIALS_FILE: '/tmp/private.json', ADMIN_ORIGIN: 'https://ops.example.test', ADMIN_SESSION_TTL_MS: '0' },
    { ADMIN_CREDENTIALS_FILE: join(adminStaticRoot, 'admins.json'), ADMIN_ORIGIN: 'https://ops.example.test' },
  ]) assert.throws(() => loadAdminConfig(env))

  const credentialPath = join(directory, 'admins.json'); const enrollmentPath = join(directory, 'enrollment.json')
  await provisionAdminFiles({ file: credentialPath, enrollmentFile: enrollmentPath, username: 'owner', password })
  const credentials = await readAdminCredentials(credentialPath)
  assert.equal(credentials.length, 1)
  const contents = await readFile(credentialPath, 'utf8')
  assert.ok(!contents.includes(password))
  assert.equal((await stat(credentialPath)).mode & 0o777, 0o600)
  assert.equal((await stat(enrollmentPath)).mode & 0o777, 0o600)
  assert.match(JSON.parse(await readFile(enrollmentPath, 'utf8')).uri, /^otpauth:\/\/totp\//)
  await assert.rejects(() => provisionAdminFiles({ file: credentialPath, enrollmentFile: enrollmentPath, username: 'owner', password }), /overwrite/)
  if (process.platform !== 'win32') {
    await chmod(credentialPath, 0o644)
    await assert.rejects(() => readAdminCredentials(credentialPath), /private/)
    await chmod(credentialPath, 0o600)
    await symlink(credentialPath, join(directory, 'linked.json'))
    await assert.rejects(() => readAdminCredentials(join(directory, 'linked.json')))
  }
  await writeFile(join(directory, 'invalid.json'), JSON.stringify({ schemaVersion: 1, admins: [{ ...credentials[0], role: 'superuser' }] }), { mode: 0o600 })
  await assert.rejects(() => readAdminCredentials(join(directory, 'invalid.json')), /Invalid/)

  let now = 1_800_000_000_000
  const store = new MemoryPlatformStore()
  const config = loadAdminConfig({ ADMIN_CREDENTIALS_FILE: credentialPath, ADMIN_ORIGIN: 'https://ops.example.test' })
  const auth = new AdminAuth({ credentials, config, store, now: () => now })
  assert.deepEqual(auth.loginOptions(), { totpRequired: true })
  const request = { headers: { origin: config.origin }, socket: { remoteAddress: '127.0.0.1' } }
  const body = { username: 'owner', password, totp: totpAtStep(credentials[0].totpSecret, Math.floor(now / 30_000)) }
  await assert.rejects(() => auth.login({ ...request, headers: { origin: 'https://evil.test' } }, body), error => error.status === 403)
  await assert.rejects(() => auth.login(request, { ...body, password: 'wrong' }), error => error.status === 401)
  const login = await auth.login(request, body)
  const cookie = auth.cookie(login.token)
  for (const property of ['HttpOnly', 'SameSite=Strict', 'Secure', 'Path=/']) assert.ok(cookie.includes(property))
  const sessionRequest = { ...request, headers: { ...request.headers, cookie: cookie.split(';')[0], 'x-csrf-token': login.session.csrfToken } }
  assert.equal(auth.session(sessionRequest, { write: true, roles: ['admin'] }).admin.id, credentials[0].id)
  assert.throws(() => auth.session({ ...sessionRequest, headers: { ...sessionRequest.headers, 'x-csrf-token': 'forged' } }, { write: true }), error => error.status === 403)
  assert.throws(() => auth.session(sessionRequest, { roles: ['support'] }), error => error.status === 403)
  assert.throws(() => auth.session({ ...request, headers: { cookie: `${auth.cookieName}=forged` } }), error => error.status === 401)
  assert.throws(() => auth.session({ ...sessionRequest, headers: { ...sessionRequest.headers, cookie: `${sessionRequest.headers.cookie}; ${sessionRequest.headers.cookie}` } }), error => error.status === 401)
  await assert.rejects(() => auth.login(request, body), error => error.status === 401)
  const restarted = new AdminAuth({ credentials, config, store, now: () => now })
  await assert.rejects(() => restarted.login(request, body), error => error.status === 401)
  assert.throws(() => restarted.session(sessionRequest), error => error.status === 401)
  auth.logout(sessionRequest)
  assert.throws(() => auth.session(sessionRequest), error => error.status === 401)
  now += 30_000
  const next = await auth.login(request, { ...body, totp: totpAtStep(credentials[0].totpSecret, Math.floor(now / 30_000)) })
  now += config.ttlMs
  assert.throws(() => auth.session({ ...request, headers: { cookie: auth.cookie(next.token).split(';')[0] } }), error => error.status === 401)
  const limiter = new BoundedRateLimiter({ now: () => now, limit: 1, capacity: 2, windowMs: 100 })
  limiter.consume('one'); limiter.consume('two')
  assert.throws(() => limiter.consume('one'), error => error.status === 429)
  assert.throws(() => limiter.consume('three'), error => error.status === 429)
  now += 101; limiter.consume('three'); assert.equal(limiter.entries.size, 1)
  const local = new AdminAuth({ credentials: [await createAdminCredential({ username: 'local', password })], config: { ...config, insecureLocalhost: true }, store })
  assert.ok(!local.cookie('token').includes('Secure'))
  assert.throws(() => local.assertOrigin({ ...request, socket: { remoteAddress: '192.0.2.1' } }), error => error.status === 403)

  const weirdId = { ...credentials[0], id: '__proto__' }
  const concurrentStore = new MemoryPlatformStore()
  const concurrentAuth = new AdminAuth({ credentials: [weirdId], config, store: concurrentStore, now: () => now })
  const concurrentBody = { ...body, totp: totpAtStep(weirdId.totpSecret, Math.floor(now / 30_000)) }
  const attempts = await Promise.allSettled([concurrentAuth.login(request, concurrentBody), concurrentAuth.login(request, concurrentBody)])
  assert.equal(attempts.filter(item => item.status === 'fulfilled').length, 1, 'concurrent requests cannot reuse an MFA step, including unusual configured actor IDs')
  assert.equal(attempts.find(item => item.status === 'rejected').reason.status, 401)
  const replayState = await concurrentStore.read(state => state.adminSecurity.lastTotpSteps)
  assert.equal(Object.keys(replayState).length, 1)
  assert.match(Object.keys(replayState)[0], /^[a-f0-9]{64}$/)
  assert.equal(Object.getPrototypeOf(replayState), Object.prototype)
  const disabled = new AdminAuth({ credentials: [{ ...credentials[0], disabled: true }], config, store: new MemoryPlatformStore(), now: () => now })
  await assert.rejects(() => disabled.login(request, concurrentBody), error => error.status === 401)
} finally { await rm(directory, { recursive: true, force: true }) }
console.log('admin auth, credential provisioning, MFA replay and bounded rate-limit tests passed')
