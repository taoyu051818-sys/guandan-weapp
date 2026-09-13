import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawn } from 'node:child_process'
import { once } from 'node:events'

const directory = await mkdtemp(join(tmpdir(), 'weapp-security-sentinel-'))
const sentinel = join(directory, 'caller-rooms.json')
const hash = async () => createHash('sha256').update(await readFile(sentinel)).digest('hex')
try {
  await writeFile(sentinel, JSON.stringify({ schemaVersion: 1, rooms: [], acceptedActions: [], callerSentinel: 'must-not-change' }))
  const before = await hash()
  const child = spawn(process.execPath, [new URL('./weapp-security.smoke.mjs', import.meta.url).pathname], {
    env: { WEAPP_ROOM_STATE_FILE: sentinel, GAME_RESULT_OUTBOX_FILE: sentinel, GAME_SPECTATOR_OUTBOX_FILE: sentinel,
      GAME_RESULT_ENDPOINT: 'https://invalid.invalid/forbidden', GAME_SPECTATOR_EVENT_ENDPOINT: 'https://invalid.invalid/forbidden' }, stdio: 'inherit' })
  const [code, signal] = await once(child, 'exit')
  assert.equal(signal, null); assert.equal(code, 0)
  assert.equal(await hash(), before, 'a smoke child must never inherit caller state/outbox files')
} finally { await rm(directory, { recursive: true, force: true }) }
console.log('TEST-32-001: caller state hash unchanged under inherited state/outbox/callback settings')
