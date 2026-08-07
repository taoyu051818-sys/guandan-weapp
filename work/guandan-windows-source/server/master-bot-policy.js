import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const { makeDecision } = require('../../../shared-core/dist')

export const MASTER_BOT_DIFFICULTY = 'master'

const seats = ['p1', 'p2', 'p3', 'p4']
const teamForSeat = seat => (seat === 'p1' || seat === 'p3' ? 'teamA' : 'teamB')

export const chooseMasterBotCards = ({ state, teamLevels, playerId }) => {
  if (!seats.includes(playerId)) throw new Error('机器人席位无效')
  const player = state?.players?.[playerId]
  if (!player || !Array.isArray(player.hand)) throw new Error('机器人席位状态缺失')
  const expectedTeam = teamForSeat(playerId)
  if (player.team !== expectedTeam) throw new Error(`机器人席位 ${playerId} 的队伍数据无效`)
  if (!seats.every(seat => state.players?.[seat]?.team === teamForSeat(seat))) {
    throw new Error('牌桌队伍数据无效')
  }

  const currentLevel = state.currentLevel
  return makeDecision(
    player.hand,
    state.lastValidPlay,
    MASTER_BOT_DIFFICULTY,
    expectedTeam,
    state.players,
    playerId,
    {
      currentLevel,
      teamLevels: teamLevels || { teamA: currentLevel, teamB: currentLevel },
      roundMeta: null,
    },
  )
}
