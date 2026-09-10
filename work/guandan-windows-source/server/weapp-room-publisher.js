import { normalizeFriendRoomSettings, spectatorPolicyFor } from './friend-room-settings.js'
import { stateForViewer, tributeForViewer } from './game-session-projection.js'
import { registerRoomMember, friendMemberMetadata } from './friend-room-members.js'
import { canConfigureRoomBots } from './friend-room-bots.js'

export const phaseForRoom = room => room.matchEnded || room.roundResult || room.state?.phase === 'settled'
  ? 'settlement'
  : room.state?.phase === 'tribute'
    ? 'tribute'
    : room.state ? 'playing' : 'lobby'

/**
 * Projects authoritative room state into viewer-safe protocol messages. This
 * module never advances the game or persists state; its only mutation hook is
 * the supplied metadata normalizer used by the existing server lifecycle.
 */
export const createRoomPublisher = ({
  playerIds,
  connections,
  send,
  broadcast,
  ensureLobbyMetadata,
  ensureLiveMetadata,
  isFriendRoom,
  seatIsOccupied,
  captureObservers = () => {},
  publishObservers = () => {},
}) => {
  const lobbyMetadataFor = room => {
    ensureLobbyMetadata(room)
    return {
      lobbyReadyRequired: isFriendRoom(room),
      lobbyReadyPlayerIds: playerIds.filter(id => room.lobbyReady[id]),
      botPlayerIds: [...room.botPlayerIds],
      entryKind: room.entryKind,
      gameStartPending: Boolean(room.pendingGameStartEvent),
      capabilities: {
        canUseBots: canConfigureRoomBots(room),
        canKickMembers: isFriendRoom(room),
        requiresLobbyReady: isFriendRoom(room),
      },
    }
  }

  const viewerRoundStatsFor = (room, playerId) => ({
    bombsPlayed: Math.max(0, Number(room.roundStatsBySeat?.[playerId]?.bombsPlayed) || 0),
  })

  const liveMetadataFor = room => {
    ensureLiveMetadata(room)
    const roomSettings = normalizeFriendRoomSettings(room.roomSettings)
    return {
      turnDeadlineAt: room.turnDeadlineAt,
      deadlinePlayerId: room.deadlinePlayerId,
      deadlineAction: room.deadlineAction,
      trustees: structuredClone(room.trustees),
      consecutiveTimeouts: { ...room.consecutiveTimeouts },
      roundReadyPlayerIds: playerIds.filter(id => room.roundReady[id]),
      dissolveVote: structuredClone(room.dissolveVote),
      botPlayerIds: [...room.botPlayerIds],
      roomSettings,
      matchStartedAt: room.matchStartedAt,
      totalDeadlineAt: room.totalDeadlineAt,
      matchEnded: structuredClone(room.matchEnded),
      spectatorPolicy: spectatorPolicyFor(roomSettings),
      gameVersion: room.gameVersion,
      scoreboard: roomSettings.scoreVisibility === 'live'
        ? {
            roundsPlayed: Math.max(0, Number(room.roundSequence) || 0),
            currentLevel: room.roundResult?.currentLevel ?? room.state?.currentLevel ?? 2,
            teamLevels: { ...(room.teamLevels || { teamA: 2, teamB: 2 }) },
          }
        : null,
    }
  }

  const roomMembersPayload = room => ({
    roomId: room.roomId,
    memberPlayerIds: playerIds.filter(id => seatIsOccupied(room, id)),
    version: room.version,
    gameVersion: room.gameVersion,
    roomSettings: normalizeFriendRoomSettings(room.roomSettings),
    ...lobbyMetadataFor(room),
  })

  const memberMetadataFor = (room, playerId) => {
    const member = registerRoomMember(room, playerId)
    return member ? friendMemberMetadata(room, member) : {}
  }
  const entryPayloadFor = (room, playerId) => ({
    roomId: room.roomId,
    myPlayerId: playerId,
    resumeToken: room.resumeTokens[playerId],
    state: room.pendingGameStartEvent && isFriendRoom(room) ? null : (room.state ? stateForViewer(room.state, playerId) : null),
    tribute: room.pendingGameStartEvent && isFriendRoom(room) ? null : tributeForViewer(room.state, playerId),
    roundResult: structuredClone(room.roundResult || null),
    phase: room.pendingGameStartEvent && isFriendRoom(room) ? 'lobby' : phaseForRoom(room),
    version: room.version,
    gameVersion: room.gameVersion,
    viewerRoundStats: viewerRoundStatsFor(room, playerId),
    roomSettings: normalizeFriendRoomSettings(room.roomSettings),
    ...lobbyMetadataFor(room),
    ...liveMetadataFor(room),
    ...memberMetadataFor(room, playerId),
  })

  const forEachViewer = (room, publish) => playerIds.forEach(playerId => {
    const connection = connections.get(room.seats[playerId])
    if (connection) publish(connection, playerId)
  })

  const gameStatePayload = (room, playerId) => ({
    roomId: room.roomId,
    state: stateForViewer(room.state, playerId),
    version: room.version,
    phase: phaseForRoom(room),
    // A playable authoritative snapshot also terminates any earlier
    // gameStartPending projection held by clients.
    gameStartPending: false,
    tribute: tributeForViewer(room.state, playerId),
    roundResult: structuredClone(room.roundResult || null),
    viewerRoundStats: viewerRoundStatsFor(room, playerId),
    ...liveMetadataFor(room),
  })

  const publishState = room => { forEachViewer(room, (connection, playerId) => {
    send(connection, 'gameState', gameStatePayload(room, playerId))
  }); captureObservers(room, gameStatePayload(room, 'p1')) }
  const publishTribute = (room, type = 'tributeUpdated') => { forEachViewer(room, (connection, playerId) => {
    send(connection, type, gameStatePayload(room, playerId))
  }); captureObservers(room, gameStatePayload(room, 'p1')) }
  const publishRoundEnded = (room, result) => { forEachViewer(room, (connection, playerId) => {
    send(connection, 'roundEnded', {
      roomId: room.roomId,
      state: stateForViewer(room.state, playerId),
      result: structuredClone(result),
      roundResult: structuredClone(result),
      phase: phaseForRoom(room),
      version: room.version,
      gameVersion: room.gameVersion,
      viewerRoundStats: viewerRoundStatsFor(room, playerId),
      ...liveMetadataFor(room),
    })
  }); captureObservers(room, gameStatePayload(room, 'p1')) }
  const publishTurnStatus = room => broadcast(room, 'turnDeadline', {
    roomId: room.roomId,
    currentTurn: room.deadlineAction === 'play' ? room.deadlinePlayerId : null,
    version: room.version,
    ...liveMetadataFor(room),
  })
  const publishTrustees = room => broadcast(room, 'trusteeUpdated', {
    roomId: room.roomId,
    version: room.version,
    ...liveMetadataFor(room),
  })
  const publishRoundReady = room => broadcast(room, 'roundReadyUpdated', {
    roomId: room.roomId,
    version: room.version,
    ...liveMetadataFor(room),
  })
  const publishRoomMembers = room => { broadcast(room, 'roomMembers', roomMembersPayload(room)); publishObservers(room) }
  const publishLobbyReady = room => { broadcast(room, 'lobbyReadyUpdated', {
    roomId: room.roomId,
    version: room.version,
    gameVersion: room.gameVersion,
    roomSettings: normalizeFriendRoomSettings(room.roomSettings),
    ...lobbyMetadataFor(room),
  }); publishObservers(room) }
  const publishDissolveVote = (room, outcome = null) => broadcast(room, 'dissolveVoteUpdated', {
    roomId: room.roomId,
    version: room.version,
    gameVersion: room.gameVersion,
    dissolveVote: structuredClone(room.dissolveVote),
    outcome,
  })

  return {
    entryPayloadFor,
    liveMetadataFor,
    publishDissolveVote,
    publishLobbyReady,
    publishRoomMembers,
    publishRoundEnded,
    publishRoundReady,
    publishState,
    publishTribute,
    publishTrustees,
    publishTurnStatus,
  }
}
