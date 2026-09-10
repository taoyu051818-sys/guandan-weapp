import { createRequire } from 'node:module'
import { createInitialMatchState } from './game-session.js'
const { createGame, chooseMatchLevel, getRuleProfile, transition, variantAward } = createRequire(import.meta.url)('../../../shared-core/dist')

export const DUPLICATE_SEATS = Array.from({ length: 8 }, (_, i) => `p${i + 1}`)
export const TABLE_SEATS = ['p1', 'p2', 'p3', 'p4']
export const tableOf = seat => Number(seat?.slice(1)) > 4 ? 'B' : 'A'
export const localSeat = seat => DUPLICATE_SEATS.includes(seat) ? `p${(Number(seat.slice(1)) - 1) % 4 + 1}` : 'p1'
export const globalSeat = (table, local) => `p${Number(local.slice(1)) + (table === 'B' ? 4 : 0)}`
export const redSeat = seat => ['p1', 'p3', 'p6', 'p8'].includes(seat)
export const occupant = (room, seat) => room.members.find(m => m.seat === seat && !m.left)

/** Draw once, clone twice. Card identity/order, level, leader match across tables. */
export const dealDuplicateRound = (room, random, now) => {
  const format = { kind: 'independent', levelMode: room.settings.levelMode, levelRank: room.settings.levelRank, tributeEnabled: false, doubleDown: 3 }
  const level = chooseMatchLevel(format, random)
  const leader = TABLE_SEATS[room.completedRounds % 4]
  const rules = getRuleProfile('classic')
  const deal = createGame(level, leader, rules, random)
  room.tables = Object.fromEntries(['A', 'B'].map(table => {
    const players = structuredClone(deal.players)
    for (const id of TABLE_SEATS) {
      const member = occupant(room, globalSeat(table, id))
      if (!member) throw new Error('八个座位未齐')
      players[id].name = member.name; players[id].isAI = member.bot
    }
    return [table, { state: createInitialMatchState({ players, ruleProfile: rules, currentLevel: level, dealerId: leader,
      teamLevels: { teamA: level, teamB: level }, matchFormat: format, roundId: room.completedRounds + 1,
      revision: room.version + 1 }), pendingBotPlay: null, deadlineAt: now + room.settings.turnSeconds * 1000 }]
  }))
  room.members.forEach(m => { m.ready = Boolean(m.bot); m.watch = null })
  room.phase = 'playing'; room.roundTallied = false
}

export const playDuplicate = (room, member, type, payload, now) => {
  if (!member.seat || member.watch) throw new Error('观战中不能操作牌局')
  const table = room.tables[tableOf(member.seat)]
  if (!table || room.phase !== 'playing' || table.state.phase === 'settled') throw new Error('本桌不在出牌阶段')
  if (payload.expectedVersion !== undefined && payload.expectedVersion !== table.state.revision) throw new Error('牌局版本已更新，请重试')
  const result = transition(table.state, { type: type === 'play' ? 'PLAY_CARDS' : 'PASS', playerId: localSeat(member.seat),
    cardIds: payload.cardIds, expectedRevision: table.state.revision, roundId: table.state.roundId })
  if (!result.ok) throw new Error(result.error?.message || result.error?.code || '出牌不合法')
  table.state = result.state
  table.pendingBotPlay = null
  table.deadlineAt = result.state.phase === 'settled' ? null : now + room.settings.turnSeconds * 1000
  if (room.tables.A.state.phase === 'settled' && room.tables.B.state.phase === 'settled' && !room.roundTallied) {
    const row = { round: room.completedRounds + 1, A: null, B: null, red: 0, blue: 0 }
    for (const name of ['A', 'B']) {
      const state = room.tables[name].state
      const rank = state.settlement.fullRank
      const matePlace = rank.findIndex(id => id !== rank[0] && state.players[id].team === state.players[rank[0]].team) + 1
      const [points] = variantAward(matePlace, 'duplicate')
      const team = redSeat(globalSeat(name, rank[0])) ? 'red' : 'blue'
      row[name] = { ranking: [...rank], team, points }; row[team] += points
    }
    room.history.push(row); room.scores.red += row.red; room.scores.blue += row.blue
    room.completedRounds++; room.roundTallied = true
    if (room.completedRounds >= room.settings.rounds) { room.phase = 'ended'; room.endedAt = now }
  }
}
