const seats = ['p1', 'p2', 'p3', 'p4']
const unconditionalBombTypes = new Set(['Bomb', 'Rocket'])
const knownPlayTypes = new Set(['Single', 'Pair', 'Triple', 'Straight', 'TripleWithPair', 'Tube', 'Plate', 'StraightFlush', 'Bomb', 'Rocket'])

const emptySeatStats = () => ({
  bombsPlayed: 0,
  playsMade: 0,
  passesMade: 0,
  timeoutActions: 0,
  trusteeActions: 0,
  tributeActions: 0,
  returnTributeActions: 0,
  playTypes: {},
})

export const createGameStatsBySeat = () => Object.fromEntries(seats.map(seat => [seat, emptySeatStats()]))

export const ensureGameStatsBySeat = stats => {
  const target = stats && typeof stats === 'object' ? stats : {}
  seats.forEach(seat => {
    const current = target[seat] && typeof target[seat] === 'object' ? target[seat] : {}
    target[seat] = {
      ...emptySeatStats(),
      ...current,
      playTypes: current.playTypes && typeof current.playTypes === 'object' ? current.playTypes : {},
    }
  })
  return target
}

/** Records only server-accepted actions, never client intents. */
export const recordAuthoritativeAction = (statsBySeat, seat, { kind, playType = null, timedOut = false, trustee = false } = {}, ruleProfile = null) => {
  if (!seats.includes(seat)) throw new TypeError('统计席位无效')
  const stats = ensureGameStatsBySeat(statsBySeat)[seat]
  if (kind === 'play') {
    stats.playsMade += 1
    if (knownPlayTypes.has(playType)) stats.playTypes[playType] = (Number(stats.playTypes[playType]) || 0) + 1
    if (unconditionalBombTypes.has(playType) || (playType === 'StraightFlush' && ruleProfile?.straightFlushAsBomb !== false)) stats.bombsPlayed += 1
  } else if (kind === 'pass') stats.passesMade += 1
  else if (kind === 'tribute') stats.tributeActions += 1
  else if (kind === 'returnTribute') stats.returnTributeActions += 1
  if (timedOut) stats.timeoutActions += 1
  if (trustee) stats.trusteeActions += 1
  return stats
}

const safeCount = (value, maximum) => Math.max(0, Math.min(maximum, Number.isSafeInteger(value) ? value : 0))

/** Produces a bounded clone safe for the signed platform result event. */
export const gameStatsForResult = statsBySeat => {
  const normalized = ensureGameStatsBySeat(statsBySeat)
  return Object.fromEntries(seats.map(seat => {
    const stats = normalized[seat]
    const playTypes = Object.fromEntries(Object.entries(stats.playTypes)
      .filter(([type]) => knownPlayTypes.has(type))
      .map(([type, count]) => [type, safeCount(count, 9999)]))
    return [seat, {
      bombsPlayed: safeCount(stats.bombsPlayed, 99),
      playsMade: safeCount(stats.playsMade, 9999),
      passesMade: safeCount(stats.passesMade, 9999),
      timeoutActions: safeCount(stats.timeoutActions, 9999),
      trusteeActions: safeCount(stats.trusteeActions, 9999),
      tributeActions: safeCount(stats.tributeActions, 9999),
      returnTributeActions: safeCount(stats.returnTributeActions, 9999),
      playTypes,
    }]
  }))
}

export const buildGameResultEvent = (room, result, finishedAt = Date.now()) => ({
  eventId: `game:${room.matchId || room.roomId}:${room.roundSequence}`,
  matchId: room.matchId || undefined,
  roomId: room.roomId,
  ranking: result.fullRank,
  userIdsBySeat: room.userIdsBySeat,
  winnerTeam: result.winnerTeam,
  teamLevels: result.teamLevels,
  statsBySeat: gameStatsForResult(room.statsBySeat),
  finalSpectatorSequence: Math.max(0, Number(room.spectatorSequence) || 0),
  finishedAt,
})
