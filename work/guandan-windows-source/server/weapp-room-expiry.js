import { createRoomExpiryJobs } from './weapp-room-expiry-jobs.js'

/** Room expiry policy. Timer leases and queued-job cancellation have a separate owner. */
export const createRoomExpiry = ({ rooms, seatHasLiveConnection, hasConnectedHuman, enqueueServerOperation, closeRoomWithoutAck, commitRuntimeState, publishDissolveVote, emptyRoomTimeoutMs: EMPTY_ROOM_TIMEOUT_MS, setTimeout = globalThis.setTimeout, clearTimeout = globalThis.clearTimeout }) => {
  const jobs = createRoomExpiryJobs({ rooms, enqueueServerOperation, setTimeout, clearTimeout })
  const clearDissolveTimer = roomId => jobs.cancel('dissolve', roomId)
  const clearEmptyRoomExpiry = roomId => jobs.cancel('empty room', roomId)
  const clearHostExpiry = roomId => jobs.cancel('host', roomId)
  const scheduleEmptyRoomExpiry = room => {
    clearEmptyRoomExpiry(room.roomId)
    if (!room.state || hasConnectedHuman(room)) return
    jobs.schedule('empty room', room, EMPTY_ROOM_TIMEOUT_MS, () => {
      if (!hasConnectedHuman(room)) return closeRoomWithoutAck(room, 'empty-timeout')
    })
  }
  const scheduleHostExpiry = (roomId, timeoutMs = 15000) => {
    clearHostExpiry(roomId)
    const room = rooms.get(roomId)
    if (!room) return
    jobs.schedule('host', room, timeoutMs, () => {
      // Recheck inside the serialized operation, not just when the timer fires.
      const host = room.friendMembers?.find(member => member.userId === room.friendHostUserId)
      if (host ? !host.connectionId : !seatHasLiveConnection(room, 'p1')) return closeRoomWithoutAck(room, 'host-left', 'hostLeft')
    })
  }
  const scheduleDissolveExpiry = (room, retryDelay) => {
    clearDissolveTimer(room.roomId)
    const vote = room.dissolveVote
    if (!vote?.expiresAt) return
    const expiresAt = vote.expiresAt
    jobs.schedule('dissolve', room, retryDelay ?? expiresAt - Date.now(), async current => {
      if (room.dissolveVote !== vote || vote.expiresAt !== expiresAt) return
      const version = room.version
      room.dissolveVote = null
      room.version = version + 1
      try { await commitRuntimeState() }
      catch (error) {
        // This job holds the room queue. Roll back the complete transition and retry
        // the business operation, not just the disk write (which cannot publish).
        room.dissolveVote = vote
        room.version = version
        if (current()) scheduleDissolveExpiry(room, 1000)
        throw error
      }
      if (current()) publishDissolveVote(room, 'expired')
    })
  }
  return { clearHostExpiry, clearEmptyRoomExpiry, clearDissolveTimer, scheduleHostExpiry, scheduleEmptyRoomExpiry, scheduleDissolveExpiry, dispose: jobs.dispose }
}
