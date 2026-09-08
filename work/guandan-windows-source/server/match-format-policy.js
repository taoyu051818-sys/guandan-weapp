import { createRequire } from 'node:module'
import { classicStakeForMode } from './platform/classic-stakes.js'
import { createInitialMatchState } from './game-session.js'
import { roomPlayerNicknames } from './player-nicknames.js'
const { normalizeRoomFormat, roomMatchFormat, chooseMatchLevel, createGame } = createRequire(import.meta.url)('../../../shared-core/dist')

export const isClassicQuickMode = mode => mode === 'quick' || Boolean(classicStakeForMode(mode))
export const isSingleRoundMatch = room => room.entryKind === 'match' && room.state?.matchFormat?.kind === 'independent'

export const formatForNewRoom = room => {
  if (room.entryKind === 'match') return isClassicQuickMode(room.matchMode)
    ? { kind: 'independent', levelMode: 'random', levelRank: 2, tributeEnabled: false, doubleDown: 3 }
    : undefined
  const settings = normalizeRoomFormat(room.roomSettings || {})
  return settings ? roomMatchFormat(settings, room.roomSettings.scoring === 'double-4' ? 4 : 3) : undefined
}

export const createRoomOpeningState = (room, ruleProfile, random, isBotPlayer) => {
  const matchFormat = formatForNewRoom(room)
  const level = matchFormat ? chooseMatchLevel(matchFormat, random) : 2
  const dealt = createGame(level, 'p1', ruleProfile, random)
  const nicknames = roomPlayerNicknames(room)
  Object.keys(dealt.players).forEach(id => {
    const isAI = isBotPlayer(room, id)
    dealt.players[id].isAI = isAI
    dealt.players[id].name = isAI ? nicknames[id] : `玩家${id.slice(1)}`
  })
  return createInitialMatchState({
    matchFormat, players: dealt.players, ruleProfile, currentLevel: level, dealerId: 'p1',
    teamLevels: matchFormat ? { teamA: level, teamB: level } : room.teamLevels || { teamA: 2, teamB: 2 },
    aFailStreaks: room.aFailStreaks || { teamA: 0, teamB: 0 },
    scores: room.scores || { teamA: 0, teamB: 0 },
    revision: Math.max(1, Number(room.gameVersion) + 1 || 1),
    roundId: Math.max(1, Number(room.roundSequence) + 1 || 1),
  })
}
