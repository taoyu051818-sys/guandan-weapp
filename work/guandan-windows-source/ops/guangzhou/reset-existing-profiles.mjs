// Offline, explicit one-time profile reset. Stop the platform service before --apply.
import assert from 'node:assert/strict'
import { randomInt, createHash } from 'node:crypto'
import { readFileSync, statSync, mkdirSync, writeFileSync, openSync, fsyncSync, closeSync, renameSync, chownSync, unlinkSync } from 'node:fs'
import { resolve, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

export function resetProfiles (original, profiles, now = Date.now()) {
  assert.ok(profiles.length > 1, 'A paired profile library is required')
  const state = structuredClone(original)
  let changed = 0
  let skipped = 0
  for (const user of Object.values(state.users)) {
    if (user.isBot || user.system) { skipped++; continue }
    assert.ok(user.id?.startsWith('usr_') && user.externalId, 'Unrecognized user: abort without changes')
    const candidates = profiles.filter(p => p.avatarUrl !== user.avatarUrl || p.displayName !== user.displayName)
    const profile = candidates[randomInt(candidates.length)]
    assert.ok(profile.displayName && /^profile:\d{3}$/.test(profile.avatarUrl))
    Object.assign(user, { displayName: profile.displayName, avatarUrl: profile.avatarUrl, defaultProfileId: profile.id, updatedAt: now })
    delete user.profileCustomizedAt
    delete user.avatarImageData
    changed++
  }
  const protectedState = structuredClone(state)
  for (const [id, user] of Object.entries(protectedState.users)) {
    for (const field of ['displayName', 'avatarUrl', 'defaultProfileId', 'updatedAt', 'profileCustomizedAt', 'avatarImageData']) {
      delete user[field]
      if (Object.hasOwn(original.users[id], field)) user[field] = original.users[id][field]
    }
  }
  assert.deepEqual(protectedState, original, 'Non-profile data changed')
  return { state, changed, skipped }
}

function main () {
  const [mode, file, catalogFile, backupDirectory] = process.argv.slice(2)
  assert.ok(['--dry-run', '--apply'].includes(mode) && file && catalogFile, 'Usage: --dry-run|--apply DATA CATALOG [NEW_BACKUP_DIRECTORY]')
  const source = readFileSync(file)
  const original = JSON.parse(source)
  const { state, changed, skipped } = resetProfiles(original, JSON.parse(readFileSync(catalogFile)).profiles)
  if (mode === '--apply') {
    assert.ok(backupDirectory && resolve(backupDirectory) !== dirname(resolve(file)))
    const metadata = statSync(file)
    mkdirSync(backupDirectory, { mode: 0o700 }) // Existing backup path aborts, never overwrite a backup.
    const backup = join(backupDirectory, 'platform.before.json')
    writeFileSync(backup, source, { mode: 0o600, flag: 'wx' })
    const descriptor = openSync(backup, 'r'); fsyncSync(descriptor); closeSync(descriptor)
    assert.deepEqual(readFileSync(backup), source)
    assert.deepEqual(readFileSync(file), source, 'Store changed during preparation')
    const temporary = `${file}.profile-reset-${process.pid}.tmp`
    try {
      writeFileSync(temporary, `${JSON.stringify(state, null, 2)}\n`, { mode: metadata.mode & 0o777, flag: 'wx' })
      chownSync(temporary, metadata.uid, metadata.gid)
      const fd = openSync(temporary, 'r'); fsyncSync(fd); closeSync(fd)
      renameSync(temporary, file)
      const dir = openSync(dirname(file), 'r'); fsyncSync(dir); closeSync(dir)
      assert.deepEqual(JSON.parse(readFileSync(file)), state)
    } finally {
      try { unlinkSync(temporary) } catch (error) { if (error.code !== 'ENOENT') throw error }
    }
    writeFileSync(join(backupDirectory, 'manifest.json'), JSON.stringify({ changed, skipped, sourceSha256: createHash('sha256').update(source).digest('hex'), completedAt: new Date().toISOString() }), { mode: 0o600, flag: 'wx' })
  }
  console.log(JSON.stringify({ mode, changed, skipped, protectedDataUnchanged: true }))
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main()
