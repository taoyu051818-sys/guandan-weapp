import { badRequest } from './errors.js'

const seats = ['p1', 'p2', 'p3', 'p4']
const friendRoomKind = 'friend-room'
const spectatorEventTypes = new Set([
  'game-start', 'round-start', 'tribute-start', 'tribute', 'return-tribute',
  'anti-tribute', 'play-start', 'play', 'pass', 'round-end', 'match-ended', 'seat-left', 'room-closed',
])
const spectatorPlayTypes = new Set(['Single', 'Pair', 'Triple', 'Straight', 'TripleWithPair', 'Tube', 'Plate', 'StraightFlush', 'Bomb', 'Rocket'])
const spectatorRanks = new Set([2, 3, 4, 5, 6, 7, 8, 9, 10, 'J', 'Q', 'K', 'A', 'Small', 'Big'])
const spectatorSuits = new Set(['spade', 'heart', 'club', 'diamond', 'joker'])
const spectatorCloseReasons = new Set(['empty-timeout', 'dissolved', 'entry-timeout', 'host-left', 'server-shutdown', 'start-participant-lost', 'start-rejected'])
const spectatorSeatLeaveReasons = new Set(['left', 'kicked'])
const friendMatchEndReasons = new Set(['round-limit', 'time-limit'])
const spectatorEventKeys = new Set([
  'eventId', 'matchId', 'roomId', 'sequence', 'at', 'type', 'roundSequence',
  'playerId', 'cards', 'playType', 'automatic', 'ranking', 'winnerTeam',
  'isGameWon', 'reason', 'userId', 'scores', 'roundsPlayed', 'endedAt', 'friendRoster',
])
const spectatorCardKeys = new Set(['rank', 'suit'])
const friendMatchScoresKeys = new Set(['teamA', 'teamB'])
const spectatorFutureToleranceMs = 60_000
const spectatorMatchClockSkewMs = 5 * 60_000
const spectatorPostStartTypes = new Set([
  'round-start', 'tribute-start', 'tribute', 'return-tribute', 'anti-tribute',
  'play-start', 'play', 'pass', 'round-end', 'match-ended',
])
const spectatorCommonKeys = ['eventId', 'matchId', 'roomId', 'sequence', 'at', 'type', 'roundSequence']
const spectatorKeysByType = {
  'game-start': new Set([...spectatorCommonKeys, 'friendRoster']),
  'round-start': new Set(spectatorCommonKeys),
  'tribute-start': new Set(spectatorCommonKeys),
  tribute: new Set([...spectatorCommonKeys, 'playerId']),
  'return-tribute': new Set([...spectatorCommonKeys, 'playerId']),
  'anti-tribute': new Set(spectatorCommonKeys),
  'play-start': new Set(spectatorCommonKeys),
  play: new Set([...spectatorCommonKeys, 'playerId', 'cards', 'playType', 'automatic']),
  pass: new Set([...spectatorCommonKeys, 'playerId', 'automatic']),
  'round-end': new Set([...spectatorCommonKeys, 'ranking', 'winnerTeam', 'isGameWon']),
  'match-ended': new Set([...spectatorCommonKeys, 'reason', 'scores', 'roundsPlayed', 'endedAt', 'winnerTeam']),
  'seat-left': new Set([...spectatorCommonKeys, 'playerId', 'reason', 'userId']),
  'room-closed': new Set([...spectatorCommonKeys, 'reason']),
}

const normalizeText = (value, fallback, maxLength) => {
  const text = typeof value === 'string' ? value.trim() : ''
  return (text || fallback).slice(0, maxLength)
}

const assertOnlyKeys = (record, allowed, code, message) => {
  if (!record || typeof record !== 'object' || Array.isArray(record)) throw badRequest(code, message)
  const unexpected = Object.keys(record).find(key => !allowed.has(key))
  if (unexpected) throw badRequest(code, `${message}：不允许字段 ${unexpected}`)
}

const normalizeSpectatorCard = (card) => {
  assertOnlyKeys(card, spectatorCardKeys, 'INVALID_SPECTATOR_CARD', '公开牌面字段无效')
  if (!spectatorRanks.has(card.rank) || !spectatorSuits.has(card.suit)) throw badRequest('INVALID_SPECTATOR_CARD', '公开牌面点数或花色无效')
  return { rank: card.rank, suit: card.suit }
}

const spectatorTableLabel = (matchId, mode) => {
  const modeLabel = ({
    quick: '快速匹配',
    classic_50: '经典场 · 底分50',
    classic_300: '经典场 · 底分300',
    classic_2000: '经典场 · 底分2000',
    classic_10000: '经典场 · 底分10000',
    rookie_cup: '新手赛',
    weekend_cup: '周末赛',
    master_cup: '大师赛',
  })[mode] || '联机牌桌'
  return `${modeLabel} · ${String(matchId).slice(-6).toUpperCase()}桌`
}

const spectatorTerminalSequenceComplete = (record, events = record.events) => {
  const expected = record.finalSpectatorSequence
  if (record.abortedAt) {
    if (!Number.isSafeInteger(expected) || expected === 0) return true
    const finalEvent = events.find(event => event.sequence === expected)
    return finalEvent?.type === 'room-closed' || (finalEvent?.type === 'match-ended' && finalEvent.reason === 'time-limit')
  }
  if (!record.finishedAt) return false
  // Legacy producers without an explicit fence still have to deliver a semantic
  // terminal event. Missing metadata must never make a partial timeline complete.
  if (!Number.isSafeInteger(expected)) {
    const finalEvent = events.at(-1)
    return finalEvent?.type === 'round-end' && finalEvent.isGameWon === true
  }
  if (expected === 0) return true
  const finalEvent = events.find(event => event.sequence === expected)
  return (finalEvent?.type === 'round-end' && finalEvent.isGameWon === true) ||
    (finalEvent?.type === 'match-ended' && finalEvent.reason === 'round-limit')
}

export const normalizeSpectatorDelay = (value) => Math.max(15, Math.min(300, Number(value) || 30))

export const normalizeSpectatorEvent = (eventId, rawEvent, now) => {
  assertOnlyKeys(rawEvent, spectatorEventKeys, 'INVALID_SPECTATOR_EVENT', '观战事件字段无效')
  if (!eventId || rawEvent.eventId !== eventId) throw badRequest('EVENT_ID_MISMATCH', '观战事件ID请求头与正文不一致')
  const matchId = typeof rawEvent.matchId === 'string' ? rawEvent.matchId.trim() : ''
  if (!matchId || matchId.length > 128 || !/^[A-Za-z0-9:_-]+$/.test(matchId)) throw badRequest('INVALID_MATCH_ID', '观战事件 matchId 无效')
  if (!/^\d{6}$/.test(String(rawEvent.roomId || ''))) throw badRequest('INVALID_ROOM_ID', '观战事件 roomId 无效')
  const sequence = Number(rawEvent.sequence)
  if (!Number.isSafeInteger(sequence) || sequence < 1 || sequence > 100_000) throw badRequest('INVALID_SPECTATOR_SEQUENCE', '观战事件 sequence 无效')
  if (eventId !== `spectate:${matchId}:${sequence}`) throw badRequest('INVALID_SPECTATOR_EVENT_ID', '观战事件ID必须与 matchId 和 sequence 一致')
  const at = Number(rawEvent.at)
  if (!Number.isSafeInteger(at) || at < 0 || at > now + spectatorFutureToleranceMs) throw badRequest('INVALID_SPECTATOR_TIME', '观战事件时间无效或超出允许窗口')
  if (!spectatorEventTypes.has(rawEvent.type)) throw badRequest('INVALID_SPECTATOR_TYPE', '不支持的观战事件类型')
  assertOnlyKeys(rawEvent, spectatorKeysByType[rawEvent.type], 'INVALID_SPECTATOR_EVENT', `${rawEvent.type} 观战事件字段无效`)
  const roundSequence = Number(rawEvent.roundSequence)
  if (!Number.isSafeInteger(roundSequence) || roundSequence < 1 || roundSequence > 1000) throw badRequest('INVALID_ROUND_SEQUENCE', '观战事件 roundSequence 无效')
  const event = { eventId, matchId, roomId: String(rawEvent.roomId), sequence, at, type: rawEvent.type, roundSequence }
  if (rawEvent.friendRoster !== undefined) {
    assertOnlyKeys(rawEvent.friendRoster, new Set(seats), 'INVALID_FRIEND_ROSTER', '开局席位表无效')
    if (!seats.every(seat => typeof rawEvent.friendRoster[seat] === 'string' && /^[A-Za-z0-9_-]{1,256}$/.test(rawEvent.friendRoster[seat]))) throw badRequest('INVALID_FRIEND_ROSTER', '开局席位身份无效')
    event.friendRoster = { ...rawEvent.friendRoster }
  }

  if (rawEvent.type === 'tribute' || rawEvent.type === 'return-tribute') {
    if (!seats.includes(rawEvent.playerId)) throw badRequest('INVALID_SPECTATOR_PLAYER', '贡还动作席位无效')
    event.playerId = rawEvent.playerId
  }

  if (rawEvent.type === 'play' || rawEvent.type === 'pass') {
    if (!seats.includes(rawEvent.playerId)) throw badRequest('INVALID_SPECTATOR_PLAYER', '公开动作席位无效')
    if (typeof rawEvent.automatic !== 'boolean') throw badRequest('INVALID_SPECTATOR_AUTOMATION', '公开动作必须声明是否为自动操作')
    event.playerId = rawEvent.playerId
    event.automatic = rawEvent.automatic
  }
  if (rawEvent.type === 'play') {
    if (!Array.isArray(rawEvent.cards) || rawEvent.cards.length < 1 || rawEvent.cards.length > 27) throw badRequest('INVALID_SPECTATOR_CARDS', '公开出牌必须包含 1 到 27 张牌')
    if (!spectatorPlayTypes.has(rawEvent.playType)) throw badRequest('INVALID_SPECTATOR_PLAY_TYPE', '公开出牌牌型无效')
    event.cards = rawEvent.cards.map(normalizeSpectatorCard)
    event.playType = rawEvent.playType
  }
  if (rawEvent.type === 'round-end') {
    if (!Array.isArray(rawEvent.ranking) || rawEvent.ranking.length !== 4 || new Set(rawEvent.ranking).size !== 4 || !rawEvent.ranking.every(seat => seats.includes(seat))) {
      throw badRequest('INVALID_SPECTATOR_RANKING', '公开局结算必须包含不重复的 p1 到 p4')
    }
    if (!['teamA', 'teamB'].includes(rawEvent.winnerTeam) || typeof rawEvent.isGameWon !== 'boolean') throw badRequest('INVALID_SPECTATOR_RESULT', '公开局结算结果无效')
    event.ranking = [...rawEvent.ranking]
    event.winnerTeam = rawEvent.winnerTeam
    event.isGameWon = rawEvent.isGameWon
  }
  if (rawEvent.type === 'seat-left') {
    if (roundSequence !== 1) throw badRequest('INVALID_FRIEND_SEAT_ROUND', '好友房开局前离席事件 roundSequence 必须为 1')
    if (![...seats, 'observer'].includes(rawEvent.playerId)) throw badRequest('INVALID_SPECTATOR_PLAYER', '好友房离席位置无效')
    if (!spectatorSeatLeaveReasons.has(rawEvent.reason)) throw badRequest('INVALID_FRIEND_SEAT_LEAVE_REASON', '好友房离席原因只支持 left 或 kicked')
    const userId = typeof rawEvent.userId === 'string' ? rawEvent.userId.trim() : ''
    if (!userId || userId.length > 128 || !/^[A-Za-z0-9:_-]+$/.test(userId)) throw badRequest('INVALID_FRIEND_SEAT_USER', '好友房离席用户无效')
    event.playerId = rawEvent.playerId
    event.reason = rawEvent.reason
    event.userId = userId
  }
  if (rawEvent.type === 'match-ended') {
    if (!friendMatchEndReasons.has(rawEvent.reason)) throw badRequest('INVALID_FRIEND_MATCH_END_REASON', '好友房结束原因只支持 round-limit 或 time-limit')
    assertOnlyKeys(rawEvent.scores, friendMatchScoresKeys, 'INVALID_FRIEND_MATCH_SCORES', '好友房结束比分无效')
    const teamA = Number(rawEvent.scores.teamA)
    const teamB = Number(rawEvent.scores.teamB)
    if (![teamA, teamB].every(score => Number.isSafeInteger(score) && score >= 0 && score <= 100_000)) {
      throw badRequest('INVALID_FRIEND_MATCH_SCORES', '好友房结束比分必须是 0 到 100000 的整数')
    }
    const roundsPlayed = Number(rawEvent.roundsPlayed)
    if (!Number.isSafeInteger(roundsPlayed) || roundsPlayed < 0 || roundsPlayed > 1000) {
      throw badRequest('INVALID_FRIEND_MATCH_ROUNDS', '好友房已完成局数必须是 0 到 1000 的整数')
    }
    const endedAt = Number(rawEvent.endedAt)
    if (
      !Number.isSafeInteger(endedAt) ||
      endedAt < 0 ||
      endedAt > now + spectatorFutureToleranceMs ||
      endedAt > at + spectatorFutureToleranceMs
    ) {
      throw badRequest('INVALID_FRIEND_MATCH_ENDED_AT', '好友房结束时间无效或超出允许窗口')
    }
    if (rawEvent.winnerTeam !== null && !['teamA', 'teamB'].includes(rawEvent.winnerTeam)) {
      throw badRequest('INVALID_FRIEND_MATCH_WINNER', '好友房结束胜方必须是 teamA、teamB 或 null')
    }
    event.reason = rawEvent.reason
    event.scores = { teamA, teamB }
    event.roundsPlayed = roundsPlayed
    event.endedAt = endedAt
    event.winnerTeam = rawEvent.winnerTeam
  }
  if (rawEvent.type === 'room-closed') {
    if (!spectatorCloseReasons.has(rawEvent.reason)) throw badRequest('INVALID_SPECTATOR_CLOSE_REASON', '牌桌终止原因无效')
    event.reason = rawEvent.reason
  }
  return event
}

export const validateSpectatorEventMatchTime = (event, match) => {
  const createdAt = Number(match.createdAt)
  const matchedAt = Number(match.matchedAt)
  const startedAt = Number(match.startedAt)
  const anchor = spectatorPostStartTypes.has(event.type) && Number.isSafeInteger(startedAt)
    ? startedAt
    : (event.type === 'game-start' && Number.isSafeInteger(matchedAt) ? matchedAt : createdAt)
  if (Number.isSafeInteger(anchor) && event.at < anchor - spectatorMatchClockSkewMs) {
    throw badRequest('SPECTATOR_EVENT_BEFORE_MATCH', '观战事件时间早于对应牌局生命周期')
  }
  if (event.type === 'seat-left') {
    const roomExpiresAt = Number(match.friendRoomExpiresAt)
    if (Number.isSafeInteger(roomExpiresAt) && event.at > roomExpiresAt + spectatorMatchClockSkewMs) {
      throw badRequest('FRIEND_SEAT_EVENT_AFTER_LEASE', '好友房离席事件时间晚于房间租约')
    }
  }
}

export const publicSpectatorEvent = ({ eventId: _eventId, matchId: _matchId, roomId: _roomId, userId: _userId, ...event }) => event

export const sanitizeSpectatorTimeline = (timeline, finishedAt) => {
  if (!Array.isArray(timeline)) return []
  return timeline.slice(0, 500).map((raw, index) => {
    const event = raw && typeof raw === 'object' ? raw : {}
    const playerId = seats.includes(event.playerId) ? event.playerId : undefined
    const cards = Array.isArray(event.cards)
      ? event.cards.slice(0, 27).map(card => ({ rank: normalizeText(card?.rank, '?', 8), suit: normalizeText(card?.suit, '', 12) }))
      : undefined
    return {
      sequence: index + 1,
      at: Number.isFinite(Number(event.at)) ? Number(event.at) : Number(finishedAt || 0),
      type: normalizeText(event.type, 'action', 32),
      ...(playerId ? { playerId } : {}),
      ...(cards?.length ? { cards } : {}),
      ...(typeof event.text === 'string' ? { text: event.text.trim().slice(0, 80) } : {}),
    }
  })
}

export const createSpectatorRecord = (state, matchId) => {
  const match = state.matches[matchId]
  const feed = state.spectatorFeeds[matchId]
  if (match?.kind === friendRoomKind && match.roomSettings?.spectator === 'off') return null
  if (!feed && (!match || !['matched', 'playing', 'completed', 'aborted'].includes(match.status))) return null
  return {
    matchId,
    mode: normalizeText(feed?.mode || match?.mode, 'quick', 40),
    startedAt: Number(feed?.gameStartedAt || match?.startedAt || feed?.startedAt || match?.matchedAt || match?.createdAt || 0),
    finishedAt: Number(feed?.finishedAt || match?.completedAt || 0) || null,
    abortedAt: Number(feed?.abortedAt || match?.abortedAt || 0) || null,
    abortReason: normalizeText(feed?.abortReason || match?.abortReason, '', 32) || null,
    matchEnd: feed?.matchEnd || match?.friendMatchEnd || null,
    finalSpectatorSequence: Number.isSafeInteger(feed?.finalSpectatorSequence) ? feed.finalSpectatorSequence : null,
    events: Array.isArray(feed?.events) ? feed.events : [],
  }
}

export const createPublicSpectatorSummary = (record, delaySeconds, now) => {
  const availableThrough = now - delaySeconds * 1000
  const terminalAt = record.finishedAt || record.abortedAt
  const visibleEvents = record.events.filter(event => event.at <= availableThrough)
  const terminalVisible = Boolean(
    terminalAt &&
    terminalAt <= availableThrough &&
    spectatorTerminalSequenceComplete(record, visibleEvents)
  )
  return {
    matchId: record.matchId,
    tableLabel: spectatorTableLabel(record.matchId, record.mode),
    mode: record.mode,
    status: terminalVisible ? (record.abortedAt ? 'aborted' : 'finished') : 'running',
    startedAt: record.startedAt,
    finishedAt: terminalVisible ? record.finishedAt : null,
    abortedAt: terminalVisible ? record.abortedAt : null,
    abortReason: terminalVisible ? record.abortReason : null,
    matchEnd: terminalVisible && record.matchEnd ? structuredClone(record.matchEnd) : null,
    delaySeconds,
    availableEventCount: visibleEvents.length,
    totalEventCount: visibleEvents.length,
    timelineComplete: terminalVisible,
  }
}
