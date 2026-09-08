import { normalizeFriendRoomSettings } from './friend-room-settings.js'
import { botOpeningDelay } from './bot-turn-pacing.js'

/** Public turn deadline and private early automated wake-up are separate clocks. */
export const createTurnClock = ({
  clearTurnTimer, turnTimers, ensureLiveMetadata, deadlineStepFor, isBotPlayer, isMatchRoom,
  botActionDelayMs, friendSecondMs, trusteeActionDelayMs, turnTimeoutMs,
  now, scheduleTimeout, enqueueServerOperation, automatedDeadline, publishTurnStatus,
}) => {
  const schedule = (room, step, delay) => {
    const deadline = room.turnDeadlineAt
    turnTimers.set(room.roomId, scheduleTimeout(() => {
      void enqueueServerOperation(() => automatedDeadline(room, step.playerId, step.action, deadline), `automated turn ${room.roomId}`, room.roomId)
    }, Math.max(0, delay)))
  }
  const clearStep = room => {
    room.turnDeadlineAt = null
    room.deadlinePlayerId = null
    room.deadlineAction = null
    room.pendingBotPlay = null
    room.botWakeAt = null
  }
  const armTurnDeadline = (room, { publish = true } = {}) => {
    clearTurnTimer(room.roomId)
    ensureLiveMetadata(room)
    const step = deadlineStepFor(room)
    if (!step) { clearStep(room); return }
    const settings = normalizeFriendRoomSettings(room.roomSettings)
    const bot = isBotPlayer(room, step.playerId)
    if (!bot && !isMatchRoom(room) && settings.trusteeSeconds === 0) {
      clearStep(room)
      room.deadlinePlayerId = step.playerId
      room.deadlineAction = step.action
      if (publish) publishTurnStatus(room)
      return
    }
    const limit = isMatchRoom(room) ? turnTimeoutMs : settings.turnSeconds * friendSecondMs
    const delay = !bot && room.trustees[step.playerId]
      ? isMatchRoom(room) ? trusteeActionDelayMs : settings.trusteeSeconds > 0 ? settings.trusteeSeconds * friendSecondMs : limit
      : limit
    room.turnDeadlineAt = now() + delay
    room.deadlinePlayerId = step.playerId
    room.deadlineAction = step.action
    room.pendingBotPlay = null
    room.botTurnStartedAt = bot ? now() : null
    room.botWakeAt = bot ? now() + Math.min(delay, botOpeningDelay(botActionDelayMs)) : null
    schedule(room, step, bot ? room.botWakeAt - now() : delay)
    if (publish) publishTurnStatus(room)
  }
  const restoreTurnDeadline = room => {
    clearTurnTimer(room.roomId)
    const step = deadlineStepFor(room)
    if (!step) { clearStep(room); return }
    if (!isMatchRoom(room) && !isBotPlayer(room, step.playerId) && normalizeFriendRoomSettings(room.roomSettings).trusteeSeconds === 0) {
      armTurnDeadline(room)
      return
    }
    const deadline = Number(room.turnDeadlineAt)
    if (!Number.isFinite(deadline) || room.deadlinePlayerId !== step.playerId || room.deadlineAction !== step.action) {
      armTurnDeadline(room)
      return
    }
    const wake = isBotPlayer(room, step.playerId) ? room.pendingBotPlay?.at ?? room.botWakeAt ?? deadline : deadline
    schedule(room, step, Math.min(deadline, wake) - now())
  }
  return { armTurnDeadline, restoreTurnDeadline }
}
