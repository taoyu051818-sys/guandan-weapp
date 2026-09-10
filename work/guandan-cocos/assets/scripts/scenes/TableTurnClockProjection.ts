import type { PlayerId } from '../core/generated'
import type { GameSnapshot } from '../game/GameManager'
import type { LobbySnapshot } from '../network/LobbyController'
import type { TableGameHudSeatPlace, TableGameHudState } from '../ui/TableGameHud'

export type TableTurnClockProjection = Pick<TableGameHudState,
  'turnVisible' | 'turnSeconds' | 'turnDurationSeconds' | 'turnPlace'>
const PLACES: readonly TableGameHudSeatPlace[] = ['bottom', 'right', 'top', 'left']

/** Server data and wall time are the only inputs; visibility never comes from a UI node. */
export function projectTurnClock (
  snapshot: GameSnapshot, humanId: PlayerId, lobby: LobbySnapshot | null,
  multiplayer: boolean, now: number,
): TableTurnClockProjection {
  const activePlayerId = multiplayer && lobby?.deadlinePlayerId
    ? lobby.deadlinePlayerId : snapshot.state.currentTurn
  const order = snapshot.state.turnOrder
  const activeIndex = order.indexOf(activePlayerId)
  const viewerIndex = order.indexOf(humanId)
  const hasSeats = activeIndex >= 0 && viewerIndex >= 0
  const turnVisible = Boolean(multiplayer && lobby?.roomStatus === 'ready'
    && !lobby.matchEnded && !snapshot.actionPending
    && (snapshot.phase === 'playing' || snapshot.phase === 'tribute')
    && Number.isFinite(lobby.turnDeadlineAt) && lobby.turnDeadlineAt !== null
    && lobby.deadlinePlayerId && lobby.deadlineAction && hasSeats && Number.isFinite(now))
  return {
    turnVisible,
    turnSeconds: turnVisible ? Math.max(0, Math.ceil((lobby!.turnDeadlineAt! - now) / 1000)) : 0,
    turnDurationSeconds: multiplayer ? lobby?.roomSettings?.turnSeconds ?? 20 : 20,
    turnPlace: hasSeats ? PLACES[(activeIndex - viewerIndex + 4) % 4] : 'bottom',
  }
}
