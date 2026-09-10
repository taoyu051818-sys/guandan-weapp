import { createRequire } from 'node:module'
const { normalizeRoomFormat } = createRequire(import.meta.url)('../../../shared-core/dist')
const ROUND_COUNT_MIN = 4
const ROUND_COUNT_MAX = 32
const TURN_SECONDS = new Set([15, 20, 30, 40, 60])
const TRUSTEE_SECONDS = new Set([0, 15, 30, 60])
const TOTAL_TIME_MINUTES = new Set([0, 20, 30, 60])
const SCORING_MODES = new Set(['double-3', 'double-4'])
const SCORE_VISIBILITY = new Set(['live', 'hidden'])
const SPECTATOR_MODES = new Set(['off', 'live', 'delayed-round', 'delay-15', 'delay-30', 'delay-60'])
const SORT_ORDERS = new Set(['desc', 'asc'])
const RANKS = [2, 3, 4, 5, 6, 7, 8, 9, 10, 'J', 'Q', 'K', 'A']

// Fields after the first comma on each line are accepted only for older clients.
const acceptedFields = new Set([
  'mode',
  'format', 'levelMode', 'levelRank', 'tributeEnabled', 'upgradeTarget',
  'teamRotation', 'rotatingScoring',
  'counterEnabled', 'disableVoice',
  'rounds', 'roundCount', 'gameCount', 'customRoundCount',
  'scoring', 'doubleDownScore', 'doubleDownPoints',
  'scoreVisibility', 'scoreDisplay', 'scoreVisible',
  'turnSeconds', 'firstPlaySeconds',
  'trusteeSeconds',
  'totalTimeMinutes', 'totalMinutes', 'totalDurationMinutes',
  'spectator',
  'autoSort', 'oneClickSort',
  'disableInteraction', 'disableChat',
  'sortOrder', 'authoritativeValidation',
])

export const DEFAULT_FRIEND_ROOM_SETTINGS = Object.freeze({
  // `mode` remains in the response for compatibility with the existing Cocos client.
  mode: 'classic',
  rounds: 4,
  scoring: 'double-3',
  scoreVisibility: 'live',
  turnSeconds: 20,
  trusteeSeconds: 15,
  totalTimeMinutes: 0,
  spectator: 'off',
  autoSort: true,
  disableInteraction: true,
  sortOrder: 'desc',
  authoritativeValidation: true,
})

const invalid = (message) => { throw new Error(`好友房设置无效：${message}`) }
const own = (value, key) => Object.prototype.hasOwnProperty.call(value, key)
const firstOwn = (source, keys) => {
  const key = keys.find(candidate => own(source, candidate))
  return key ? source[key] : undefined
}
const validRoundCount = value => Number.isInteger(value)
  && value >= ROUND_COUNT_MIN
  && value <= ROUND_COUNT_MAX
  && value % 4 === 0
const normalizedOrDefault = (valid, value, fallback, strict, message) => {
  if (valid) return value
  if (strict) invalid(message)
  return fallback
}

export const normalizeFriendRoomSettings = (value, { strict = false } = {}) => {
  const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {}
  if (strict && value !== undefined && value !== null && source !== value) invalid('必须是对象')
  if (strict) {
    const unknown = Object.keys(source).find(key => !acceptedFields.has(key))
    if (unknown) invalid(`不支持字段 ${unknown}`)
  }

  const modeRaw = own(source, 'mode') ? source.mode : DEFAULT_FRIEND_ROOM_SETTINGS.mode
  const mode = normalizedOrDefault(modeRaw === 'classic', modeRaw, DEFAULT_FRIEND_ROOM_SETTINGS.mode, strict, 'mode 仅支持 classic')
  let formatSettings
  try { formatSettings = normalizeRoomFormat(source) } catch (error) { if (strict) invalid(error.message) }

  let roundsRaw = firstOwn(source, ['rounds', 'roundCount', 'gameCount'])
  if (roundsRaw === 'custom') roundsRaw = source.customRoundCount
  if (roundsRaw === undefined) roundsRaw = DEFAULT_FRIEND_ROOM_SETTINGS.rounds
  const rounds = normalizedOrDefault(
    formatSettings ? Number.isInteger(roundsRaw) && roundsRaw >= 1 && roundsRaw <= ROUND_COUNT_MAX : validRoundCount(roundsRaw),
    roundsRaw,
    DEFAULT_FRIEND_ROOM_SETTINGS.rounds,
    strict,
    formatSettings ? 'rounds 必须为 1-32 的整数' : `rounds 必须是 ${ROUND_COUNT_MIN}-${ROUND_COUNT_MAX} 且为 4 的倍数`,
  )

  const scoringRaw = firstOwn(source, ['scoring', 'doubleDownScore', 'doubleDownPoints'])
  const scoringAliases = { 3: 'double-3', 4: 'double-4' }
  const mappedScoring = scoringRaw === undefined
    ? DEFAULT_FRIEND_ROOM_SETTINGS.scoring
    : (own(source, 'scoring') ? scoringRaw : (scoringAliases[scoringRaw] || scoringRaw))
  const scoring = normalizedOrDefault(
    SCORING_MODES.has(mappedScoring) && !(['rotating', 'duplicate'].includes(formatSettings?.format) && mappedScoring !== 'double-3'),
    mappedScoring,
    DEFAULT_FRIEND_ROOM_SETTINGS.scoring,
    strict,
    'scoring 仅支持 double-3 或 double-4',
  )

  const scoreRaw = firstOwn(source, ['scoreVisibility', 'scoreDisplay', 'scoreVisible'])
  const scoreAliases = { realtime: 'live', true: 'live', false: 'hidden' }
  const mappedScore = scoreRaw === undefined
    ? DEFAULT_FRIEND_ROOM_SETTINGS.scoreVisibility
    : (own(source, 'scoreVisibility') ? scoreRaw : (scoreAliases[String(scoreRaw)] || scoreRaw))
  const scoreVisibility = normalizedOrDefault(
    SCORE_VISIBILITY.has(mappedScore),
    mappedScore,
    DEFAULT_FRIEND_ROOM_SETTINGS.scoreVisibility,
    strict,
    'scoreVisibility 仅支持 live 或 hidden',
  )

  const turnRaw = firstOwn(source, ['turnSeconds', 'firstPlaySeconds']) ?? DEFAULT_FRIEND_ROOM_SETTINGS.turnSeconds
  const turnSeconds = normalizedOrDefault(
    TURN_SECONDS.has(turnRaw),
    turnRaw,
    DEFAULT_FRIEND_ROOM_SETTINGS.turnSeconds,
    strict,
    'turnSeconds 仅支持 15、20、30、40 或 60',
  )

  const trusteeRaw = own(source, 'trusteeSeconds') ? source.trusteeSeconds : DEFAULT_FRIEND_ROOM_SETTINGS.trusteeSeconds
  const mappedTrustee = trusteeRaw === 'none' || trusteeRaw === null ? 0 : trusteeRaw
  const trusteeSeconds = normalizedOrDefault(
    TRUSTEE_SECONDS.has(mappedTrustee),
    mappedTrustee,
    DEFAULT_FRIEND_ROOM_SETTINGS.trusteeSeconds,
    strict,
    'trusteeSeconds 仅支持 0、15、30 或 60',
  )

  const totalRaw = firstOwn(source, ['totalTimeMinutes', 'totalMinutes', 'totalDurationMinutes'])
  const totalIsCanonical = own(source, 'totalTimeMinutes')
  const mappedTotal = totalRaw === undefined
    ? DEFAULT_FRIEND_ROOM_SETTINGS.totalTimeMinutes
    : (!totalIsCanonical && (totalRaw === null || totalRaw === 'unlimited') ? 0 : totalRaw)
  const totalTimeMinutes = normalizedOrDefault(
    TOTAL_TIME_MINUTES.has(mappedTotal),
    mappedTotal,
    DEFAULT_FRIEND_ROOM_SETTINGS.totalTimeMinutes,
    strict,
    'totalTimeMinutes 仅支持 0、20、30 或 60',
  )

  const spectatorRaw = own(source, 'spectator') ? source.spectator : DEFAULT_FRIEND_ROOM_SETTINGS.spectator
  const spectatorAliases = { realtime: 'live', delayed: 'delayed-round', 'delay-one-round': 'delayed-round' }
  const mappedSpectator = spectatorAliases[spectatorRaw] || spectatorRaw
  const spectator = normalizedOrDefault(
    SPECTATOR_MODES.has(mappedSpectator),
    mappedSpectator,
    DEFAULT_FRIEND_ROOM_SETTINGS.spectator,
    strict,
    'spectator 仅支持禁止、实时、延迟15/30/60秒或延迟1局',
  )

  const autoSortRaw = firstOwn(source, ['autoSort', 'oneClickSort'])
  const autoSortValue = autoSortRaw ?? DEFAULT_FRIEND_ROOM_SETTINGS.autoSort
  const autoSort = normalizedOrDefault(
    typeof autoSortValue === 'boolean',
    autoSortValue,
    DEFAULT_FRIEND_ROOM_SETTINGS.autoSort,
    strict,
    'autoSort 必须是布尔值',
  )

  const interactionRaw = firstOwn(source, ['disableInteraction', 'disableChat'])
  const interactionValue = interactionRaw ?? DEFAULT_FRIEND_ROOM_SETTINGS.disableInteraction
  const disableInteraction = normalizedOrDefault(
    typeof interactionValue === 'boolean',
    interactionValue,
    DEFAULT_FRIEND_ROOM_SETTINGS.disableInteraction,
    strict,
    'disableInteraction 必须是布尔值',
  )

  const sortRaw = own(source, 'sortOrder') ? source.sortOrder : DEFAULT_FRIEND_ROOM_SETTINGS.sortOrder
  const sortOrder = normalizedOrDefault(
    SORT_ORDERS.has(sortRaw),
    sortRaw,
    DEFAULT_FRIEND_ROOM_SETTINGS.sortOrder,
    strict,
    'sortOrder 仅支持 desc 或 asc',
  )

  const validationRaw = own(source, 'authoritativeValidation') ? source.authoritativeValidation : true
  if (strict && validationRaw !== true) invalid('authoritativeValidation 不能关闭')
  const experience = {}
  for (const key of ['counterEnabled', 'disableVoice']) {
    if (own(source, key)) experience[key] = normalizedOrDefault(typeof source[key] === 'boolean', source[key], key === 'counterEnabled', strict, `${key} 必须是布尔值`)
  }

  return {
    mode,
    ...formatSettings,
    rounds,
    scoring,
    scoreVisibility,
    turnSeconds,
    trusteeSeconds,
    totalTimeMinutes,
    spectator,
    autoSort,
    disableInteraction,
    sortOrder,
    authoritativeValidation: true,
    ...experience,
  }
}

export const adjustDoubleDownSettlement = ({ result, state, previousTeamLevels, roomSettings }) => {
  if (!result || state.matchFormat || roomSettings.scoring !== 'double-4' || result.isGameWon) return result
  const [first, second] = result.fullRank || []
  if (!first || !second || state.players[first].team !== state.players[second].team) return result
  const winnerTeam = state.players[first].team
  const previousRank = previousTeamLevels[winnerTeam]
  const previousIndex = RANKS.indexOf(previousRank)
  if (previousIndex < 0 || previousRank === 'A') return result
  const nextIndex = Math.min(RANKS.length - 1, previousIndex + 4)
  const levelUp = nextIndex - previousIndex
  const nextRank = RANKS[nextIndex]
  return {
    ...result,
    winnerTeam,
    levelUp,
    currentLevel: nextRank,
    teamLevels: { ...result.teamLevels, [winnerTeam]: nextRank },
    message: `双下，本局升级 ${levelUp} 级。`,
  }
}

export const hasReachedRoundLimit = (roundSequence, roomSettings) => (
  roomSettings.format !== 'upgrade' && Number.isInteger(roundSequence) && roundSequence >= roomSettings.rounds
)

export const spectatorPolicyFor = (roomSettings) => ({
  mode: roomSettings.spectator,
  allowed: roomSettings.spectator !== 'off',
  delayRounds: roomSettings.spectator === 'delayed-round' ? 1 : 0,
})
