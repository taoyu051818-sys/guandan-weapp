import assert from 'node:assert/strict'
import { botSeatBindingsMatch, botUserIdsBySeatFromClaims, ensureMatchBotMetadata } from './weapp-match-bot-seats.js'

const claims = {
  roomKind: 'match',
  botUserIdsBySeat: { p2: 'bot_match_p2', p3: 'bot_match_p3', p4: 'bot_match_p4' },
}
assert.deepEqual(botUserIdsBySeatFromClaims(claims), claims.botUserIdsBySeat)
assert.deepEqual(botUserIdsBySeatFromClaims({ roomKind: 'friend', botUserIdsBySeat: claims.botUserIdsBySeat }), {})

const room = {
  ticketBound: true,
  entryKind: 'match',
  botPlayerIds: ['p1', 'p2', 'p3', 'p4'],
  botUserIdsBySeat: structuredClone(claims.botUserIdsBySeat),
  seats: { p1: 'human', p2: 'forged-socket', p3: 'forged-socket', p4: 'forged-socket' },
  resumeTokens: { p1: 'human-token', p2: 'x', p3: 'x', p4: 'x' },
  userIdsBySeat: { p1: 'human-user', p2: null, p3: null, p4: null },
  ticketJtisBySeat: { p1: 'human-jti', p2: 'x', p3: 'x', p4: 'x' },
  ticketExpiresAtBySeat: { p1: 99, p2: 99, p3: 99, p4: 99 },
}
assert.deepEqual(ensureMatchBotMetadata(room), ['p2', 'p3', 'p4'], 'p1 永远由玩家首席占用')
assert.deepEqual(room.userIdsBySeat, { p1: 'human-user', ...claims.botUserIdsBySeat })
assert.deepEqual(room.seats, { p1: 'human', p2: null, p3: null, p4: null })
assert.equal(botSeatBindingsMatch(room, claims), true)
assert.equal(botSeatBindingsMatch(room, { ...claims, botUserIdsBySeat: { ...claims.botUserIdsBySeat, p4: 'bot_other_p4' } }), false)
assert.equal(botSeatBindingsMatch(room, { roomKind: 'match' }), false)

const friendRoom = {
  ticketBound: false,
  entryKind: 'friend',
  botPlayerIds: ['p2', 'p4'],
  seats: { p1: 'host', p2: null, p3: null, p4: null },
  resumeTokens: {},
  userIdsBySeat: {},
  ticketJtisBySeat: {},
  ticketExpiresAtBySeat: {},
}
assert.deepEqual(ensureMatchBotMetadata(friendRoom), ['p2', 'p4'], '既有好友房机器人不要求平台签名身份')

console.log('weapp signed match bot-seat tests passed')
