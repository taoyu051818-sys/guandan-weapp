import { createRoomExpiryJobs } from './weapp-room-expiry-jobs.js'

/** One retryable two-commit transaction for timer and unanimous-vote closures. */
export const createRoomCloseCoordinator = ({ rooms, hasConnectedHuman, rememberClosedRoomTombstone,
  reportSpectatorClosed, commitRuntimeState, stagePendingSideEffects, persistRuntimeState,
  finalizeRemovedRoom, enqueueServerOperation, setTimeout = globalThis.setTimeout, clearTimeout = globalThis.clearTimeout }) => {
  const jobs = createRoomExpiryJobs({ rooms, enqueueServerOperation, setTimeout, clearTimeout })
  const intents = new WeakMap()
  const close = async (room, reason, eventType = 'roomDissolved', spectatorReason = reason, acceptance = null) => {
    if (rooms.get(room.roomId) !== room) return
    if (!room.closingReason && reason === 'empty-timeout' && hasConnectedHuman(room)) return
    let intent = intents.get(room)
    if (!intent) {
      intent = { reason: room.closingReason || reason, eventType, spectatorReason, acceptance, accepted: null }
      intents.set(room, intent)
    }
    try {
      rememberClosedRoomTombstone(room)
      if (!room.closingReason) {
        if (!intent.acceptance) room.version += 1 // Vote commands already incremented.
        room.closingReason = intent.reason
        reportSpectatorClosed(room, intent.spectatorReason)
      }
      // Always re-establish intent durability before staging, including retries
      // where closingReason was set by an earlier unsuccessful commit.
      await commitRuntimeState()
      stagePendingSideEffects(room)
      if (intent.acceptance && !intent.accepted) intent.accepted = intent.acceptance.remember(room)
      rooms.delete(room.roomId)
      try { await commitRuntimeState() } catch (error) {
        rooms.set(room.roomId, room)
        persistRuntimeState()
        throw error
      }
      jobs.cancel('close', room.roomId)
      intents.delete(room)
      try { if (intent.accepted) intent.acceptance.send(intent.accepted) }
      finally { finalizeRemovedRoom(room, intent.reason, intent.eventType, intent.acceptance?.cacheKey || null) }
    } catch (error) {
      if (rooms.get(room.roomId) === room) jobs.schedule('close', room, 500, () => close(room, intent.reason, intent.eventType, intent.spectatorReason))
      throw error
    }
  }
  return { close, dispose: jobs.dispose }
}
