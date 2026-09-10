import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const { createAIEngine, getRuleProfile, ruleProfileKey } = require('../../../shared-core/dist')

export const MASTER_BOT_DIFFICULTY = 'master'

const seats = ['p1', 'p2', 'p3', 'p4']
const teamForSeat = seat => (seat === 'p1' || seat === 'p3' ? 'teamA' : 'teamB')

export const roundMetaForAI = value => {
  if (value == null) return null
  if (typeof value !== 'object' || typeof value.fromTribute !== 'boolean' || typeof value.isAntiTribute !== 'boolean') {
    throw new Error('机器人局次上下文无效')
  }
  return { fromTribute: value.fromTribute, isAntiTribute: value.isAntiTribute }
}

const validateTable = (state, playerId) => {
  if (!seats.includes(playerId)) throw new Error('机器人席位无效')
  const player = state?.players?.[playerId]
  if (!player || !Array.isArray(player.hand)) throw new Error('机器人席位状态缺失')
  const expectedTeam = teamForSeat(playerId)
  if (player.team !== expectedTeam) throw new Error(`机器人席位 ${playerId} 的队伍数据无效`)
  if (!seats.every(seat => state.players?.[seat]?.team === teamForSeat(seat))) {
    throw new Error('牌桌队伍数据无效')
  }
  return { player, expectedTeam }
}

export const createRoomBotPolicy = ({
  ruleProfile = getRuleProfile('classic'),
  seed = Math.floor(Math.random() * 0x1_0000_0000),
  checkpoint,
} = {}) => {
  const engine = createAIEngine({ ruleProfile, seed })
  if (checkpoint) engine.restore(checkpoint)

  const chooseCards = ({ state, teamLevels, playerId }) => {
    if (!state?.ruleProfile || ruleProfileKey(state.ruleProfile) !== ruleProfileKey(engine.ruleProfile)) {
      throw new Error('机器人规则配置与牌局不一致')
    }
    const { player, expectedTeam } = validateTable(state, playerId)
    const currentLevel = state.currentLevel
    // Keep opponent faces outside the policy boundary, including legacy helpers.
    const publicPlayers = Object.fromEntries(seats.map(seat => [seat, {
      id: seat, name: '', isAI: state.players[seat].isAI, team: state.players[seat].team,
      hand: seat === playerId ? player.hand : new Array(state.players[seat].hand.length),
    }]))
    return engine.makeDecision(
      player.hand,
      state.lastValidPlay,
      MASTER_BOT_DIFFICULTY,
      expectedTeam,
      publicPlayers,
      playerId,
      {
        currentLevel,
        teamLevels: teamLevels || state.teamLevels || { teamA: currentLevel, teamB: currentLevel },
        roundMeta: roundMetaForAI(state.roundMeta),
        turnOrder: state.turnOrder,
        publicHistory: state.playHistory ?? state.playArea,
        finishedPlayers: state.finishedPlayers,
        roundId: state.roundId,
        revision: state.revision,
        ruleProfile: engine.ruleProfile,
      },
    )
  }

  return Object.freeze({
    ruleProfile: engine.ruleProfile,
    chooseCards,
    checkpoint: () => engine.checkpoint(),
    restore: value => engine.restore(value),
    reset: () => engine.reset(),
    getLastMetrics: () => engine.getLastMetrics(),
    getLastDecisionTrace: () => engine.getLastDecisionTrace(),
  })
}
