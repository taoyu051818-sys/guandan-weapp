import { Label, Node, UITransform, Vec3 } from 'cc'
import type { PlayerId } from '../core/generated'
import type { PlayerSeatController } from '../ui/PlayerSeatController'
import type { ScreenAdapter, TableViewport } from '../ui/ScreenAdapter'
import { TABLE_HUD_TURN_OPERATION_ANCHORS } from '../ui/TableHudLayoutPolicy'
import type { TableSceneNodes } from './TableSceneNodes'

/** Geometry only; caller retains lifecycle, refresh order and business state. */
export function layoutTableNodes (
  viewport: TableViewport, screen: ScreenAdapter | null, nodes: TableSceneNodes,
  effectRoots: Array<Node | null>, hudMounted: boolean,
): void {
  const safeWidth = viewport.width - viewport.safeLeft - viewport.safeRight
  const controlsY = TABLE_HUD_TURN_OPERATION_ANCHORS.bottom.y
  nodes.hand?.node.setPosition(new Vec3(0, screen?.safeBottomY(112) ?? -248, 0))
  nodes.hand?.node.getComponent(UITransform)?.setContentSize(Math.max(300, safeWidth - 380), 150)
  nodes.playArea?.node.getComponent(UITransform)?.setContentSize(Math.max(300, safeWidth - 360), Math.max(300, viewport.height - 270))
  nodes.playArea?.layout(viewport)
  ;effectRoots.forEach(root => root?.getComponent(UITransform)?.setContentSize(viewport.width, viewport.height))
  nodes.overlayLabel?.node.setPosition(Vec3.ZERO)
  nodes.overlayLabel?.node.getComponent(UITransform)?.setContentSize(
    Math.max(280, Math.min(860, safeWidth - 64)),
    Math.max(140, Math.min(300, viewport.height - viewport.safeTop - viewport.safeBottom - 180)),
  )
  if (nodes.overlayLabel) {
    nodes.overlayLabel.overflow = Label.Overflow.SHRINK
    nodes.overlayLabel.enableWrapText = true
    nodes.overlayLabel.verticalAlign = Label.VerticalAlign.CENTER
  }
  if (!hudMounted) {
    nodes.hintButton?.setPosition(new Vec3(-126, controlsY, 0))
    nodes.passButton?.setPosition(new Vec3(0, controlsY, 0))
    nodes.playButton?.setPosition(new Vec3(126, controlsY, 0))
  }
  nodes.confirmTributeButton?.setPosition(new Vec3(0, controlsY, 0))
  nodes.finishTributeButton?.setPosition(new Vec3(0, controlsY, 0))
  nodes.nextRoundButton?.setPosition(new Vec3(0, controlsY, 0))
  nodes.levelLabel?.node.setPosition(new Vec3(screen?.safeLeftX(165) ?? -475, screen?.safeTopY(92) ?? 268, 0))
  nodes.levelLabel?.node.getComponent(UITransform)?.setContentSize(300, 38)
  if (nodes.levelLabel) nodes.levelLabel.horizontalAlign = Label.HorizontalAlign.LEFT
  nodes.trusteeButton?.setPosition(new Vec3(screen?.safeRightX(70) ?? 570, controlsY + 54, 0))
  nodes.skipEffectButton?.setPosition(new Vec3(screen?.safeRightX(90) ?? 550, screen?.safeTopY(40) ?? 320, 0))
}

export function layoutTableSeats (
  humanId: PlayerId, screen: ScreenAdapter | null, seats: ReadonlyMap<string, PlayerSeatController>,
): void {
  const order: Array<'p1' | 'p2' | 'p3' | 'p4'> = ['p1', 'p2', 'p3', 'p4']
  const humanIndex = order.indexOf(humanId)
  const positions = screen
    ? [new Vec3(0, screen.safeBottomY(90), 0), new Vec3(screen.safeRightX(105), 22, 0), new Vec3(-220, 218, 0), new Vec3(screen.safeLeftX(105), 22, 0)]
    : [new Vec3(0, -260, 0), new Vec3(510, 35, 0), new Vec3(-220, 218, 0), new Vec3(-510, 35, 0)]
  order.forEach((id, index) => {
    const slot = (index - humanIndex + 4) % 4
    const seat = seats.get(id)
    seat?.node.setPosition(positions[slot])
    seat?.setChatBubbleAbove(slot !== 2)
  })
}
