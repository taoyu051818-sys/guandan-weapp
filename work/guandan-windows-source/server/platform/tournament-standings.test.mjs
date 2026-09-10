import assert from 'node:assert/strict'
import { rankTournamentEntries, publicTournamentStanding, qualificationStatus } from './tournament-standings.js'

const entry = (userId, values = {}) => ({
  tournamentId: 'cup', userId, points: 10, played: 3, wins: 0, firstPlaces: 0,
  opponents: [], rank: 0, opponentPoints: 0, ...values,
})
const entries = [
  entry('tie-b', { wins: 1, firstPlaces: 1 }),
  entry('low', { points: 9, wins: 9, firstPlaces: 9 }),
  entry('first', { wins: 1, firstPlaces: 2 }),
  entry('score', { points: 11 }),
  entry('wins', { wins: 2 }),
  entry('tie-a', { wins: 1, firstPlaces: 1 }),
  entry('opponents', { opponents: ['score', 'missing'] }),
  entry('other-cup', { tournamentId: 'other', points: 1000 }),
]
const state = { tournamentStandings: Object.fromEntries(entries.map(item => [`${item.tournamentId}:${item.userId}`, item])), users: {} }
const before = structuredClone(state)
for (const item of entries) { Object.freeze(item.opponents); Object.freeze(item) }
Object.freeze(state.tournamentStandings)
Object.freeze(state)

const ranked = rankTournamentEntries(state, 'cup')
assert.deepEqual(ranked.map(item => item.userId), ['score', 'opponents', 'wins', 'first', 'tie-a', 'tie-b', 'low'],
  'ranking must preserve points → opponent points → wins → first places → stable user key')
assert.deepEqual(ranked.map(item => item.rank), [1, 2, 3, 4, 5, 6, 7])
assert.equal(ranked[1].opponentPoints, 11, 'missing opponents contribute zero; other tournaments do not leak in')
assert.deepEqual(state, before, 'ranking must accept frozen input without mutating stored standings')
assert.deepEqual(rankTournamentEntries({ ...state, tournamentStandings: Object.fromEntries(Object.entries(state.tournamentStandings).reverse()) }, 'cup'), ranked,
  'insertion order must not change ties')
assert.deepEqual(rankTournamentEntries(state, 'missing'), [])
ranked[1].opponents.push('low')
ranked[1].points = -100
assert.deepEqual(state, before, 'returned standing and opponents must not alias stored values')

const repeated = { tournamentStandings: { a: entry('a', { points: 7 }), b: entry('b', { opponents: ['a', 'a'] }) } }
assert.equal(rankTournamentEntries(repeated, 'cup')[0].opponentPoints, 14, 'repeated opponents retain the existing per-encounter scoring rule')
const tournament = { status: 'finished', roundsTotal: 3, advanceCount: 8 }
assert.equal(qualificationStatus({ ...tournament, status: 'running' }, entry('a'), 0), 'pending')
assert.equal(qualificationStatus(tournament, entry('a', { played: 2 }), 0), 'pending')
assert.equal(qualificationStatus(tournament, entry('a'), 7), 'qualified')
assert.equal(qualificationStatus(tournament, entry('a'), 8), 'eliminated')
const publicStanding = publicTournamentStanding({ users: { a: { displayName: '牌友甲' } } }, tournament, entry('a'), 0)
assert.equal(publicStanding.displayName, '牌友甲')
assert.equal(publicStanding.advanced, true)
assert.equal(publicStanding.rank, 1)
assert.equal('opponents' in publicStanding, false, 'public DTO must not expose internal opponent IDs')
assert.equal(publicTournamentStanding({ users: {} }, tournament, entry('a'), 8).displayName, '牌友')
console.log('tournament ranking projection: tie-breaks, qualification, input/output isolation passed')
