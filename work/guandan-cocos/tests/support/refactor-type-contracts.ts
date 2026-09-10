import type { BuiltTableSceneNodes } from '../../assets/scripts/scenes/TableSceneNodes'
import type { TableMatchCoordinatorDependencies } from '../../assets/scripts/scenes/TableMatchPorts'
import type { FrontPagePlayerState } from '../../assets/scripts/scenes/front-pages/FrontPagePlayerState'
import type { HandInteractionState } from '../../assets/scripts/game/HandInteractionState'
import type { HandLockDecision } from '../../assets/scripts/game/HandWorkspace'
import type { GameSnapshot, GameManager } from '../../assets/scripts/game/GameManager'
import type { RoundViewPhase } from '../../assets/scripts/game/RoundViewState'

declare const roundSnapshot: GameSnapshot
declare const manager: GameManager
// @ts-expect-error snapshots cannot replace authoritative state
roundSnapshot.state.currentTurn = 'p2'
// @ts-expect-error the authority is replaced only by its network owner
manager.state = roundSnapshot.state
// @ts-expect-error tribute must carry tribute data
const missingTribute: RoundViewPhase = { phase: 'tribute', tribute: null, settlement: null }
// @ts-expect-error playing cannot carry a settlement
const contradictoryPhase: RoundViewPhase = { phase: 'playing', tribute: null, settlement: {} }
import type { TableGameHudState } from '../../assets/scripts/ui/TableGameHudFoundation'

declare const nodes: BuiltTableSceneNodes
declare const ports: TableMatchCoordinatorDependencies
declare const player: FrontPagePlayerState

// Assembly output is complete, without optional chains or non-null assertions.
nodes.hand.finishEntrances()
nodes.hintLabel.string = ''
// New responsibilities must be deliberately added to the capability contract.
ports.audio.playRoundStart()
// @ts-expect-error coordinator does not own audio lifecycle
ports.audio.dispose()
// @ts-expect-error coordinator does not own arbitrary lobby methods
ports.lobby.destroy()
// @ts-expect-error state replacement must pass through its owner
player.dashboard = null
if (player.dashboard) {
  // @ts-expect-error nested snapshot data is read-only
  player.dashboard.user.displayName = 'bypass'
  // @ts-expect-error nested arrays are read-only too
  player.dashboard.recentMatches.push({})
}

// Derived states cannot encode contradictory mode/reason pairs.
// @ts-expect-error an interactive mode has no block reason
const blockedPlay: HandInteractionState = { mode: 'play', blockReason: 'pending' }
// @ts-expect-error a blocked mode must explain why it is blocked
const unexplainedBlock: HandInteractionState = { mode: 'blocked', blockReason: null }
// @ts-expect-error unavailable lock decisions always carry a reason
const unexplainedLock: HandLockDecision = { kind: 'unavailable' }
// @ts-expect-error a valid lock decision cannot carry a failure reason
const contradictoryLock: HandLockDecision = { kind: 'lock', reason: 'empty-selection' }
// @ts-expect-error the former edit/commit state model is retired
const retiredLock: HandLockDecision = { kind: 'commit' }
declare const lockDecision: HandLockDecision
const hudLock: Pick<TableGameHudState, 'lockDecision'> = { lockDecision }
if (hudLock.lockDecision.kind === 'unavailable') {
  const reason: string = hudLock.lockDecision.reason
  void reason
}
