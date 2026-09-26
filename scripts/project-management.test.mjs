import assert from 'node:assert/strict'
import { mkdtemp, readFile, writeFile, rm, stat, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createPlatformRuntime } from '../work/guandan-windows-source/server/platform-server.js'
import { JsonFilePlatformStore, createEmptyPlatformState } from '../work/guandan-windows-source/server/platform/storage.js'
import { createStorageCapacityObserver, storageCapacity, STORAGE_BUDGETS } from '../work/guandan-windows-source/server/platform/storage-capacity.js'
import { verifyCompatibility, validateApiBase, requiredContracts } from './release-compatibility.mjs'
import { confirmedUpload } from './wechat-release.mjs'
import { archiveAudit, verifyArchive } from './archive-operations-audit.mjs'
import './release-manifest.test.mjs'

for (const base of ['http://example.com', 'https://name:password@example.com', 'https://example.com?token=x', 'https://example.com#x']) assert.throws(() => validateApiBase(base))
assert.throws(() => validateApiBase('http://localhost', true))
assert.equal(validateApiBase('http://127.0.0.1:1234/', true), 'http://127.0.0.1:1234')
const runtime = await createPlatformRuntime({ env: { NODE_ENV: 'test' }, logger: { error () {} } })
await new Promise(resolve => runtime.server.listen(0, '127.0.0.1', resolve))
try {
  const base = `http://127.0.0.1:${runtime.server.address().port}`
  const before = await runtime.store.read(state => state)
  const result = await verifyCompatibility(base, { allowLoopback: true })
  assert.deepEqual(result.contracts, requiredContracts)
  assert.equal(result.checks.length, 4)
  assert.deepEqual(await runtime.store.read(state => state), before, 'Preflight must not create accounts or mutate operations')
} finally { runtime.server.closeAllConnections(); await new Promise(resolve => runtime.server.close(resolve)) }
const response = (data, status = 200, type = 'application/json') => new Response(JSON.stringify({ ok: true, data }), { status, headers: { 'content-type': type } })
await assert.rejects(verifyCompatibility('https://example.test', { fetcher: async () => response({}, 404) }), /HTTP 404/)
await assert.rejects(verifyCompatibility('https://example.test', { fetcher: async () => response({ contracts: { ...requiredContracts, feedback: 2 } }) }), /feedback/)
await assert.rejects(verifyCompatibility('https://example.test', { fetcher: async () => response({}, 200, 'text/html') }), /Expected JSON/)
await assert.rejects(verifyCompatibility('https://example.test', { fetcher: async () => { throw new Error('timeout') } }), /timeout/)
await assert.rejects(verifyCompatibility('https://example.test', { fetcher: async url => response(url.endsWith('capabilities') ? { contracts: requiredContracts } : { id: 'messages', status: 'open' }) }), /Invalid service/)
assert.ok(confirmedUpload({ status: 0, stdout: '✔ upload' }))
for (const result of [{ status: 0, stdout: 'getDevCodeByFileList-miniGame' }, { status: 0, stderr: 'Error: code 17', stdout: '✔ upload' }, { status: 1, stdout: '✔ upload' }]) assert.equal(confirmedUpload(result), false)

const directory = await mkdtemp(join(tmpdir(), 'guandan-management-'))
try {
  const source = join(directory, 'platform.json'), output = join(directory, 'archive')
  const state = createEmptyPlatformState()
  state.operations = { audit: Array.from({ length: 5 }, (_, i) => ({ id: `audit-${i}`, createdAt: i + 1 })), feedback: { private: { content: 'keep unchanged' } } }
  state.adminSecurity = { mustPreserve: true }
  await writeFile(source, JSON.stringify(state), { mode: 0o600 })
  const bytes = await readFile(source)
  const result = await archiveAudit({ source, output, before: 4, keep: 2 })
  assert.equal(result.archived, 3)
  assert.deepEqual(await readFile(source), bytes, 'Archive preparation never replaces source')
  await verifyArchive(output)
  assert.equal((await stat(output)).mode & 0o777, 0o700)
  assert.equal((await stat(join(output, 'next-platform.json'))).mode & 0o777, 0o600)
  await assert.rejects(archiveAudit({ source, output, before: 4, keep: 2 }), /EEXIST/)
  await assert.rejects(archiveAudit({ source, output: join(directory, 'nothing'), before: 1, keep: 2 }), /No eligible/)
  await symlink(source, join(directory, 'link'))
  await assert.rejects(archiveAudit({ source: join(directory, 'link'), output: join(directory, 'linked'), before: 4, keep: 2 }), /regular file/)
  await writeFile(join(output, 'audit.json'), '[]')
  await assert.rejects(verifyArchive(output), /hash mismatch/)
  const warnings = [], observe = createStorageCapacityObserver({ warn: (...args) => warnings.push(args) })
  const warning = storageCapacity(state, STORAGE_BUDGETS.snapshotBytes * 0.8)
  observe(warning); observe(warning)
  assert.equal(warnings.length, 1, 'Do not spam logs on every write')
  observe(storageCapacity(state, STORAGE_BUDGETS.snapshotBytes)); assert.equal(warnings.length, 2)
  observe(storageCapacity(state, 1)); observe(warning); assert.equal(warnings.length, 3, 'Warn again after recovery')
  createStorageCapacityObserver({ warn () { throw new Error('logging failed') } })(warning)
  const pressure = createEmptyPlatformState()
  pressure.operations = { audit: Array.from({ length: 80000 }, (_, i) => ({ id: String(i), createdAt: i })) }
  const storeWarnings = []
  const store = await JsonFilePlatformStore.open(join(directory, 'capacity.json'), pressure, { logger: { warn: (...args) => storeWarnings.push(args) } })
  assert.equal(storeWarnings.length, 1, 'Capacity observer wired into durable store')
  await store.transaction(draft => { draft.operations.audit = []; draft.operations.auditBytes = 2 })
  const opened = await JsonFilePlatformStore.open(join(directory, 'capacity.json'), undefined, { logger: { warn: (...args) => storeWarnings.push(args) } })
  assert.equal((await opened.read(s => s.operations.audit)).length, 0)
} finally { await rm(directory, { recursive: true, force: true }) }

const workflow = await readFile(new URL('../.github/workflows/guandan-operations.yml', import.meta.url), 'utf8')
assert.equal(workflow.match(/'work\/guandan-admin\/\*\*'/g).length, 2, 'Admin changes must trigger both PR and main CI')
for (const command of ['npm --prefix work/guandan-admin run verify', 'admin-http.test.mjs', 'node scripts/project-management.test.mjs']) assert.ok(workflow.includes(command))
console.log('Project management passed: live read-only contracts, upload evidence, private lossless archive, capacity warnings and admin CI coverage')
