import assert from 'node:assert/strict'
import {
  createPublicSpectatorSummary,
  createSpectatorRecord,
  normalizeSpectatorDelay,
  normalizeSpectatorEvent,
  publicSpectatorEvent,
  sanitizeSpectatorTimeline,
  validateSpectatorEventMatchTime,
} from './spectator-domain.js'

const now = 2_000_000
const match = {
  id: 'match:spectator-domain',
  roomId: '123456',
  mode: 'quick',
  status: 'playing',
  createdAt: 1_000_000,
  matchedAt: 1_100_000,
  startedAt: 1_200_000,
}
const gameStart = normalizeSpectatorEvent('spectate:match:spectator-domain:1', {
  eventId: 'spectate:match:spectator-domain:1',
  matchId: match.id,
  roomId: match.roomId,
  sequence: 1,
  roundSequence: 1,
  at: match.startedAt,
  type: 'game-start',
}, now)
assert.deepEqual(gameStart, {
  eventId: 'spectate:match:spectator-domain:1',
  matchId: match.id,
  roomId: match.roomId,
  sequence: 1,
  roundSequence: 1,
  at: match.startedAt,
  type: 'game-start',
})
assert.equal(normalizeSpectatorDelay(1), 15)
assert.equal(normalizeSpectatorDelay(400), 300)
assert.doesNotThrow(() => validateSpectatorEventMatchTime(gameStart, match))
assert.throws(() => normalizeSpectatorEvent(gameStart.eventId, { ...gameStart, privateCards: [] }, now), /不允许字段/)
assert.deepEqual(publicSpectatorEvent({ ...gameStart, userId: 'private-user' }), {
  sequence: 1,
  roundSequence: 1,
  at: match.startedAt,
  type: 'game-start',
})

const state = {
  matches: { [match.id]: match },
  spectatorFeeds: {
    [match.id]: {
      matchId: match.id,
      mode: match.mode,
      startedAt: match.startedAt,
      events: [gameStart, {
        eventId: 'spectate:match:spectator-domain:2',
        matchId: match.id,
        roomId: match.roomId,
        sequence: 2,
        roundSequence: 1,
        at: 1_300_000,
        type: 'round-end',
        ranking: ['p1', 'p2', 'p3', 'p4'],
        winnerTeam: 'teamA',
        isGameWon: true,
      }],
      finishedAt: 1_300_000,
      finalSpectatorSequence: 2,
    },
  },
}
const record = createSpectatorRecord(state, match.id)
const delayed = createPublicSpectatorSummary(record, 30, 1_320_000)
assert.equal(delayed.status, 'running')
assert.equal(delayed.availableEventCount, 1)
const visible = createPublicSpectatorSummary(record, 15, 1_400_000)
assert.equal(visible.status, 'finished')
assert.equal(visible.timelineComplete, true)
assert.equal(visible.availableEventCount, 2)

state.matches[match.id] = { ...match, kind: 'friend-room', roomSettings: { spectator: 'off' } }
assert.equal(createSpectatorRecord(state, match.id), null)

assert.deepEqual(sanitizeSpectatorTimeline([
  { at: 123, type: ' play ', playerId: 'p1', cards: [{ rank: 'A', suit: 'heart', id: 'private' }], text: ' ok ' },
], 456), [{
  sequence: 1,
  at: 123,
  type: 'play',
  playerId: 'p1',
  cards: [{ rank: 'A', suit: 'heart' }],
  text: 'ok',
}])

console.log('spectator domain tests passed')
