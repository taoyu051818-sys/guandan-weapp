import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { createWeAppMatchLifecycle } from './weapp-match-lifecycle.js'
import { createRoomMetadata } from './weapp-room-metadata.js'
import { createRoomOpeningState } from './match-format-policy.js'
import { createRoomBotPolicy } from './master-bot-policy.js'
import { migrateLegacyMatchState } from './game-session.js'

const { getRuleProfile } = createRequire(import.meta.url)('../../../shared-core/dist')
const ids = ['p1', 'p2', 'p3', 'p4'], noop = () => {}
for (const teamRotation of ['draw', 'clockwise']) for (const actor of ['bot', 'trustee']) {
  let seed = 1, clock = 1000, restored = false, decisions = 0
  const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 0x100000000 }
  const timers = new Map(), operations = [], errors = [], seen = new Set()
  const metadata = createRoomMetadata({ playerIds: ids, createResumeToken: () => 'synthetic-token', createBotSeed: () => 1,
    entryKindForClaims: () => 'friend', entryDeadlineForClaims: () => null })
  const room = metadata.createRoomRecord({ roomId: '978001', roomSettings: { format: 'rotating', teamRotation, rounds: 3, levelMode: 'fixed', levelRank: 2 } })
  room.entryKind = 'friend'
  room.botPlayerIds = actor === 'bot' ? [...ids] : []
  room.trustees = Object.fromEntries(ids.map(id => [id, actor === 'trustee' ? { reason: 'manual', since: clock } : null]))
  room.state = createRoomOpeningState(room, getRuleProfile('classic'), random, () => actor === 'bot')
  let policy = createRoomBotPolicy({ seed: 17 })
  const rooms = new Map([[room.roomId, room]])
  const lifecycle = createWeAppMatchLifecycle({ playerIds: ids, rooms, connections: new Map(), turnTimeoutMs: 20000,
    friendSecondMs: 1000, totalMinuteMs: 60000, isShuttingDown: () => false,
    enqueueServerOperation: fn => { const p = Promise.resolve().then(fn); operations.push(p); p.catch(noop); return p },
    ensureLiveMetadata: metadata.ensureLiveMetadata, isFriendRoom: () => true, isMatchRoom: () => false,
    isBotPlayer: () => actor === 'bot', botPolicyForRoom: () => policy, existingBotPolicyForRoom: () => policy,
    shuffleRandom: random, persistRuntimeState: noop, commitRuntimeState: async () => {}, stagePendingSideEffects: noop,
    broadcast: noop, send: noop, phaseFor: () => '', liveMetadataFor: () => ({}), publishTurnStatus: noop,
    publishState: noop, publishTribute: noop, publishRoundEnded: noop, recordRoomAction: () => { decisions++; seen.add(room.state.roundId) },
    reportSpectatorEvent: noop, reportSpectatorAction: noop, reportSpectatorRoundEnd: noop, reportCompletedGame: noop,
    closeRoomWithoutAck: () => { throw Error('valid rotating game must not close') }, log: { error: (...args) => errors.push(args) },
    now: () => clock, scheduleTimeout: (fn, delay) => { const key = { unref: noop }; timers.set(key, { fn, at: clock + delay }); return key },
    cancelTimeout: key => timers.delete(key) })
  try {
    lifecycle.syncRoomFromMatchState(room)
    lifecycle.armTurnDeadline(room)
    for (let iteration = 0; iteration < 10000 && !room.matchEnded; iteration++) {
      const [key, timer] = [...timers].sort((a, b) => a[1].at - b[1].at)[0] || []
      assert.ok(timer, 'automatic game must retain a live timer until completion')
      timers.delete(key); clock = timer.at; timer.fn(); await operations.shift()
      if (!restored && room.roundSequence >= 1) {
        const saved = JSON.parse(JSON.stringify(room)), checkpoint = JSON.parse(JSON.stringify(policy.checkpoint()))
        saved.state = migrateLegacyMatchState({ ...saved, ruleProfile: saved.state.ruleProfile })
        for (const property of Object.keys(room)) delete room[property]
        Object.assign(room, saved); policy = createRoomBotPolicy({ seed: 17, checkpoint })
        lifecycle.restoreTurnDeadline(room); restored = true
      }
    }
    assert.equal(room.matchEnded?.reason, 'round-limit')
    assert.equal(room.roundSequence, 3)
    assert.deepEqual([...seen], [1, 2, 3])
    assert.equal(restored, true)
    assert.deepEqual(errors, [])
    console.log(`RP-13-001 ${teamRotation}/${actor}: three full rounds, JSON recovery, ${decisions} legal automatic actions`)
  } finally { lifecycle.dispose() }
}
