import { Label, Node, UITransform, Vec3 } from 'cc'
import { HandController } from '../ui/HandController'
import { PlayAreaController } from '../ui/PlayAreaController'
import { PlayerSeatController } from '../ui/PlayerSeatController'
import type { RuntimeUiFactory } from '../ui/RuntimeUiFactory'

/** Only node references: no session, networking, rules, timers or event subscriptions. */
export type TableSceneNodes = {
  hand: HandController | null
  playArea: PlayAreaController | null
  hintLabel: Label | null
  phaseLabel: Label | null
  overlayLabel: Label | null
  levelLabel: Label | null
  countdownLabel: Label | null
  playButton: Node | null
  passButton: Node | null
  hintButton: Node | null
  confirmTributeButton: Node | null
  finishTributeButton: Node | null
  nextRoundButton: Node | null
  trusteeButton: Node | null
  skipEffectButton: Node | null
  playerSeats: Map<string, PlayerSeatController>
}

/** After assembly every binding exists; callers must not handle it as partial input. */
export type BuiltTableSceneNodes = { readonly [K in keyof TableSceneNodes]: NonNullable<TableSceneNodes[K]> }

/** Reuses Inspector bindings; creates only missing fallback nodes. */
export function buildTableSceneNodes (root: Node, ui: RuntimeUiFactory, nodes: TableSceneNodes): BuiltTableSceneNodes {
  if (!nodes.hand) {
    const handNode = new Node('HumanHand')
    handNode.parent = root
    handNode.setPosition(new Vec3(0, -265, 0))
    handNode.addComponent(UITransform).setContentSize(1040, 150)
    nodes.hand = handNode.addComponent(HandController)
  }
  if (!nodes.playArea) {
    const playNode = new Node('PlayArea')
    playNode.parent = root
    playNode.addComponent(UITransform).setContentSize(900, 420)
    nodes.playArea = playNode.addComponent(PlayAreaController)
  }
  ;(['p1', 'p2', 'p3', 'p4'] as const).forEach(id => {
    if (nodes.playerSeats.has(id)) return
    const seat = new Node(`Seat-${id}`)
    seat.parent = root
    seat.setPosition(new Vec3(0, 0, 0))
    nodes.playerSeats.set(id, seat.addComponent(PlayerSeatController))
  })
  nodes.hintLabel ??= ui.label('Hint', 410, -123, 24)
  nodes.hintLabel.node.getComponent(UITransform)?.setContentSize(420, 38)
  nodes.hintLabel.overflow = Label.Overflow.SHRINK
  nodes.hintLabel.verticalAlign = Label.VerticalAlign.CENTER
  nodes.phaseLabel ??= ui.label('Phase', 0, 282, 30)
  nodes.levelLabel ??= ui.label('Level', -475, 268, 18)
  nodes.levelLabel.node.getComponent(UITransform)?.setContentSize(300, 38)
  nodes.levelLabel.horizontalAlign = Label.HorizontalAlign.LEFT
  nodes.countdownLabel ??= ui.label('ActionCountdown', 0, -126, 22)
  nodes.countdownLabel.node.getComponent(UITransform)?.setContentSize(100, 38)
  nodes.countdownLabel.node.active = false
  nodes.overlayLabel ??= ui.label('Overlay', 0, 42, 30)
  nodes.passButton ??= ui.button('PassButton', '不要', -185, 112, 54, 28)
  nodes.hintButton ??= ui.button('HintButton', '提示', -62, 112, 54, 28)
  nodes.playButton ??= ui.button('PlayButton', '出牌', 70, 128, 58, 28)
  nodes.confirmTributeButton ??= ui.button('ConfirmTributeButton', '确认贡牌', 0)
  nodes.finishTributeButton ??= ui.button('FinishTributeButton', '开始本局', 0)
  nodes.nextRoundButton ??= ui.button('NextRoundButton', '下一局', 0)
  nodes.trusteeButton ??= ui.button('TrusteeButton', '托管', 535, 112, 44, 18)
  nodes.trusteeButton.active = false
  nodes.skipEffectButton ??= ui.button('SkipEffectButton', '跳过动画', 0, 132, 42, 18)
  nodes.skipEffectButton.active = false

  return {
    hand: nodes.hand, playArea: nodes.playArea,
    hintLabel: nodes.hintLabel, phaseLabel: nodes.phaseLabel, overlayLabel: nodes.overlayLabel,
    levelLabel: nodes.levelLabel, countdownLabel: nodes.countdownLabel,
    playButton: nodes.playButton, passButton: nodes.passButton, hintButton: nodes.hintButton,
    confirmTributeButton: nodes.confirmTributeButton, finishTributeButton: nodes.finishTributeButton,
    nextRoundButton: nodes.nextRoundButton, trusteeButton: nodes.trusteeButton,
    skipEffectButton: nodes.skipEffectButton, playerSeats: nodes.playerSeats,
  }
}
