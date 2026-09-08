import type { BuiltTableSceneNodes } from '../../assets/scripts/scenes/TableSceneNodes'
import type { TableMatchCoordinatorDependencies } from '../../assets/scripts/scenes/TableMatchPorts'
import type { FrontPagePlayerState } from '../../assets/scripts/scenes/front-pages/FrontPagePlayerState'

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
