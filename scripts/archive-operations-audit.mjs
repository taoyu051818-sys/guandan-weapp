import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { lstat, mkdir, readFile, realpath, writeFile } from 'node:fs/promises'
import { dirname, isAbsolute, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { storageCapacity } from '../work/guandan-windows-source/server/platform/storage-capacity.js'

const repository = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const hash = bytes => createHash('sha256').update(bytes).digest('hex')
const readSnapshot = async path => {
  assert.ok((await lstat(path)).isFile(), 'Snapshot must be a regular file, not a symlink')
  const bytes = await readFile(path)
  const state = JSON.parse(bytes)
  assert.ok(state && !Array.isArray(state) && typeof state.users === 'object' && Number.isSafeInteger(state.schemaVersion), 'Not a platform snapshot')
  return { bytes, state }
}

// Never modifies a running writer's file. Produces a private offline bundle for
// review/adoption only after the writer is stopped and the source hash rechecked.
export async function archiveAudit ({ source, output, before, keep = 1000 }) {
  assert.ok(Number.isSafeInteger(before) && before > 0, 'Invalid cutoff timestamp')
  assert.ok(Number.isSafeInteger(keep) && keep >= 1, 'Retain at least one recent audit entry')
  const parent = await realpath(dirname(resolve(output)))
  const pathFromRepo = relative(repository, parent)
  assert.ok(isAbsolute(pathFromRepo) || pathFromRepo === '..' || pathFromRepo.startsWith('../'), 'Private snapshots must remain outside the repository')
  const { bytes, state } = await readSnapshot(source)
  const entries = state.operations?.audit
  assert.ok(Array.isArray(entries), 'No audit array')
  assert.equal(new Set(entries.map(e => e.id)).size, entries.length, 'Duplicate audit IDs')
  assert.ok(entries.every(e => typeof e.id === 'string' && Number.isSafeInteger(e.createdAt)), 'Invalid audit records')
  let count = 0
  // Archive a prefix only, preserving append order even if the clock moved back.
  while (count < entries.length - keep && entries[count].createdAt < before) count++
  assert.ok(count > 0, 'No eligible audit entries; nothing written')
  const archived = entries.slice(0, count)
  state.operations.audit = entries.slice(count)
  state.operations.auditBytes = Buffer.byteLength(JSON.stringify(state.operations.audit))
  const files = {
    'source-platform.json': bytes,
    'audit.json': Buffer.from(JSON.stringify(archived, null, 2) + '\n'),
    'next-platform.json': Buffer.from(JSON.stringify(state, null, 2) + '\n'),
  }
  await mkdir(output, { mode: 0o700 }) // no recursive/overwrite: every attempt is a new bundle
  for (const [name, contents] of Object.entries(files)) await writeFile(resolve(output, name), contents, { flag: 'wx', mode: 0o600 })
  assert.equal(hash(await readFile(source)), hash(bytes), 'Source changed; discard incomplete bundle and retry with a stopped writer')
  const manifest = { schemaVersion: 1, createdAt: new Date().toISOString(), before, keep, archived: count, retained: entries.length - count,
    files: Object.fromEntries(Object.entries(files).map(([name, value]) => [name, { sha256: hash(value), bytes: value.length }])),
    adoption: 'not-applied; stop writer, recheck original SHA-256, verify bundle, retain backup before any separately authorized replacement' }
  await writeFile(resolve(output, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n', { flag: 'wx', mode: 0o600 })
  await verifyArchive(output)
  return { archived: count, retained: entries.length - count, sourceSha256: hash(bytes), adoption: 'not-applied' }
}

export async function verifyArchive (directory) {
  const manifest = JSON.parse(await readFile(resolve(directory, 'manifest.json'), 'utf8'))
  assert.equal(manifest.schemaVersion, 1)
  const names = ['source-platform.json', 'audit.json', 'next-platform.json']
  assert.deepEqual(Object.keys(manifest.files).sort(), names.slice().sort())
  const values = {}
  for (const name of names) {
    const path = resolve(directory, name)
    assert.ok((await lstat(path)).isFile(), 'Archive files must not be symlinks')
    const bytes = await readFile(path)
    assert.deepEqual({ sha256: hash(bytes), bytes: bytes.length }, manifest.files[name], `Archive hash mismatch: ${name}`)
    values[name] = JSON.parse(bytes)
  }
  const original = values['source-platform.json'], next = values['next-platform.json'], archived = values['audit.json']
  assert.equal(archived.length, manifest.archived)
  assert.equal(next.operations.audit.length, manifest.retained)
  assert.deepEqual([...archived, ...next.operations.audit], original.operations.audit, 'Audit conservation failed')
  assert.equal(next.operations.auditBytes, Buffer.byteLength(JSON.stringify(next.operations.audit)))
  next.operations.audit = original.operations.audit
  if (Object.hasOwn(original.operations, 'auditBytes')) next.operations.auditBytes = original.operations.auditBytes
  else delete next.operations.auditBytes
  assert.deepEqual(next, original, 'Non-audit data changed')
  return true
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [mode, source, output, cutoff] = process.argv.slice(2)
  if (mode === 'inspect' && process.argv.length === 4) {
    const { bytes, state } = await readSnapshot(source)
    const report = storageCapacity(state, bytes.length, { exactAuditBytes: true })
    console.log(JSON.stringify(report, null, 2))
    process.exitCode = report.status === 'ok' ? 0 : 2
  } else if (mode === 'verify' && process.argv.length === 4) {
    await verifyArchive(source); console.log('Private archive hashes and full-state conservation verified')
  } else {
    assert.ok(mode === 'prepare' && process.argv.length === 6, 'Usage: archive-operations-audit.mjs inspect SNAPSHOT | prepare SNAPSHOT NEW_EXTERNAL_DIR CUTOFF_ISO | verify ARCHIVE_DIR')
    console.log(JSON.stringify(await archiveAudit({ source, output, before: Date.parse(cutoff) }), null, 2))
  }
}
