import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { JsonRoomStateStore, roomForPersistence, roomFromPersistence } from './room-state-store.js'

const dir = mkdtempSync(join(tmpdir(), 'guandan-room-store-'))
try {
  const filePath = join(dir, 'rooms.json')
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
  store.save({ rooms: [roomForPersistence(room)], acceptedActions: [['resume-token:4', { requestId: 4 }]] })
  const loaded = store.load()
  assert.equal(loaded.rooms[0].seats.p1, null, 'process-local socket ids must not be persisted')
  assert.equal(loaded.rooms[0].resumeTokens.p1, 'resume-token')
  assert.equal(loaded.rooms[0].turnDeadlineAt, 1234)
  assert.deepEqual(loaded.rooms[0].lobbyReady, { p1: true, p2: false, p3: true, p4: false })
  assert.deepEqual(loaded.rooms[0].botPlayerIds, ['p2', 'p4'], '机器人席位必须随房间快照持久化')
  assert.deepEqual(roomFromPersistence(loaded.rooms[0]).seats, { p1: null, p2: null, p3: null, p4: null })
  assert.deepEqual(loaded.acceptedActions[0], ['resume-token:4', { requestId: 4 }])
  assert.equal(readFileSync(filePath, 'utf8').includes('socket-secret'), false)
  assert.equal(statSync(filePath).mode & 0o777, 0o600, '快照必须只允许服务账号读写')

  store.save({ rooms: [], acceptedActions: [] })
  assert.deepEqual(store.load().rooms, [], '后续原子替换必须完整覆盖上一份快照')
  assert.deepEqual(readdirSync(dir), ['rooms.json'], '成功保存后不能遗留临时快照')

  writeFileSync(filePath, JSON.stringify({ schemaVersion: 2, rooms: [], acceptedActions: [] }))
  assert.throws(() => store.load(), /格式不受支持/, '不支持的 schema 必须拒绝恢复而不是静默丢局')
} finally {
  rmSync(dir, { recursive: true, force: true })
}

process.stdout.write('room state store tests passed\n')
