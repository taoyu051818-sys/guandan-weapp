import { Color, Node, UITransform, Vec3 } from 'cc'
import { lobbyDockLabelY, type LobbyLayout } from './LobbyLayoutPolicy'
import type { SceneExclusionRect } from './WechatCapsuleLayout'
import { RuntimeUiFactory } from './RuntimeUiFactory'
import { lobbyLabel } from './LobbyMenuView'
import { drawLobbyServiceIcon } from './LobbyServiceIcons'
import { lobbyServiceRects, type LobbyServiceId } from './LobbyServicePolicy'

export function renderLobbyServices (ui: RuntimeUiFactory, layout: LobbyLayout,
  onSelect: (id: LobbyServiceId) => void, capsule?: SceneExclusionRect): void {
  const s = layout.scale
  for (const service of lobbyServiceRects(layout, capsule)) {
    const node = new Node(`LobbyService-${service.id}`)
    node.parent = ui.parent
    node.setPosition(new Vec3(service.x, service.y, 0))
    node.addComponent(UITransform).setContentSize(service.width, service.height)
    drawLobbyServiceIcon(node, service.id, s * (service.row === 'top' ? 2/3 : 7/9))
    const local = new RuntimeUiFactory(node)
    const labelY = service.row === 'top' ? -16 : lobbyDockLabelY(service.height / s, 12)
    const label = lobbyLabel(local, service.label, 0, labelY * s, 12,
      service.width, s, node, new Color(35, 72, 92), .45)
    label.outlineColor = new Color(255, 249, 232, 140)
    ui.makeInteractive(node, () => onSelect(service.id), .94)
  }
}
