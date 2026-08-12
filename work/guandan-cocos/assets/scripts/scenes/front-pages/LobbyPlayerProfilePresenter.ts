import { Color, Node, sys, UITransform, Vec3 } from 'cc'
import type { GameSession } from '../../session/GameSession'
import type { ScreenAdapter } from '../../ui/ScreenAdapter'
import { resolveSafeHorizontalLane } from '../../ui/SafeAreaLayout'
import type { RuntimeUiFactory } from '../../ui/RuntimeUiFactory'
import type { FrontPagePlayerState } from './FrontPagePlayerState'
import type { FrontPageWalletState } from './FrontPageWalletState'
import { LOBBY_ART } from './LobbyPageCatalog'

const LOCAL_ACCOUNT_ID_STORAGE_KEY = 'guandan-local-account-id-v1'

export type LobbyPlayerProfileDependencies = Readonly<{
  screen: ScreenAdapter
  session: GameSession
  player: FrontPagePlayerState
  wallet: FrontPageWalletState
  platformConfigured: boolean
  showPlayerCenter: () => void
}>

/** Owns the safe horizontal account/performance lane and its local fallback identity. */
export class LobbyPlayerProfilePresenter {
  private readonly localAccountId = this.resolveLocalAccountId()

  public constructor (private readonly dependencies: LobbyPlayerProfileDependencies) {}

  public render (ui: RuntimeUiFactory, requestedRight: number): void {
    const { player, wallet, screen, platformConfigured } = this.dependencies
    const hasRemoteDashboard = player.dashboard !== null
    const awaitingRemoteDashboard = platformConfigured && !hasRemoteDashboard
    const stats = player.dashboard?.stats ?? this.dependencies.session.snapshot.playerStats
    const rating = player.dashboard?.rating
    const displayName = awaitingRemoteDashboard ? '账号同步中' : player.dashboard?.user.displayName.trim() || '陵水玩家'
    const remoteAccountId = player.dashboard?.user.accountId.trim() ?? ''
    const accountId = /^\d{8}$/.test(remoteAccountId) ? remoteAccountId : platformConfigured ? '同步中' : this.localAccountId
    const games = Math.max(0, rating?.games ?? stats.gamesPlayed)
    const wins = Math.max(0, rating?.wins ?? stats.wins)
    const rawWinRate = games > 0 ? wins * 100 / games : 0
    const rawWinRateText = awaitingRemoteDashboard ? '--' : games > 0 ? rawWinRate.toFixed(1) : '0'
    const comprehensiveScore = awaitingRemoteDashboard
      ? null
      : Math.round(rating?.comprehensiveScore ?? player.dashboard?.user.comprehensiveScore ?? this.fallbackComprehensiveScore(stats.elo, wins, games))
    const pointsText = platformConfigured && !wallet.fresh ? '积分 --' : `积分 ${Math.max(0, Math.round(wallet.value.points))}`
    const comprehensiveText = `综合分 ${comprehensiveScore ?? '--'}`
    const winRateText = `胜率 ${rawWinRateText}${rawWinRateText === '--' ? '' : '%'}`
    const gamesText = `场次 ${awaitingRemoteDashboard ? '--' : games}`
    const estimatedWidth = (text: string, fontSize: number, padding: number): number => Math.ceil(
      Array.from(text).reduce((width, character) => width + (/^[\u0000-\u00ff]$/.test(character) ? fontSize * 0.58 : fontSize), 0) + padding,
    )
    const identityWidth = Math.max(140, Math.min(190, Math.max(estimatedWidth(displayName, 20, 30), estimatedWidth(`ID ${accountId}`, 20, 24))))
    const left = screen.safeLeftX(14)
    const right = Math.max(left + 220, Math.min(requestedRight, screen.safeRightX(14)))
    const y = screen.safeTopY(52)
    const placements = resolveSafeHorizontalLane(left, right, [
      { id: 'avatar', preferredWidth: 64, minWidth: 60, priority: 100, canHide: false },
      { id: 'identity', preferredWidth: identityWidth, minWidth: 112, priority: 95, canHide: false },
      { id: 'points', preferredWidth: estimatedWidth(pointsText, 20, 38), minWidth: 94, priority: 85 },
      { id: 'win-rate', preferredWidth: estimatedWidth(winRateText, 20, 24), minWidth: 88, priority: 60 },
      { id: 'games', preferredWidth: estimatedWidth(gamesText, 20, 24), minWidth: 78, priority: 50 },
      { id: 'comprehensive', preferredWidth: estimatedWidth(comprehensiveText, 20, 24), minWidth: 108, priority: 90, canHide: false },
    ], 5)
    const place = (id: string) => placements.find(item => item.id === id)
    const avatar = place('avatar')
    if (avatar?.visible) {
      ui.panel('LobbyAvatarBacking', avatar.x, y, 64, 64, { fill: new Color(5, 9, 8, 178), lineWidth: 0, radius: 32 })
      ui.image('LobbyDefaultAvatar', LOBBY_ART.defaultAvatar, avatar.x, y, 58, 58)
    }
    const identity = place('identity')
    if (identity?.visible) {
      ui.panel('LobbyIdentityPill', identity.x, y, identity.width, 64, { fill: new Color(4, 8, 8, 172), lineWidth: 0, radius: 32 })
      ui.outlinedLabel(displayName, identity.x, y + 13, 20, { width: identity.width - 18, height: 28, color: new Color(255, 241, 178), outlineColor: new Color(46, 36, 24), outlineWidth: 3 })
      ui.outlinedLabel(`ID ${accountId}`, identity.x, y - 15, 20, { width: identity.width - 18, height: 28, color: new Color(225, 241, 235), outlineColor: new Color(30, 62, 62), outlineWidth: 2 })
    }
    const renderPill = (id: string, text: string, fontSize: number, color: Color): void => {
      const placement = place(id)
      if (!placement?.visible) return
      ui.panel(`Lobby-${id}-Pill`, placement.x, y, placement.width, 36, { fill: new Color(4, 8, 8, 172), lineWidth: 0, radius: 18 })
      ui.outlinedLabel(text, placement.x, y, fontSize, { width: placement.width - 12, height: 30, color, outlineColor: new Color(28, 36, 32), outlineWidth: 2 })
    }
    const points = place('points')
    if (points?.visible) {
      ui.panel('Lobby-points-Pill', points.x, y, points.width, 36, { fill: new Color(4, 8, 8, 172), lineWidth: 0, radius: 18 })
      const iconX = points.x - points.width / 2 + 15
      ui.image('LobbyCoinIcon', LOBBY_ART.coin, iconX, y, 22, 23)
      ui.outlinedLabel(pointsText, points.x + 10, y, 20, { width: Math.max(48, points.width - 30), height: 28, color: new Color(255, 238, 168), outlineColor: new Color(47, 49, 35), outlineWidth: 2 })
    }
    renderPill('win-rate', winRateText, 20, new Color(230, 239, 232))
    renderPill('games', gamesText, 20, new Color(230, 239, 232))
    renderPill('comprehensive', comprehensiveText, 20, new Color(137, 241, 204))
    const hitArea = new Node('LobbyPlayerProfileHitArea')
    hitArea.parent = ui.parent
    hitArea.setPosition(new Vec3((left + right) / 2, y, 2))
    hitArea.addComponent(UITransform).setContentSize(right - left, 70)
    hitArea.on(Node.EventType.TOUCH_END, this.dependencies.showPlayerCenter)
  }

  private resolveLocalAccountId (): string {
    const existing = sys.localStorage.getItem(LOCAL_ACCOUNT_ID_STORAGE_KEY)?.trim() ?? ''
    if (/^\d{8}$/.test(existing)) return existing
    const randomSource = globalThis as typeof globalThis & { crypto?: { getRandomValues?: (values: Uint32Array) => Uint32Array } }
    const randomValues = new Uint32Array(1)
    const random = randomSource.crypto?.getRandomValues
      ? randomSource.crypto.getRandomValues(randomValues)[0]
      : Math.floor(Math.random() * 0x1_0000_0000)
    const accountId = String(10_000_000 + random % 90_000_000)
    sys.localStorage.setItem(LOCAL_ACCOUNT_ID_STORAGE_KEY, accountId)
    return accountId
  }

  private fallbackComprehensiveScore (legacyElo: number, wins: number, games: number): number {
    const safeGames = Math.max(0, games)
    const adjustedWinRate = (Math.max(0, wins) + 25) / (safeGames + 50)
    const experience = 0.3 + 0.7 * Math.log1p(safeGames) / Math.log(101)
    const baseScore = 60_000 * Math.pow(adjustedWinRate, 1.8) * experience
    return Math.max(1_000, Math.round(baseScore + Math.max(0, legacyElo) - 1_000))
  }
}
