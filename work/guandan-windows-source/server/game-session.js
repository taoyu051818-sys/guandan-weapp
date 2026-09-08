import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const { createMatchState, transition } = require('../../../shared-core/dist')

const playerIds = ['p1', 'p2', 'p3', 'p4']
const validPlayerId = value => playerIds.includes(value)
const teamFor = playerId => playerId === 'p1' || playerId === 'p3' ? 'teamA' : 'teamB'
const clone = value => JSON.parse(JSON.stringify(value))

export const isCanonicalMatchState = state => Boolean(
  state
  && Number.isSafeInteger(state.revision)
  && Number.isSafeInteger(state.roundId)
  && ['playing', 'tribute', 'settled'].includes(state.phase)
  && state.trick
  && Array.isArray(state.playHistory),
)

export const createInitialMatchState = ({
  players,
  ruleProfile,
  currentLevel = 2,
  dealerId = 'p1',
  teamLevels = { teamA: 2, teamB: 2 },
  aFailStreaks = { teamA: 0, teamB: 0 },
  scores = { teamA: 0, teamB: 0 },
  revision = 1,
  roundId = 1,
  matchFormat,
}) => createMatchState({
  matchFormat,
  ruleProfile,
  currentLevel,
  levelTeam: teamFor(dealerId),
  teamLevels,
  aFailStreaks,
  scores,
  dealerId,
  currentTurn: dealerId,
  players,
  revision,
  roundId,
})

const passedPlayersAfterWinningPlay = state => {
  if (!state.lastValidPlay || !Array.isArray(state.playArea)) return []
  let lastPlayIndex = -1
  for (let index = state.playArea.length - 1; index >= 0; index -= 1) {
    if (state.playArea[index]?.type !== 'Pass') {
      lastPlayIndex = index
      break
    }
  }
  const actions = lastPlayIndex >= 0 ? state.playArea.slice(lastPlayIndex + 1) : []
  return [...new Set(actions.filter(action => action?.type === 'Pass').map(action => action.playerId).filter(validPlayerId))]
}

const sortedWith = (hand, card) => (
  hand.some(candidate => candidate.id === card.id)
    ? hand
    : [...hand, clone(card)].sort((left, right) => right.value - left.value)
)

const migrateLegacyTribute = (players, tribute, roundId) => {
  if (!tribute?.actions?.length) return { players, tribute: null }
  const nextPlayers = clone(players)
  if (tribute.phase === 'tributing') {
    tribute.actions.forEach(action => {
      if (action.card) nextPlayers[action.from].hand = sortedWith(nextPlayers[action.from].hand, action.card)
    })
  } else if (tribute.phase === 'returning') {
    tribute.actions.forEach(action => {
      if (!action.returnCard) return
      nextPlayers[action.from].hand = nextPlayers[action.from].hand.filter(card => card.id !== action.returnCard.id)
      nextPlayers[action.to].hand = sortedWith(nextPlayers[action.to].hand, action.returnCard)
    })
  }
  return {
    players: nextPlayers,
    tribute: {
      mode: tribute.isDoubleDown ? 'double' : 'single',
      status: tribute.isAntiTribute
        ? 'resisted'
        : tribute.phase === 'tributing'
          ? 'selecting_tribute'
          : tribute.phase === 'returning'
            ? 'selecting_return'
            : 'ready',
      exchanges: tribute.actions.map((action, index) => ({
        id: `${roundId}:${action.from}:${action.to}:${index}`,
        from: action.from,
        to: action.to,
        tributeCardId: action.card?.id ?? null,
        returnCardId: action.returnCard?.id ?? null,
      })),
    },
  }
}

/** Upgrades pre-state-machine persisted rooms without discarding an in-flight trick. */
export const migrateLegacyMatchState = ({
  state,
  ruleProfile,
  gameVersion = 0,
  roundSequence = 0,
  teamLevels = { teamA: 2, teamB: 2 },
  aFailStreaks = { teamA: 0, teamB: 0 },
  scores = { teamA: 0, teamB: 0 },
  lastRoundRank = [],
  roundResult = null,
  tribute = null,
}) => {
  if (!state) return null
  if (isCanonicalMatchState(state)) {
    return { ...state, ruleProfile }
  }
  const dealerId = validPlayerId(state.dealerId)
    ? state.dealerId
    : validPlayerId(lastRoundRank[0])
      ? lastRoundRank[0]
      : validPlayerId(state.currentTurn) ? state.currentTurn : 'p1'
  const base = createMatchState({
    ruleProfile,
    currentLevel: state.currentLevel ?? 2,
    levelTeam: state.levelTeam ?? roundResult?.winnerTeam ?? teamFor(dealerId),
    teamLevels: state.teamLevels ?? teamLevels,
    aFailStreaks: state.aFailStreaks ?? aFailStreaks,
    scores: state.scores ?? scores,
    dealerId,
    currentTurn: state.currentTurn,
    players: state.players,
    turnOrder: state.turnOrder,
    lastRoundRank: state.lastRoundRank ?? lastRoundRank,
    revision: Number.isSafeInteger(gameVersion) && gameVersion >= 0 ? gameVersion : 0,
    roundId: Number.isSafeInteger(state.roundId) && state.roundId > 0 ? state.roundId : Math.max(1, roundSequence + 1),
  })
  const playArea = clone(Array.isArray(state.playArea) ? state.playArea : [])
  const lastValidPlay = clone(state.lastValidPlay ?? null)
  const legacyTribute = migrateLegacyTribute(base.players, tribute ?? state.tribute, base.roundId)
  return {
    ...base,
    phase: roundResult ? 'settled' : legacyTribute.tribute ? 'tribute' : 'playing',
    players: legacyTribute.players,
    currentTurn: state.currentTurn,
    playArea,
    playHistory: clone(Array.isArray(state.playHistory) ? state.playHistory : playArea),
    lastValidPlay,
    finishedPlayers: [...(state.finishedPlayers ?? [])],
    trick: {
      winningPlay: lastValidPlay,
      passedPlayerIds: passedPlayersAfterWinningPlay(state),
    },
    lastRoundRank: [...(state.lastRoundRank ?? lastRoundRank)],
    settlement: clone(roundResult),
    tribute: legacyTribute.tribute,
  }
}

export const dispatchMatchIntent = (state, intent) => transition(state, {
  ...intent,
  roundId: state.roundId,
  expectedRevision: state.revision,
})

export const replaceSettlement = (previous, state, settlement) => ({
  ...state,
  phase: 'settled',
  currentLevel: settlement.currentLevel,
  levelTeam: settlement.winnerTeam,
  teamLevels: { ...settlement.teamLevels },
  aFailStreaks: { ...settlement.aFailStreaks },
  lastRoundRank: [...settlement.fullRank],
  scores: {
    ...previous.scores,
    [settlement.winnerTeam]: previous.scores[settlement.winnerTeam] + Math.max(0, settlement.pointsEarned ?? settlement.levelUp),
  },
  settlement,
})

export const matchFailureMessage = reason => ({
  MATCH_NOT_PLAYING: '当前阶段不能出牌',
  NOT_PLAYER_TURN: '未轮到该玩家出牌',
  PLAYER_ALREADY_FINISHED: '该玩家已经出完牌',
  EMPTY_PLAY: '请选择要出的牌',
  DUPLICATE_CARD: '所选手牌重复',
  CARD_NOT_IN_HAND: '所选手牌无效',
  ILLEGAL_PLAY: '不合法的出牌',
  CANNOT_PASS_ON_LEAD: '首发不能过牌',
  WINNING_PLAYER_CANNOT_PASS: '当前不能过牌',
  PLAYER_ALREADY_PASSED: '该玩家已经过牌',
  SETTLEMENT_UNAVAILABLE: '牌局结算失败',
  MATCH_NOT_SETTLED: '当前不能准备下一局',
  MATCH_ALREADY_WON: '本场已打过 A，请重新创建对局',
  INVALID_DEALT_HANDS: '新一局发牌无效',
  DUPLICATE_DEALT_CARD: '新一局发牌重复',
  INVALID_DEALT_CARD: '新一局包含无效牌',
  ROUND_RANK_UNAVAILABLE: '上一局名次缺失',
  MATCH_NOT_IN_TRIBUTE: '当前不是贡还阶段',
  TRIBUTE_NOT_SELECTING: '当前不是进贡阶段',
  NOT_TRIBUTE_GIVER: '当前玩家无需进贡',
  TRIBUTE_ALREADY_SELECTED: '该玩家已经完成进贡',
  INELIGIBLE_TRIBUTE_CARD: '进贡必须交出当前最大的牌',
  RETURN_NOT_SELECTING: '当前不是还贡阶段',
  NOT_RETURN_GIVER: '当前玩家无需还贡',
  RETURN_ALREADY_SELECTED: '该玩家已经完成还贡',
  INELIGIBLE_RETURN_CARD: '还贡牌不符合规则',
  TRIBUTE_NOT_READY: '贡还尚未完成',
  TRIBUTE_LEADER_NOT_FOUND: '无法确定本局首发玩家',
  NOT_TRIBUTE_LEADER: '当前等待指定玩家开始本局',
}[reason] ?? `牌局命令被拒绝：${reason}`)
