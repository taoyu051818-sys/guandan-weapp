import type { PlayerId } from '../core/generated'
import type { CocosAudioController } from '../audio/CocosAudioController'
import type { EffectController } from '../effects/EffectController'
import type { GameManager } from '../game/GameManager'
import type { LobbyController } from '../network/LobbyController'
import type { GameSession } from '../session/GameSession'
import type { HandController } from '../ui/HandController'
import type { PlayAreaController } from '../ui/PlayAreaController'
import type { PlayerSeatController } from '../ui/PlayerSeatController'
import type { FrontPageController } from './FrontPageController'
import type { TableHandInteractionController } from './TableHandInteractionController'
import type { TableHudPresenter, TableMatchControls } from './TableHudPresenter'
import type { TableOverlayController } from './TableOverlayController'
import type { TableTurnClockController } from './TableTurnClockController'

/** Capabilities used by table orchestration, not ownership of entire controllers. */
export type TableMatchCoordinatorDependencies = Readonly<{
  session: Pick<GameSession, 'snapshot' | 'leaveToMenu'>
  manager: Pick<GameManager, 'node' | 'abortRound' | 'applyServerState' | 'applyNetworkRoundPrepared' | 'applyNetworkRoundEnded' | 'applyNetworkError' | 'applyNetworkResult'>
  lobby: Pick<LobbyController, 'events' | 'snapshot' | 'safeExit' | 'cancelRoundReady' | 'readyNextRound' | 'cancelTrustee' | 'setTrustee'>
  audio: Pick<CocosAudioController, 'playRoundStart' | 'playEvent'>
  effects: Pick<EffectController, 'waitForPresentation' | 'syncActions' | 'resetForRecovery'>
  hand: Pick<HandController, 'node' | 'render' | 'consumeEntranceCompletion' | 'finishEntrances'>
  playArea: Pick<PlayAreaController, 'setSeatOrder' | 'getActionWorldPosition' | 'deferAction' | 'beginAction' | 'revealCard' | 'revealAction' | 'resetPresentation' | 'render'>
  playerSeats: ReadonlyMap<string, Pick<PlayerSeatController, 'node' | 'getPlayOriginWorldPosition' | 'render' | 'clearConnectionStatus' | 'setOffline'>>
  frontPages: Pick<FrontPageController, 'hideAll' | 'showMenu' | 'handoffFriendRoomReservation' | 'showRecoveryMenu' | 'showClassicRooms' | 'renderLobby' | 'isTournamentRoom' | 'showTournament'>
  overlays: Pick<TableOverlayController, 'showToast' | 'clearModal' | 'clearDialogs'>
  turnClock: Pick<TableTurnClockController, 'reset' | 'update'>
  handInteraction: Pick<TableHandInteractionController, 'submit' | 'clearSuitPreview' | 'invalidateAuthoritativeHand' | 'resetForRound' | 'canInteractWithCurrentHand'>
  hud: Pick<TableHudPresenter, 'render' | 'mounted'>
  controls: TableMatchControls
  controlsY: () => number
  renderDuplicateStatus?: () => void
  layoutSeats: (humanId: PlayerId) => void
  setTableVisible: (visible: boolean) => void
  setFriendRoomWaitingVisible: (visible: boolean) => void
}>
