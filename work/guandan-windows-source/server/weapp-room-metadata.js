import { createGameStatsBySeat, ensureGameStatsBySeat } from './game-stats.js'
import { normalizeFriendRoomSettings } from './friend-room-settings.js'
import { roomPlayerNicknames } from './player-nicknames.js'
import { botUserIdsBySeatFromClaims, ensureMatchBotMetadata } from './weapp-match-bot-seats.js'
/** Owns this runtime responsibility; dependencies are injected by the server composition root. */
export const createRoomMetadata = ({ playerIds: ids, createResumeToken, createBotSeed, entryKindForClaims, entryDeadlineForClaims }) => {
  const createRoomRecord = ({ roomId, hostName = '等待房主', hostConnectionId = null, ticketClaims = null, roomSettings = null }) => {
    const botUserIdsBySeat = botUserIdsBySeatFromClaims(ticketClaims)
    const userIdsBySeat = { p1: null, p2: null, p3: null, p4: null }
    const ticketJtisBySeat = { p1: null, p2: null, p3: null, p4: null }
    const ticketExpiresAtBySeat = { p1: null, p2: null, p3: null, p4: null }
    if (ticketClaims?.seat) userIdsBySeat[ticketClaims.seat] = ticketClaims.sub
    if (ticketClaims?.seat) ticketJtisBySeat[ticketClaims.seat] = ticketClaims.jti
    if (ticketClaims?.seat) ticketExpiresAtBySeat[ticketClaims.seat] = ticketClaims.exp
    return {
      roomId,
      hostName,
      ...(ticketClaims?.hostUserId ? { friendHostUserId: ticketClaims.hostUserId } : {}),
      roomSettings: normalizeFriendRoomSettings(roomSettings ?? ticketClaims?.roomSettings),
      rulePreset: 'classic',
      seats: { p1: hostConnectionId, p2: null, p3: null, p4: null },
      resumeTokens: { p1: hostConnectionId ? createResumeToken() : null, p2: null, p3: null, p4: null },
      userIdsBySeat,
      ticketJtisBySeat,
      ticketExpiresAtBySeat,
      matchId: ticketClaims?.matchId || null,
      matchMode: ticketClaims?.matchMode,
      ticketBound: Boolean(ticketClaims),
      entryKind: ticketClaims ? entryKindForClaims(ticketClaims) : 'friend',
      botPlayerIds: ids.slice(1).filter(id => Object.hasOwn(botUserIdsBySeat, id)),
      botUserIdsBySeat,
      botSeed: createBotSeed(),
      botPolicyCheckpoint: null,
      state: null,
      matchStartedAt: null,
      totalDeadlineAt: null,
      matchEnded: null,
      tribute: null,
      roundResult: null,
      teamLevels: { teamA: 2, teamB: 2 },
      aFailStreaks: { teamA: 0, teamB: 0 },
      scores: { teamA: 0, teamB: 0 },
      lastRoundRank: [],
      roundSequence: 0,
      spectatorSequence: 0,
      pendingSpectatorEvents: [],
      pendingResultEvent: null,
      pendingRoundFinalization: null,
      pendingGameStartEvent: null,
      pendingGameStartRequest: null,
      gameStartClaimedAt: null,
      gameStartReconnectDeadlineAt: null,
      entryDeadlineAt: ticketClaims ? entryDeadlineForClaims(ticketClaims) : null,
      closingReason: null,
      revokedFriendUserIds: [],
      revokedTicketJtis: [],
      turnDeadlineAt: null,
      deadlinePlayerId: null,
      deadlineAction: null,
      trustees: { p1: null, p2: null, p3: null, p4: null },
      consecutiveTimeouts: { p1: 0, p2: 0, p3: 0, p4: 0 },
      lobbyReady: { p1: false, p2: false, p3: false, p4: false },
      roundReady: { p1: false, p2: false, p3: false, p4: false },
      dissolveVote: null,
      chatLastAcceptedAt: { p1: 0, p2: 0, p3: 0, p4: 0 },
      chatLastPhraseAt: { p1: {}, p2: {}, p3: {}, p4: {} },
      statsBySeat: createGameStatsBySeat(),
      roundStatsBySeat: createGameStatsBySeat(),
      version: 0,
      gameVersion: 0,
    }
  }
  const ensureBotMetadata = (room) => {
    ensureMatchBotMetadata(room)
  }
  const isBotPlayer = (room, playerId) => {
    ensureBotMetadata(room)
    return room.botPlayerIds.includes(playerId)
  }
  const ensureLobbyMetadata = (room) => {
    ensureBotMetadata(room)
    room.lobbyReady ||= { p1: false, p2: false, p3: false, p4: false }
    ids.forEach(id => { room.lobbyReady[id] = Boolean(room.lobbyReady[id]) })
    room.botPlayerIds.forEach(id => { room.lobbyReady[id] = true })
  }
  const ensureLiveMetadata = (room) => {
    ensureBotMetadata(room)
    room.trustees ||= { p1: null, p2: null, p3: null, p4: null }
    room.consecutiveTimeouts ||= { p1: 0, p2: 0, p3: 0, p4: 0 }
    room.roundReady ||= { p1: false, p2: false, p3: false, p4: false }
    room.turnDeadlineAt ??= null
    room.deadlinePlayerId ??= null
    room.deadlineAction ??= null
    room.dissolveVote ??= null
    room.matchStartedAt ??= null
    room.totalDeadlineAt ??= null
    room.matchEnded ??= null
    room.pendingSpectatorEvents = Array.isArray(room.pendingSpectatorEvents) ? room.pendingSpectatorEvents : []
    room.pendingResultEvent ??= null
    room.pendingRoundFinalization ??= null
    room.pendingGameStartEvent ??= null
    room.pendingGameStartRequest ??= null
    room.gameStartClaimedAt = Number.isSafeInteger(room.gameStartClaimedAt) ? room.gameStartClaimedAt : null
    room.gameStartReconnectDeadlineAt = Number.isSafeInteger(room.gameStartReconnectDeadlineAt)
      ? room.gameStartReconnectDeadlineAt
      : null
    room.entryDeadlineAt ??= null
    room.closingReason ??= null
    room.entryKind = room.ticketBound && room.entryKind !== 'friend' ? 'match' : 'friend'
    room.revokedFriendUserIds = Array.isArray(room.revokedFriendUserIds)
      ? [...new Set(room.revokedFriendUserIds.filter(userId => typeof userId === 'string' && userId))]
      : []
    const nowSeconds = Math.floor(Date.now() / 1000)
    room.revokedTicketJtis = Array.isArray(room.revokedTicketJtis)
      ? room.revokedTicketJtis.filter(item => (
          item && typeof item.jti === 'string' && item.jti && Number.isFinite(item.exp) && item.exp > nowSeconds
        ))
      : []
    room.statsBySeat = ensureGameStatsBySeat(room.statsBySeat)
    room.roundStatsBySeat = ensureGameStatsBySeat(room.roundStatsBySeat)
    room.roomSettings = normalizeFriendRoomSettings(room.roomSettings)
    if (room.state?.players) {
      const nicknames = roomPlayerNicknames(room)
      ids.forEach(id => {
        if (!isBotPlayer(room, id)) return
        room.state.players[id].isAI = true
        room.state.players[id].name = nicknames[id]
      })
    }
  }
  return { createRoomRecord, isBotPlayer, ensureBotMetadata, ensureLobbyMetadata, ensureLiveMetadata }
}
