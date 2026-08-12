import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { nodeSyncDurableFileOperations } from '../durable-file.js'
import { gameResultSignature, spectatorEventSignature } from './crypto.js'
import { loadGameSecurityConfig } from './config.js'
import { SpectatorEventReporter } from './spectator-event-reporter.js'
import { JsonSpectatorOutboxStore } from './spectator-outbox-store.js'

const spectatorSecret = 'outbox-spectator-secret-with-at-least-thirty-two-characters'
const lifecycleSecret = 'outbox-lifecycle-secret-with-at-least-thirty-two-characters'
const matchId = 'mat-outbox-restart'
const firstEvent = {
  eventId: `spectate:${matchId}:1`,
  matchId,
  roomId: '271828',
  sequence: 1,
  at: 1785907200000,
  type: 'game-start',
  roundSequence: 1,
}
const closeEvent = {
  eventId: `spectate:${matchId}:2`,
  matchId,
  roomId: '271828',
  sequence: 2,
  at: 1785907200100,
  type: 'room-closed',
  roundSequence: 1,
  reason: 'empty-timeout',
}

const root = mkdtempSync(join(tmpdir(), 'guandan-spectator-outbox-'))
try {
  const filePath = join(root, 'spectator-outbox.json')
  assert.equal(loadGameSecurityConfig({ GAME_SPECTATOR_OUTBOX_FILE: filePath }).spectatorOutboxFile, filePath)
  let markFirstAttempt
  const firstAttempt = new Promise(resolve => { markFirstAttempt = resolve })
  const beforeRestart = new SpectatorEventReporter({
    endpoint: 'https://spectator-outbox.test/events',
    secret: spectatorSecret,
    lifecycleSecret,
    outboxFilePath: filePath,
    maxAttempts: 1,
    retryBaseMs: 10_000,
    retryMaxMs: 10_000,
    fetchImpl: async () => {
      markFirstAttempt()
      throw new Error('simulate process outage')
    },
  })
  const firstPending = beforeRestart.enqueue(firstEvent)
  const closePending = beforeRestart.enqueue(closeEvent)
  await firstAttempt
  beforeRestart.stop(matchId, new Error('simulate process stop'))
  const stopped = await Promise.allSettled([firstPending, closePending])
  assert.ok(stopped.every(result => result.status === 'rejected'))

  const persisted = JSON.parse(readFileSync(filePath, 'utf8'))
  assert.deepEqual(persisted.events.map(event => event.sequence), [1, 2], '进程停止前两个未确认事件都必须留在 outbox')
  assert.equal(statSync(filePath).mode & 0o777, 0o600, 'outbox 必须只允许服务账号读写')
  assert.deepEqual(readdirSync(root), ['spectator-outbox.json'], '原子保存成功后不能遗留临时文件')

  const recoveredCalls = []
  const afterRestart = new SpectatorEventReporter({
    endpoint: 'https://spectator-outbox.test/events',
    secret: spectatorSecret,
    lifecycleSecret,
    outboxFilePath: filePath,
    maxAttempts: 1,
    fetchImpl: async (_url, options) => {
      const event = JSON.parse(options.body)
      recoveredCalls.push({ event, options })
      return {
        ok: true,
        status: 200,
        async json () { return { ok: true, data: { event: { sequence: event.sequence } } } },
      }
    },
  })
  await afterRestart.whenIdle(matchId)
  assert.deepEqual(recoveredCalls.map(call => call.event.sequence), [1, 2], '重启恢复必须按 match/sequence 严格串行')
  assert.deepEqual(new JsonSpectatorOutboxStore({ filePath }).pending(), [], '远端确认后必须从 durable outbox 删除')

  const closeCall = recoveredCalls[1]
  const timestamp = closeCall.options.headers['x-spectator-timestamp']
  assert.equal(closeCall.options.headers['x-spectator-signature'], spectatorEventSignature(closeCall.options.body, spectatorSecret, timestamp))
  assert.equal(closeCall.options.headers['x-game-event-id'], closeEvent.eventId)
  assert.equal(closeCall.options.headers['x-game-timestamp'], timestamp)
  assert.equal(closeCall.options.headers['x-game-signature'], gameResultSignature(closeCall.options.body, lifecycleSecret, timestamp), 'room-closed 必须保留结算级第二签名')

  const conflictStore = new JsonSpectatorOutboxStore({ filePath: join(root, 'conflict.json') })
  assert.equal(conflictStore.add(firstEvent), true)
  assert.equal(conflictStore.add(firstEvent), false, '相同事件正文必须幂等')
  assert.equal(conflictStore.add(Object.fromEntries(Object.entries(firstEvent).reverse())), false, '字段顺序变化不能改变 outbox 事件身份')
  assert.throws(() => conflictStore.add({ ...firstEvent, type: 'pass' }), /不同正文/)

  const failurePath = join(root, 'failure', 'spectator-outbox.json')
  const stableStore = new JsonSpectatorOutboxStore({ filePath: failurePath })
  stableStore.add(firstEvent)
  const injectedFailure = new Error('injected spectator outbox rename failure')
  const failingStore = new JsonSpectatorOutboxStore({
    filePath: failurePath,
    durableFileOperations: {
      ...nodeSyncDurableFileOperations,
      replace () { throw injectedFailure },
    },
  })
  assert.throws(
    () => failingStore.add({ ...closeEvent, eventId: `${closeEvent.eventId}:failure`, sequence: 3 }),
    error => error === injectedFailure,
    'rename 失败必须向调用方暴露',
  )
  assert.deepEqual(failingStore.pending(), [firstEvent], '持久化失败不能提前提交内存 outbox')
  assert.deepEqual(new JsonSpectatorOutboxStore({ filePath: failurePath }).pending(), [firstEvent], '故障后 reopen 必须保留上一份 outbox')
  assert.deepEqual(readdirSync(dirname(failurePath)), ['spectator-outbox.json'], '故障后不能遗留临时文件')
  assert.equal(statSync(dirname(failurePath)).mode & 0o777, 0o700, 'outbox 目录必须只允许服务账号访问')

  const corruptPath = join(root, 'corrupt.json')
  writeFileSync(corruptPath, '{not-json')
  assert.throws(() => new JsonSpectatorOutboxStore({ filePath: corruptPath }), SyntaxError, '损坏 JSON 必须 fail-fast')
  writeFileSync(corruptPath, JSON.stringify({ schemaVersion: 2, events: [] }))
  assert.throws(() => new JsonSpectatorOutboxStore({ filePath: corruptPath }), /格式不受支持/)
} finally {
  rmSync(root, { recursive: true, force: true })
}

console.log('spectator durable outbox restart tests passed')
