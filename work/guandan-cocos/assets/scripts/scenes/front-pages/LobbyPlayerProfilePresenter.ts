import { Color, Label, Node, UITransform, Vec3 } from 'cc'
import type { LobbyLayout } from '../../ui/LobbyLayoutPolicy'
import { lobbyLabel } from '../../ui/LobbyMenuView'
import type { RuntimeUiFactory } from '../../ui/RuntimeUiFactory'
import type { FrontPagePlayerState } from './FrontPagePlayerState'
import type { FrontPageWalletState } from './FrontPageWalletState'
import { LOBBY_ART } from './LobbyPageCatalog'
import { mountProfileAvatar } from '../../ui/ProfileAvatar'
import type { AuthGateway } from '../../services/FrontPageGatewayContracts'

export type LobbyPlayerProfileDependencies = Readonly<{
  player: FrontPagePlayerState
  wallet: FrontPageWalletState
  platformConfigured: boolean
  showPlayerCenter: () => void
  editProfile: () => void
  auth: AuthGateway
}>

/** One translucent account backing; details belong to the player center. */
export class LobbyPlayerProfilePresenter {
  public constructor (private readonly dependencies: LobbyPlayerProfileDependencies) {}

  public render (ui: RuntimeUiFactory, layout: LobbyLayout): void {
    const { player, wallet, platformConfigured } = this.dependencies
    const profile = player.profile ?? player.dashboard?.user
    const name = platformConfigured && !profile ? '账号同步中' : profile?.displayName.trim() || '陵水玩家'
    const characters = Array.from(name)
    const displayName = characters.length > 5 ? characters.slice(0, 4).join('') + '…' : name
    const points = platformConfigured && !wallet.fresh ? '--' : String(Math.max(0, Math.round(wallet.value.points)))
    const s = layout.scale, r = layout.account
    ui.panel('LobbyAccountBacking', r.x, r.y, r.width, r.height, {
      fill: new Color(16, 44, 61, 102), lineWidth: 0, frame: 'tag', frameScale: s,
    })
    const avatar = layout.point(32, 35)
    ui.panel('LobbyAvatarBacking', avatar.x, avatar.y, 44 * s, 44 * s, {
      fill: new Color(20, 51, 65), stroke: new Color(250, 233, 180), lineWidth: s, frame: 'control', frameScale: s,
    })
    mountProfileAvatar(ui.parent, profile, this.dependencies.auth, avatar.x, avatar.y, 40 * s)
    const leftText = (text: string, x: number, y: number, size: number, width: number): void => {
      const p = layout.point(x + width / 2, y)
      const label = lobbyLabel(ui, text, p.x, p.y, size, width * s, s, undefined, new Color(255, 244, 211), .6)
      label.horizontalAlign = Label.HorizontalAlign.LEFT
      label.overflow = Label.Overflow.SHRINK
    }
    leftText(displayName, 63, 25, 17, 110)
    const coin = layout.point(71, 48)
    ui.image('LobbyCoinIcon', LOBBY_ART.coin, coin.x, coin.y, 17 * s, 18 * s)
    leftText(points, 87, 48, 15, 69)
    const hit = (name: string, x: number, width: number, action: () => void): void => {
      const node = new Node(name), position = layout.point(x, 35)
      node.parent = ui.parent
      node.setPosition(new Vec3(position.x, position.y, 2))
      node.addComponent(UITransform).setContentSize(width * s, 44 * s)
      node.on(Node.EventType.TOUCH_END, action)
    }
    hit('LobbyPlayerProfileHitArea', 123.5, 121, this.dependencies.showPlayerCenter)
    hit('EditOwnAvatar', 32, 44, this.dependencies.editProfile)
  }
}
