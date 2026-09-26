// Local, ephemeral acceptance environment. No production store/config is read.
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { randomBytes } from 'node:crypto'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { createPlatformRuntime } from '../work/guandan-windows-source/server/platform-server.js'
import { createAdminCredential, readAdminCredentials } from '../work/guandan-windows-source/server/platform/admin-credentials.js'

if (process.env.NODE_ENV === 'production') throw Error('Local preview must not run in production')
const port = Number(process.argv[2] || 18743)
if (!Number.isSafeInteger(port) || port < 1024 || port > 65535) throw Error('Invalid local preview port')
const directory = await mkdtemp(join(tmpdir(), 'guandan-ops-preview-'))
const externalCredentials = process.argv[3]
const password = externalCredentials ? null : randomBytes(24).toString('base64url')
const credential = externalCredentials
  ? (await readAdminCredentials(externalCredentials))[0]
  : await createAdminCredential({ username: 'local-preview', password })
const credentialsFile = externalCredentials || join(directory, 'admins.json')
if (!externalCredentials) await writeFile(credentialsFile, JSON.stringify({ schemaVersion: 1, admins: [credential] }), { mode: 0o600 })
// Explicit test-only handoff file. Never printed, never served, removed on shutdown.
if (!externalCredentials) await writeFile(join(directory, 'local-login.json'), JSON.stringify({ username: credential.username, password, totpSecret: credential.totpSecret }), { mode: 0o600 })
let runtime
try {
  runtime = await createPlatformRuntime({ env: {
    NODE_ENV: 'development', PLATFORM_HOST: '127.0.0.1', PLATFORM_PORT: String(port), PLATFORM_STORE_MODE: 'memory',
    PLATFORM_CORS_ORIGIN: `http://127.0.0.1:${port}`, PLATFORM_ENABLE_DEV_LOGIN: 'true',
    ADMIN_CREDENTIALS_FILE: credentialsFile, ADMIN_ORIGIN: `http://127.0.0.1:${port}`, ADMIN_ALLOW_INSECURE_LOCALHOST: 'true',
    ADMIN_ALLOW_PASSWORD_ONLY_LOCALHOST: 'true',
  } })
  const actor = { id: credential.id, role: 'admin' }
  const announcement = await runtime.operations.createAnnouncement(actor, { title: '本地验收公告', content: '此页面使用独立内存数据，仅用于验收，不影响线上玩家。' })
  await runtime.operations.updateAnnouncement(actor, announcement.id, { version: announcement.version, title: announcement.title,
    content: announcement.content, startsAt: null, endsAt: null, status: 'published' })
  const login = await runtime.service.devLogin({ externalId: 'local-ops-acceptance', displayName: '本地验收玩家' })
  await runtime.operations.submitFeedback(login.user.id, { category: 'suggestion', content: '这是独立验收环境的测试反馈，请验证回复会出现在该玩家的消息中。' }, 'preview-feedback-1')
  await new Promise((resolve, reject) => { runtime.server.once('error', reject); runtime.server.listen(port, '127.0.0.1', resolve) })
  console.log(`Local operations acceptance: http://127.0.0.1:${port}/admin/\n${externalCredentials ? 'Using private external test credentials.' : `Private test login file: ${join(directory, 'local-login.json')}`}\nAll business data is memory-only. Stop with Ctrl+C.`)
} catch (error) { await rm(directory, { recursive: true, force: true }); throw error }
let closing = false
async function close () {
  if (closing) return
  closing = true
  runtime.server.closeAllConnections()
  await new Promise(resolve => runtime.server.close(resolve))
  await rm(directory, { recursive: true, force: true })
  process.exit(0)
}
process.once('SIGINT', close); process.once('SIGTERM', close)
