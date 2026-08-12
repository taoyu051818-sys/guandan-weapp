import { Graphics, type Label, Node, Sprite, SpriteFrame, Texture2D, UITransform } from 'cc'
import type { PlayerId, Rank } from '../core/generated'
import type { GameSnapshot } from '../game/GameManager'
import type { LobbySnapshot } from '../network/LobbyController'
import { loadGameAsset, type GameAssetLoadCancel } from '../services/GameAssetLoader'
import { requestClassicCardFrame } from '../ui/ClassicCardFrameStore'
import {
  TABLE_GAME_HUD_COUNTER_RANKS,
  TableGameHud,
  type TableGameHudActions,
  type TableGameHudCounterRank,
  type TableGameHudSeatPlace,
  type TableGameHudState,
  type TableGameHudSuit,
  type TableGameHudViewport,
} from '../ui/TableGameHud'
import type { TableHandProjection } from './TableHandInteractionController'
import { projectTableViewer } from './TableSnapshotPresenter'
import type { TableTurnClockProjection } from './TableTurnClockController'

const TABLE_TIMER_ART_ASSET = 'ui/table/chicken-timer-frame/texture'
const DEFAULT_AVATAR_ART_ASSET = 'ui/common/default-avatar/texture'
const PLAYER_ORDER: readonly PlayerId[] = ['p1', 'p2', 'p3', 'p4']
const PLAYER_PLACES: readonly TableGameHudSeatPlace[] = ['bottom', 'right', 'top', 'left']

export type TableHudPresenterDependencies = Readonly<{
  root: Node
  actions: TableGameHudActions
  lobbySnapshot: () => LobbySnapshot | null
  isMultiplayer: () => boolean
  turnClock: (snapshot: GameSnapshot, humanId: PlayerId) => TableTurnClockProjection | null
}>

export type TableHudMountOptions = Readonly<{
  turnActionNodes: readonly (Node | null | undefined)[]
  legacyLabels: readonly (Label | null | undefined)[]
  legacySeatNodes: readonly Node[]
}>

/** Owns authoritative HUD projection, presentation assets and HUD-only state. */
export class TableHudPresenter {
  private tableHud: TableGameHud | null = null
  private counterExpanded = true
  private generation = 0
  private timerLoadCancel: GameAssetLoadCancel | null = null
  private avatarLoadCancel: GameAssetLoadCancel | null = null

  public constructor (private readonly dependencies: TableHudPresenterDependencies) {}

  public get hud (): TableGameHud | null { return this.tableHud }
  public get node (): Node | null { return this.tableHud?.node ?? null }
  public get mounted (): boolean { return Boolean(this.tableHud) }
  public get visible (): boolean { return Boolean(this.tableHud?.node?.active) }

  public mount (options: TableHudMountOptions): Node {
    if (this.tableHud?.node) return this.tableHud.node
    const generation = ++this.generation
    const hud = new TableGameHud({
      ...this.dependencies.actions,
      onCounterVisibilityChange: expanded => {
        this.counterExpanded = expanded
        this.dependencies.actions.onCounterVisibilityChange?.(expanded)
      },
    })
    this.tableHud = hud
    const hudNode = hud.mount(this.dependencies.root)
    hud.setTurnActionNodes(options.turnActionNodes)
    options.turnActionNodes.forEach(node => { if (node) node.active = false })
    hud.setVisible(false)
    options.legacyLabels.forEach(label => { if (label) label.enabled = false })
    options.legacySeatNodes.forEach(node => {
      const panel = node.getComponent(Graphics)
      if (panel) panel.enabled = false
      const text = node.getChildByName('SeatText')
      if (text) text.active = false
    })
    this.requestTimerArtwork(generation)
    this.requestAvatarArtwork(generation)
    this.requestSuitArtwork(generation)
    return hudNode
  }

  public render (snapshot: GameSnapshot, humanId: PlayerId, hand: TableHandProjection): void {
    if (!this.tableHud) return
    const turnClock = this.dependencies.turnClock(snapshot, humanId) ?? {
      turnVisible: false,
      turnSeconds: 0,
      turnDurationSeconds: 20,
      turnPlace: 'bottom' as const,
    }
    const humanIndex = PLAYER_ORDER.indexOf(humanId)
    const lobby = this.dependencies.lobbySnapshot()
    const teamLevels = lobby?.scoreboard?.teamLevels ?? snapshot.teamLevels
    const viewer = projectTableViewer(snapshot.state.players, humanId, teamLevels, snapshot.settlement?.winnerTeam ?? null)
    const ranking = snapshot.settlement?.fullRank ?? snapshot.state.finishedPlayers
    const rankNames = ['头游', '二游', '三游', '末游']
    const multiplayer = Boolean(this.dependencies.isMultiplayer() && lobby?.roomId)
    const members = new Set(lobby?.members ?? PLAYER_ORDER)
    const seats = PLAYER_ORDER.map((id, index) => {
      const player = snapshot.state.players[id]
      const finishPlace = ranking.indexOf(id) + 1
      return {
        place: PLAYER_PLACES[(index - humanIndex + 4) % 4],
        name: id === humanId ? `${player.name}（我）` : player.name,
        status: finishPlace > 0 ? rankNames[finishPlace - 1] : `剩${player.hand.length}张`,
        avatarText: player.name,
        active: snapshot.phase === 'playing' && snapshot.state.currentTurn === id,
        offline: multiplayer && !members.has(id),
      }
    })
    this.tableHud.render({
      matchLabel: `本局打 ${String(snapshot.state.currentLevel)}`,
      levelLabel: `我方 ${String(viewer.viewerLevel)}级 · 对方 ${String(viewer.opponentLevel)}级`,
      ...turnClock,
      counterExpanded: this.counterExpanded,
      cardCounts: this.publicCardCounts(snapshot, humanId),
      seats,
      availableSuits: hand.availableSuits,
      selectedSuit: hand.selectedSuit,
      lockAction: hand.lockAction,
      arrangeRestoreAvailable: hand.arrangeRestoreAvailable,
    })
  }

  public update (patch: Partial<TableGameHudState>): void { this.tableHud?.update(patch) }
  public setVisible (visible: boolean): void { this.tableHud?.setVisible(visible) }
  public layout (viewport: TableGameHudViewport): void { this.tableHud?.layout(viewport) }
  public hitTestInteractiveScreenPoint (point: Readonly<{ x: number, y: number }>): boolean {
    return this.tableHud?.hitTestInteractiveScreenPoint(point) ?? false
  }

  public dispose (): void {
    this.generation += 1
    this.timerLoadCancel?.()
    this.avatarLoadCancel?.()
    this.timerLoadCancel = null
    this.avatarLoadCancel = null
    this.tableHud?.dispose()
    this.tableHud = null
  }

  /** Counts public unknowns only: two decks minus the viewer hand and revealed plays. */
  private publicCardCounts (snapshot: GameSnapshot, humanId: PlayerId): Record<TableGameHudCounterRank, number> {
    const counts = {} as Record<TableGameHudCounterRank, number>
    TABLE_GAME_HUD_COUNTER_RANKS.forEach(rank => { counts[rank] = rank === '小王' || rank === '大王' ? 2 : 8 })
    const remove = (rank: Rank): void => {
      const key = rank === 'Small' ? '小王' : rank === 'Big' ? '大王' : String(rank) as TableGameHudCounterRank
      counts[key] = Math.max(0, counts[key] - 1)
    }
    snapshot.state.players[humanId].hand.forEach(card => remove(card.rank))
    snapshot.state.playArea.forEach(action => action.cards.forEach(card => remove(card.rank)))
    return counts
  }

  private requestTimerArtwork (generation: number): void {
    this.timerLoadCancel = loadGameAsset(TABLE_TIMER_ART_ASSET, Texture2D, (error, texture) => {
      if (!this.isCurrent(generation)) return
      this.timerLoadCancel = null
      if (error || !texture) {
        if (error) console.warn('Unable to load the chicken timer artwork; using the circular fallback.', error)
        return
      }
      const artwork = new Node('ChickenTimerArtwork')
      artwork.addComponent(UITransform).setContentSize(112, 112)
      const sprite = artwork.addComponent(Sprite)
      sprite.sizeMode = Sprite.SizeMode.CUSTOM
      const frame = new SpriteFrame()
      frame.texture = texture
      sprite.spriteFrame = frame
      this.tableHud?.setTimerArtwork(artwork)
    })
  }

  private requestAvatarArtwork (generation: number): void {
    this.avatarLoadCancel = loadGameAsset(DEFAULT_AVATAR_ART_ASSET, Texture2D, (error, texture) => {
      if (!this.isCurrent(generation)) return
      this.avatarLoadCancel = null
      if (error || !texture) {
        if (error) console.warn('Unable to load the default avatar artwork.', error)
        return
      }
      const frame = new SpriteFrame()
      frame.texture = texture
      this.tableHud?.setDefaultAvatarFrame(frame)
    })
  }

  private requestSuitArtwork (generation: number): void {
    const suits: readonly TableGameHudSuit[] = ['spade', 'heart', 'club', 'diamond']
    void Promise.all(suits.map(async suit => [suit, await requestClassicCardFrame(`shape_${suit}_s`)] as const))
      .then(entries => {
        if (!this.isCurrent(generation)) return
        const frames: Partial<Record<TableGameHudSuit, SpriteFrame>> = {}
        entries.forEach(([suit, frame]) => { if (frame) frames[suit] = frame })
        this.tableHud?.setSuitFrames(frames)
      })
  }

  private isCurrent (generation: number): boolean {
    return generation === this.generation && Boolean(this.tableHud && this.dependencies.root.isValid)
  }
}
