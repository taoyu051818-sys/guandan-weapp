import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { nodeSyncDurableFileOperations } from '../durable-file.js'
import { gameResultSignature } from './crypto.js'
import { JsonGameResultOutboxStore } from './game-result-outbox-store.js'
import { GameResultReporter } from './result-reporter.js'

const secret = 'game-result-outbox-secret-with-at-least-thirty-two-characters'
const endpoint = 'https://game-result-outbox.test/results'
const event = {
  eventId: 'game:mat-result-outbox:1',
  matchId: 'mat-result-outbox',
  roomId: '314159',
  ranking: ['p1', 'p2', 'p3', 'p4'],
  userIdsBySeat: { p1: 'usr-1', p2: 'usr-2', p3: 'usr-3', p4: 'usr-4' },
  winnerTeam: 'teamA',
  finishedAt: 1785907200000,
}

const acceptedResponse = (duplicate = false) => ({
  ok: true,
  status: 200,
  async json () {
    return { ok: true, data: { result: { accepted: true, duplicate } } }
  },
})

const root = mkdtempSync(join(tmpdir(), 'guandan-game-result-outbox-'))
try {
  const filePath = join(root, 'pending-results.json')
  let markFirstAttempt
  const firstAttempt = new Promise(resolve => { markFirstAttempt = resolve })
  let persistedBeforeRequest = false
  const beforeRestart = new GameResultReporter({
    endpoint,
    secret,
    outboxFilePath: filePath,
    maxAttempts: 1,
    retryBaseMs: 10_000,
    retryMaxMs: 10_000,
    fetchImpl: async () => {
      const persisted = JSON.parse(readFileSync(filePath, 'utf8'))
      persistedBeforeRequest = persisted.events.some(item => item.eventId === event.eventId)
      markFirstAttempt()
      throw new Error('simulate platform outage')
    },
  })

  const pendingBeforeRestart = beforeRestart.enqueue(event)
  await firstAttempt
  beforeRestart.stop(new Error('simulate game process stop'))
  await assert.rejects(pendingBeforeRestart, /simulate game process stop/)
  assert.equal(persistedBeforeRequest, true, '首次 HTTP 请求前必须已经持久化事件')
  assert.deepEqual(new JsonGameResultOutboxStore({ filePath }).pending(), [event], '进程停止不能删除未确认事件')
  assert.equal(statSync(filePath).mode & 0o777, 0o600, 'outbox 必须只允许服务账号读写')
  assert.deepEqual(readdirSync(root), ['pending-results.json'], '原子保存后不能遗留临时文件')

  const recoveredCalls = []
  const afterRestart = new GameResultReporter({
    endpoint,
    secret,
    outboxFilePath: filePath,
    maxAttempts: 1,
    fetchImpl: async (url, options) => {
      recoveredCalls.push({ url, options })
      return acceptedResponse(true)
    },
  })
  await afterRestart.whenIdle(event.eventId)
  assert.equal(recoveredCalls.length, 1, '新 reporter 实例必须自动重放持久事件')
  assert.equal(recoveredCalls[0].url, endpoint)
  assert.equal(recoveredCalls[0].options.signal instanceof AbortSignal, true, 'HTTP 请求必须携带可中止 signal')
  const timestamp = recoveredCalls[0].options.headers['x-game-timestamp']
  assert.equal(recoveredCalls[0].options.headers['x-game-event-id'], event.eventId)
  assert.equal(recoveredCalls[0].options.headers['x-game-signature'], gameResultSignature(recoveredCalls[0].options.body, secret, timestamp))
  assert.deepEqual(new JsonGameResultOutboxStore({ filePath }).pending(), [], '平台幂等确认后必须删除 durable 事件')

  const conflictPath = join(root, 'conflict.json')
  const conflictStore = new JsonGameResultOutboxStore({ filePath: conflictPath })
  assert.equal(conflictStore.add(event), true)
  assert.equal(conflictStore.add({
    winnerTeam: event.winnerTeam,
    finishedAt: event.finishedAt,
    eventId: event.eventId,
    roomId: event.roomId,
    ranking: event.ranking,
    userIdsBySeat: event.userIdsBySeat,
    matchId: event.matchId,
  }), false, '属性顺序不同但正文相同的事件必须幂等')
  assert.throws(() => conflictStore.add({ ...event, winnerTeam: 'teamB' }), /同一个结算 outbox eventId 对应不同正文/)

  const failurePath = join(root, 'failure', 'result-outbox.json')
  const stableStore = new JsonGameResultOutboxStore({ filePath: failurePath })
  stableStore.add(event)
  const injectedFailure = new Error('injected result outbox rename failure')
  const failingStore = new JsonGameResultOutboxStore({
    filePath: failurePath,
    durableFileOperations: {
      ...nodeSyncDurableFileOperations,
      replace () { throw injectedFailure },
    },
  })
  assert.throws(
    () => failingStore.add({ ...event, eventId: `${event.eventId}:second` }),
    error => error === injectedFailure,
    'rename 失败必须向调用方暴露',
  )
  assert.deepEqual(failingStore.pending(), [event], '持久化失败不能提前提交内存 outbox')
  assert.deepEqual(new JsonGameResultOutboxStore({ filePath: failurePath }).pending(), [event], '故障后 reopen 必须保留上一份 outbox')
  assert.deepEqual(readdirSync(dirname(failurePath)), ['result-outbox.json'], '故障后不能遗留临时文件')
  assert.equal(statSync(dirname(failurePath)).mode & 0o777, 0o700, 'outbox 目录必须只允许服务账号访问')

  const timeoutPath = join(root, 'timeout.json')
  let timeoutCalls = 0
  let timedOutSignal
  const timeoutRecovery = new GameResultReporter({
    endpoint,
    secret,
    outboxFilePath: timeoutPath,
    maxAttempts: 1,
    timeoutMs: 10,
    retryBaseMs: 1,
    retryMaxMs: 1,
    fetchImpl: async (_url, options) => {
      timeoutCalls += 1
      if (timeoutCalls > 1) return acceptedResponse()
      timedOutSignal = options.signal
      return new Promise((resolve, reject) => {
        options.signal.addEventListener('abort', () => reject(options.signal.reason), { once: true })
      })
    },
  })
  const timeoutAccepted = await timeoutRecovery.enqueue({ ...event, eventId: `${event.eventId}:timeout` })
  assert.equal(timeoutAccepted.accepted, true)
  assert.equal(timeoutCalls, 2, 'HTTP 超时后 durable worker 必须持续重试直到成功')
  assert.equal(timedOutSignal.aborted, true)
  assert.deepEqual(new JsonGameResultOutboxStore({ filePath: timeoutPath }).pending(), [])

  const directTimeout = new GameResultReporter({
    endpoint,
    secret,
    maxAttempts: 1,
    timeoutMs: 10,
    fetchImpl: async () => new Promise(() => {}),
  })
  await assert.rejects(() => directTimeout.report(event), /结算回调超时/)
  await assert.rejects(() => directTimeout.enqueue(event), /必须配置持久 outbox/)
  assert.deepEqual(await new GameResultReporter({ endpoint: '', secret }).report(event), { skipped: true })
  assert.deepEqual(await new GameResultReporter({ endpoint: '', secret }).enqueue(event), { skipped: true })

  const corruptPath = join(root, 'corrupt.json')
  writeFileSync(corruptPath, '{not-json')
  assert.throws(() => new JsonGameResultOutboxStore({ filePath: corruptPath }), SyntaxError, '损坏 JSON 必须 fail-fast')
  writeFileSync(corruptPath, JSON.stringify({ schemaVersion: 2, events: [] }))
  assert.throws(() => new JsonGameResultOutboxStore({ filePath: corruptPath }), /格式不受支持/)
} finally {
  rmSync(root, { recursive: true, force: true })
}

console.log('game result durable outbox restart tests passed')
