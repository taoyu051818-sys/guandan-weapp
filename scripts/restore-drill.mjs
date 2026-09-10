import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdtemp, mkdir, cp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { performance } from 'node:perf_hooks'
import { JsonFilePlatformStore, createEmptyPlatformState } from '../work/guandan-windows-source/server/platform/storage.js'
import { JsonRoomStateStore } from '../work/guandan-windows-source/server/room-state-store.js'
import { JsonGameResultOutboxStore } from '../work/guandan-windows-source/server/platform/game-result-outbox-store.js'
import { JsonSpectatorOutboxStore } from '../work/guandan-windows-source/server/platform/spectator-outbox-store.js'

assert.equal(process.argv.length, 2, 'This drill accepts no production paths; only temporary synthetic data is allowed')
const directory = await mkdtemp(join(tmpdir(), 'guandan-restore-drill-'))
const started = performance.now()
const source = join(directory, 'source')
const backup = join(directory, 'backup')
const restored = join(directory, 'restored')
const files = ['platform.json', 'rooms.json', 'result-outbox.json', 'spectator-outbox.json']
const hash = bytes => createHash('sha256').update(bytes).digest('hex')
try {
  await mkdir(source)
  const state = createEmptyPlatformState()
  state.users.usr_probe = { id: 'usr_probe', externalId: 'synthetic-release-probe', accountId: '12345678' }
  state.wallets.usr_probe = { userId: 'usr_probe', balance: 1234, currency: 'points' }
  state.enrollmentIdempotency['usr_probe:probe'] = { fingerprint: 'synthetic-receipt', enrollmentId: 'probe' }
  const store = await JsonFilePlatformStore.open(join(source, files[0]), state)
  await store.transaction(draft => { draft.wallets.usr_probe.balance = 2345 })
  const expectedPlatform = await store.read(draft => draft)
  const rooms = new JsonRoomStateStore({ filePath: join(source, files[1]) })
  await rooms.save({ rooms: [{ roomId: '765432', gameVersion: 7 }], acceptedActions: [['synthetic-request', { requestId: 1 }]], closedRoomTombstones: [] })
  const expectedRooms = rooms.load()
  const resultQueue = new JsonGameResultOutboxStore({ filePath: join(source, files[2]) })
  const result = { eventId: 'synthetic-result', finishedAt: 1 }
  resultQueue.add(result)
  const spectatorQueue = new JsonSpectatorOutboxStore({ filePath: join(source, files[3]) })
  const spectator = { eventId: 'synthetic-spectator', matchId: 'synthetic-match', sequence: 1 }
  spectatorQueue.add(spectator)
  // Writers are idle before taking the complete set, as required by the single-instance runbook.
  await rooms.whenIdle()
  await cp(source, backup, { recursive: true, errorOnExist: true, force: false })
  const hashes = Object.fromEntries(await Promise.all(files.map(async file => [file, hash(await readFile(join(backup, file)))])))
  await writeFile(join(backup, 'manifest.json'), JSON.stringify(hashes), { flag: 'wx', mode: 0o600 })
  await cp(backup, restored, { recursive: true, errorOnExist: true, force: false })
  const verify = async () => {
    for (const file of files) assert.equal(hash(await readFile(join(restored, file))), hashes[file], `Backup hash mismatch: ${file}`)
  }
  await verify()
  const recoveredStore = await JsonFilePlatformStore.open(join(restored, files[0]))
  assert.deepEqual(await recoveredStore.read(draft => draft), expectedPlatform)
  assert.deepEqual(new JsonRoomStateStore({ filePath: join(restored, files[1]) }).load(), expectedRooms)
  const recoveredResults = new JsonGameResultOutboxStore({ filePath: join(restored, files[2]) })
  recoveredResults.add(result)
  assert.deepEqual(recoveredResults.pending(), [result], 'retry must not duplicate a recovered result')
  const recoveredSpectators = new JsonSpectatorOutboxStore({ filePath: join(restored, files[3]) })
  recoveredSpectators.add(spectator)
  assert.deepEqual(recoveredSpectators.pending(), [spectator])
  await writeFile(join(restored, files[1]), '{}')
  await assert.rejects(verify, /Backup hash mismatch/, 'corrupted backup must be rejected before opening stores')
  for (const file of files) assert.equal(hash(await readFile(join(backup, file))), hashes[file], 'restore/corruption cannot modify the backup')
  console.log(JSON.stringify({ result: 'passed', scope: 'isolated-synthetic-storage-copy-and-restore', files: files.length,
    elapsedMs: Math.round(performance.now() - started), checks: ['hash integrity', 'wallet and receipts', 'room snapshot', 'outbox retry idempotency', 'corruption rejection'],
    limitations: ['Not a restore from real production backup', 'Duplicate live-room restart is covered by the separate server regression suite'],
  }, null, 2))
} finally { await rm(directory, { recursive: true, force: true }) }
