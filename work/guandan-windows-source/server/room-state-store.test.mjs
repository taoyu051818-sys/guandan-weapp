import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { nodeAsyncDurableFileOperations } from './durable-file.js'
import { JsonRoomStateStore, markSnapshotAcceptancesDurable, roomForPersistence, roomFromPersistence } from './room-state-store.js'

const dir = mkdtempSync(join(tmpdir(), 'guandan-room-store-'))
try {
  const filePath = join(dir, 'room-state', 'rooms.json')
  const store = new JsonRoomStateStore({ filePath })
  assert.deepEqual(store.load().rooms, [])
  const room = {
    roomId: '123456',
    seats: { p1: 'socket-secret', p2: null, p3: null, p4: null },
    resumeTokens: { p1: 'resume-token', p2: null, p3: null, p4: null },
    state: { currentTurn: 'p1' },
    turnDeadlineAt: 1234,
    deadlinePlayerId: 'p1',
    deadlineAction: 'play',
    lobbyReady: { p1: true, p2: false, p3: true, p4: false },
    dissolveVote: { expiresAt: 2345 },
    botPlayerIds: ['p2', 'p4'],
  }
  const tombstone = { roomId: '654321', matchId: 'mat-closed', until: Date.now() + 60_000 }
  await store.save({ rooms: [roomForPersistence(room)], acceptedActions: [['resume-token:4', { requestId: 4 }]], closedRoomTombstones: [tombstone] })
  const loaded = store.load()
  assert.equal(loaded.rooms[0].seats.p1, null, 'process-local socket ids must not be persisted')
  assert.equal(loaded.rooms[0].resumeTokens.p1, 'resume-token')
  assert.equal(loaded.rooms[0].turnDeadlineAt, 1234)
  assert.deepEqual(loaded.rooms[0].lobbyReady, { p1: true, p2: false, p3: true, p4: false })
  assert.deepEqual(loaded.rooms[0].botPlayerIds, ['p2', 'p4'], '机器人席位必须随房间快照持久化')
  assert.deepEqual(roomFromPersistence(loaded.rooms[0]).seats, { p1: null, p2: null, p3: null, p4: null })
  assert.deepEqual(loaded.acceptedActions[0], ['resume-token:4', { requestId: 4 }])
  assert.deepEqual(loaded.closedRoomTombstones, [tombstone], '已关闭平台房间索引必须与房间快照原子持久化')
  assert.equal(readFileSync(filePath, 'utf8').includes('socket-secret'), false)
  assert.equal(statSync(filePath).mode & 0o777, 0o600, '快照必须只允许服务账号读写')
  assert.equal(statSync(dirname(filePath)).mode & 0o777, 0o700, '快照目录必须只允许服务账号访问')
  assert.equal(new JsonRoomStateStore({ filePath }).load().rooms[0].roomId, room.roomId, '新实例必须从耐久快照恢复房间')

  await store.save({ rooms: [], acceptedActions: [] })
  assert.deepEqual(store.load().rooms, [], '后续原子替换必须完整覆盖上一份快照')
  assert.deepEqual(readdirSync(dirname(filePath)), ['rooms.json'], '成功保存后不能遗留临时快照')

  await store.save({ rooms: [roomForPersistence(room)], acceptedActions: [] })
  const injectedFailure = new Error('injected room snapshot rename failure')
  const failingStore = new JsonRoomStateStore({
    filePath,
    durableFileOperations: {
      ...nodeAsyncDurableFileOperations,
      async replace () { throw injectedFailure },
    },
  })
  await assert.rejects(
    failingStore.save({ rooms: [], acceptedActions: [] }),
    error => error === injectedFailure,
    'rename 失败必须向保存调用方暴露',
  )
  assert.equal(new JsonRoomStateStore({ filePath }).load().rooms[0].roomId, room.roomId, '故障后 reopen 必须保留上一份房间快照')
  assert.deepEqual(readdirSync(dirname(filePath)), ['rooms.json'], '故障后不能遗留临时快照')

  writeFileSync(filePath, JSON.stringify({ schemaVersion: 2, rooms: [], acceptedActions: [] }))
  assert.throws(() => store.load(), /格式不受支持/, '不支持的 schema 必须拒绝恢复而不是静默丢局')

  const oldAcceptance = { requestId: 1, pendingDurability: true }
  const newAcceptance = { requestId: 2, pendingDurability: true }
  const acceptances = new Map([['old:1', oldAcceptance]])
  const oldSnapshot = new Map(acceptances)
  acceptances.set('new:2', newAcceptance)
  markSnapshotAcceptancesDurable(acceptances, oldSnapshot)
  assert.equal(acceptances.get('old:1').pendingDurability, false, '成功快照内的 acceptance 应标记为已落盘')
  assert.equal(acceptances.get('new:2').pendingDurability, true, '旧快照不得确认并发新增的 acceptance')

  const aliasedAcceptance = { requestId: 3, pendingDurability: true }
  acceptances.set('old-token:3', aliasedAcceptance)
  const aliasSnapshot = new Map(acceptances)
  acceptances.set('new-token:3', aliasedAcceptance)
  markSnapshotAcceptancesDurable(acceptances, aliasSnapshot)
  assert.equal(acceptances.get('old-token:3').pendingDurability, false)
  assert.equal(acceptances.get('new-token:3').pendingDurability, true, '凭证轮换产生的新 key 不得被旧快照越代确认')
} finally {
  rmSync(dir, { recursive: true, force: true })
}

process.stdout.write('room state store tests passed\n')
