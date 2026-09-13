// SL-02-001
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { createWeAppMatchLifecycle } from './weapp-match-lifecycle.js'
import { createRoomOpeningState } from './match-format-policy.js'
const { getRuleProfile, settleMatchState } = createRequire(import.meta.url)('../../../shared-core/dist')
const ids = ['p1', 'p2', 'p3', 'p4'], noop = () => {}
const flags = value => Object.fromEntries(ids.map(id => [id, value]))
const rooms = new Map(), published = [], saved = []
let failNextCommit = false
const lifecycle = createWeAppMatchLifecycle({
  playerIds: ids, rooms, connections: new Map(), turnTimeoutMs: 20000,
  friendSecondMs: 1000, totalMinuteMs: 60000,
  isShuttingDown: () => false, enqueueServerOperation: async f => f(),
  ensureLiveMetadata: noop, isFriendRoom: () => true, isMatchRoom: () => false,
  isBotPlayer: () => false, botPolicyForRoom: noop, existingBotPolicyForRoom: () => null,
  shuffleRandom: () => 0.5, persistRuntimeState: noop,
  commitRuntimeState: async () => { if (failNextCommit) { failNextCommit = false; throw Error('one-shot finalization disk failure') }; saved.push([...rooms.values()].map(r => ({
    round: r.state.roundId, phase: r.state.phase, pending: Boolean(r.pendingRoundFinalization),
  }))) },
  stagePendingSideEffects: noop, broadcast: noop, send: noop,
  phaseFor: () => '', liveMetadataFor: () => ({}), publishTurnStatus: noop,
  publishState: r => published.push({ type: 'state', round: r.state.roundId, phase: r.state.phase }),
  publishTribute: noop,
  publishRoundEnded: (r, result) => published.push({ type: 'roundEnded',
    stateRound: r.state.roundId, statePhase: r.state.phase, resultRank: result.fullRank }),
  recordRoomAction: noop, reportSpectatorEvent: noop, reportSpectatorAction: noop,
  reportSpectatorRoundEnd: noop, reportCompletedGame: noop,
  scheduleTimeout: () => ({ unref: noop }), cancelTimeout: noop,
})
for (const terminal of [true, false]) {
  const r = { roomId: terminal ? '100001' : '100002', entryKind: 'friend',
    version: 1, gameVersion: 1, roundSequence: terminal ? 1 : 0,
    roomSettings: { format: 'rounds', rounds: 2, levelMode: 'fixed', levelRank: 2, trusteeSeconds: 0 },
    seats: Object.fromEntries(ids.map(id => [id, `c-${id}`])),
    roundReady: flags(false), trustees: flags(null) }
  const opening = createRoomOpeningState(r, getRuleProfile('classic'), () => 0.5, () => false)
  opening.finishedPlayers = ['p1', 'p3']
  r.state = settleMatchState(opening).state
  r.roundResult = r.state.settlement
  r.roundSequence++
  const settledRound = r.state.roundId
  if (terminal) r.matchEnded = { reason: 'round-limit', roundsPlayed: 2 }
  else r.pendingRoundFinalization = { result: structuredClone(r.roundResult), accepted: null }
  rooms.set(r.roomId, r)
  for (const id of ids) { r.seats[id] = null; lifecycle.markOfflineReady(r, id) }
  assert.equal(r.state.roundId, settledRound)
  assert.equal(r.state.phase, 'settled')
  assert.ok(r.roundResult)
  assert.throws(() => lifecycle.prepareNextRound(r), /不能准备/)
  if (terminal) assert.equal(r.matchEnded.reason, 'round-limit')
  else {
    assert.ok(r.pendingRoundFinalization)
    failNextCommit = true
    await assert.rejects(lifecycle.finalizePendingRound(r), /one-shot/)
    assert.equal(r.state.roundId, settledRound)
    assert.equal(r.state.phase, 'settled')
    assert.ok(r.pendingRoundFinalization)
    assert.ok(r.roundResult)
    await lifecycle.finalizePendingRound(r)
    assert.equal(r.pendingRoundFinalization, null)
    assert.equal(r.state.roundId, settledRound + 1)
    assert.equal(r.state.phase, 'playing')
    assert.equal(r.roundResult, null)
    assert.equal(await lifecycle.finalizePendingRound(r), false)
    assert.equal(r.state.roundId, settledRound + 1)
    assert.equal(saved[0].find(item => item.pending).phase, 'settled')
  }
  console.log({ terminal, settledRound, stateRound: r.state.roundId,
    statePhase: r.state.phase, roundResult: r.roundResult, matchEnded: r.matchEnded || null })
}
console.log({ saved, published })
lifecycle.dispose()
