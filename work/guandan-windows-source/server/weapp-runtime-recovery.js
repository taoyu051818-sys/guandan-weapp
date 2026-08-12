/** Restores durable room state and re-arms each room's owning lifecycle. */
export const restoreWeAppRuntime = async ({
  roomStateStore,
  rooms,
  acceptedActions,
  closedRoomTombstones,
  maxAcceptedActions,
  playerIds,
  roomFromPersistence,
  migrateLegacyMatchState,
  ensureTicketBindings,
  ensureLobbyMetadata,
  ensureLiveMetadata,
  rulePresetForRoom,
  ruleProfileForRoom,
  syncRoomFromMatchState,
  botPolicyForRoom,
  resetRoomBotPolicy,
  stagePendingSideEffects,
  rememberClosedRoomTombstone,
  removeRoomBotPolicy,
  scheduleDissolveExpiry,
  schedulePendingRoundFinalization,
  gameStartCoordinator,
  restoreTurnDeadline,
  armMatchDuration,
  scheduleEmptyRoomExpiry,
  scheduleHostExpiry,
  commitRuntimeState,
  now = Date.now,
  log = console,
}) => {
  if (!roomStateStore.configured) return 0
  const stored = roomStateStore.load()
  for (const tombstone of stored.closedRoomTombstones || []) {
    if (!tombstone || !/^\d{6}$/.test(String(tombstone.roomId || '')) || typeof tombstone.matchId !== 'string' || !tombstone.matchId || !Number.isSafeInteger(tombstone.until)) {
      throw new Error('牌局恢复文件包含无效关闭房间索引')
    }
    if (tombstone.until > now()) closedRoomTombstones.set(tombstone.roomId, tombstone)
  }
  for (const entry of stored.acceptedActions.slice(-maxAcceptedActions)) {
    const accepted = entry?.[1]
    if (Array.isArray(entry) && typeof entry[0] === 'string' && typeof accepted?.fingerprint === 'string' && accepted.response && typeof accepted.response === 'object') {
      acceptedActions.set(entry[0], { ...accepted, pendingDurability: false })
    }
  }
  for (const rawRoom of stored.rooms) {
    if (!rawRoom || !/^\d{6}$/.test(String(rawRoom.roomId || ''))) throw new Error('牌局恢复文件包含无效房间号')
    if (rooms.has(String(rawRoom.roomId))) throw new Error(`牌局恢复文件包含重复房间 ${rawRoom.roomId}`)
    const room = roomFromPersistence(rawRoom)
    ensureTicketBindings(room)
    ensureLobbyMetadata(room)
    ensureLiveMetadata(room)
    if (!room.resumeTokens || !playerIds.every(id => Object.prototype.hasOwnProperty.call(room.resumeTokens, id))) {
      throw new Error(`牌局恢复文件中的房间 ${room.roomId} 缺少恢复凭证结构`)
    }
    if (!Number.isSafeInteger(room.version) || room.version < 0) room.version = 0
    if (!Number.isSafeInteger(room.gameVersion) || room.gameVersion < 0) room.gameVersion = room.state ? room.version : 0
    room.rulePreset = rulePresetForRoom(room)
    if (!room.pendingGameStartEvent) room.pendingGameStartRequest = null
    if (room.ticketBound && !Number.isFinite(Number(room.entryDeadlineAt))) {
      const expirations = Object.values(room.ticketExpiresAtBySeat || {}).filter(Number.isFinite)
      room.entryDeadlineAt = expirations.length ? Math.max(...expirations) * 1000 : null
    }
    if (room.state) {
      room.state = migrateLegacyMatchState({
        state: room.state,
        ruleProfile: ruleProfileForRoom(room),
        gameVersion: room.gameVersion,
        roundSequence: room.roundSequence,
        teamLevels: room.teamLevels,
        aFailStreaks: room.aFailStreaks,
        scores: room.scores,
        lastRoundRank: room.lastRoundRank,
        roundResult: room.roundResult,
        tribute: room.tribute,
      })
      syncRoomFromMatchState(room)
      room.tribute = null
      if (room.botPolicyCheckpoint) {
        try { botPolicyForRoom(room) } catch (error) {
          log.warn(`Discarding invalid bot checkpoint for ${room.roomId}:`, error instanceof Error ? error.message : error)
          resetRoomBotPolicy(room)
        }
      }
      playerIds.forEach(id => {
        if (room.resumeTokens[id] && !room.trustees[id]) room.trustees[id] = { reason: 'disconnected', since: now() }
        if (room.dissolveVote?.votes?.[id] === 'pending') room.dissolveVote.votes[id] = 'offline'
      })
    }
    rooms.set(room.roomId, room)
    gameStartCoordinator.restoreClaim(room)
    stagePendingSideEffects(room)
    if (room.closingReason) {
      rememberClosedRoomTombstone(room)
      rooms.delete(room.roomId)
      removeRoomBotPolicy(room.roomId)
      continue
    }
    if (room.dissolveVote) scheduleDissolveExpiry(room)
    if (room.pendingRoundFinalization) schedulePendingRoundFinalization(room, 0)
    if (room.pendingGameStartEvent) {
      gameStartCoordinator.scheduleEntryDeadline(room)
      gameStartCoordinator.scheduleClaim(room)
    } else if (room.state) {
      if (!room.roundResult && !room.matchEnded) restoreTurnDeadline(room)
      armMatchDuration(room)
      scheduleEmptyRoomExpiry(room)
    } else if (room.ticketBound) gameStartCoordinator.scheduleEntryDeadline(room)
    else scheduleHostExpiry(room.roomId, 15000)
  }
  await commitRuntimeState()
  log.log(`Restored ${rooms.size} WeApp room(s) from ${roomStateStore.filePath}`)
  return rooms.size
}
