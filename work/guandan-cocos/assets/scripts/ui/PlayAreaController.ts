import { _decorator, Color, Component, Label, Node, Tween, UIOpacity, UITransform, Vec3, tween } from 'cc'
import type { PlayAction, PlayerId } from '../core/generated'
import type { CardBlastReactionTarget } from '../effects/CardBlastReaction'
import { PLAYED_CARD_FINAL_SCALE, resolvePlayedCardSpacing } from '../effects/CardFlightController'
import { mapCardToPresentation } from './CardPresentationMapper'
import { CardView } from './CardView'
import { applyForegroundTextStyle } from './RuntimeUiFactory'
import type { TableViewport } from './ScreenAdapter'
import { playedCardPosition } from './PlayedCardLayout'

const { ccclass } = _decorator
const order: PlayerId[] = ['p1', 'p2', 'p3', 'p4']
// Shared central column; opponents' lanes track the safe outer edges on resize.
const settledScale = new Vec3(PLAYED_CARD_FINAL_SCALE, PLAYED_CARD_FINAL_SCALE, 1)
const entranceOffsets = [new Vec3(0, -34, 0), new Vec3(34, 0, 0), new Vec3(0, 34, 0), new Vec3(-34, 0, 0)]
type PendingAction = { key: string, ticket: string, cardIds: Set<string> }
type ActionCardNodes = { key: string, nodes: Map<string, Node> }

const actionKey = (action: PlayAction, actionIndex: number): string =>
  `${actionIndex}:${action.playerId}:${action.type}:${action.cards.map(card => card.id).join(',')}`

/** Displays each seat's newest action, including pass prompts and played-card fans. */
@ccclass('PlayAreaController')
export class PlayAreaController extends Component {
  private viewport: TableViewport = { width: 1280, height: 720, halfWidth: 640, halfHeight: 360, safeLeft: 0, safeRight: 0, safeTop: 0, safeBottom: 0 }
  private actionNodes = new Map<PlayerId, Node>()
  private actionKeys = new Map<PlayerId, string>()
  private actionIndexes = new Map<PlayerId, number>()
  private cardNodes = new Map<number, ActionCardNodes>()
  private pendingCards = new Map<number, PendingAction>()
  private authoritativeActions: PlayAction[] = []
  private authoritativeHumanId: PlayerId = 'p1'
  private presentedActionCount = 0
  private presentationEpoch = 0
  private presentationSerial = 0
  private visibleActionStart = 0
  private readonly expiredPassKeys = new Set<string>()

  /** Stages an authoritative action behind the visible presentation cursor. */
  public deferAction (action: PlayAction, actionIndex: number): string {
    const ticket = `${this.presentationEpoch}:${++this.presentationSerial}:${actionKey(action, actionIndex)}`
    this.pendingCards.set(actionIndex, {
      key: actionKey(action, actionIndex),
      ticket,
      cardIds: new Set(action.cards.map(card => card.id)),
    })
    return ticket
  }

  /** Advances the prefix only when this action reaches the head of the lane. */
  public beginAction (action: PlayAction, actionIndex: number, ticket: string): void {
    if (!this.matchesPending(action, actionIndex, ticket)) return
    this.presentedActionCount = Math.max(this.presentedActionCount, actionIndex + 1)
    this.renderPresentedActions()
  }

  public revealCard (action: PlayAction, actionIndex: number, cardId: string, ticket: string): void {
    const pending = this.pendingCards.get(actionIndex)
    const key = actionKey(action, actionIndex)
    if (!pending || pending.key !== key || pending.ticket !== ticket) return
    pending.cardIds.delete(cardId)
    const cardGroup = this.cardNodes.get(actionIndex)
    if (cardGroup?.key !== key) return
    const node = cardGroup.nodes.get(cardId)
    if (node?.isValid) node.active = true
  }

  public revealAction (action: PlayAction, actionIndex: number, ticket: string): void {
    const key = actionKey(action, actionIndex)
    const pending = this.pendingCards.get(actionIndex)
    if (!pending || pending.key !== key || pending.ticket !== ticket) return
    this.presentedActionCount = Math.max(this.presentedActionCount, actionIndex + 1)
    this.renderPresentedActions()
    this.pendingCards.delete(actionIndex)
    const cardGroup = this.cardNodes.get(actionIndex)
    if (cardGroup?.key !== key) return
    cardGroup.nodes.forEach(node => { if (node.isValid) node.active = true })
  }

  /** Recovery commits the authoritative snapshot and invalidates all old callbacks. */
  public resetPresentation (actionCount: number): void {
    this.presentationEpoch += 1
    this.pendingCards.clear()
    if (actionCount < this.presentedActionCount) this.expiredPassKeys.clear()
    this.cardNodes.forEach(cardGroup => cardGroup.nodes.forEach(node => { if (node.isValid) node.active = true }))
    this.presentedActionCount = Math.max(0, actionCount)
  }

  /** Resolves only landed, visible table cards from the controller-owned maps. */
  public collectCardBlastTargets (): CardBlastReactionTarget[] {
    return Array.from(this.cardNodes.entries()).flatMap(([actionIndex, cardGroup]) =>
      Array.from(cardGroup.nodes.entries()).flatMap(([cardId, node]) => {
        if (!node.isValid || !node.activeInHierarchy) return []
        const target = node.getComponent(CardView)?.getBombReactionRoot()
        return target?.isValid && target.activeInHierarchy
          ? [{ key: `play:${actionIndex}:${cardId}`, node: target }]
          : []
      }),
    )
  }

  public getActionWorldPosition (playerId: PlayerId, humanId: PlayerId = 'p1', cardCount = 1): Vec3 {
    const place = (order.indexOf(playerId) - order.indexOf(humanId) + 4) % 4
    const transform = this.getComponent(UITransform)
    const position = this.positionFor(place, cardCount)
    return transform?.convertToWorldSpaceAR(position) ?? this.node.worldPosition.clone().add(position)
  }

  private positionFor (place: number, count: number): Vec3 {
    const { x, y } = playedCardPosition(this.viewport, place, count)
    return new Vec3(x, y, 0)
  }

  public layout (viewport: TableViewport): void {
    this.viewport = viewport
    this.actionNodes.forEach((node, id) => {
      Tween.stopAllByTarget(node)
      const count = this.authoritativeActions[this.actionIndexes.get(id) ?? -1]?.cards.length ?? 1
      node.setPosition(this.positionFor((order.indexOf(id) - order.indexOf(this.authoritativeHumanId) + 4) % 4, count))
      if (!node.getChildByName('PassText')) node.setScale(settledScale)
    })
  }

  public render (actions: PlayAction[], humanId: PlayerId = 'p1', lastValidPlay: PlayAction | null | undefined = undefined): void {
    if (actions.length < this.authoritativeActions.length) this.expiredPassKeys.clear()
    this.authoritativeActions = actions.slice()
    this.authoritativeHumanId = humanId
    if (lastValidPlay === null) this.visibleActionStart = actions.length
    else {
      let lastPlayIndex = -1
      for (let index = actions.length - 1; index >= 0; index -= 1) {
        if (actions[index].type !== 'Pass') { lastPlayIndex = index; break }
      }
      this.visibleActionStart = Math.max(0, lastPlayIndex)
    }
    this.renderPresentedActions()
  }

  public clearPresentation (): void {
    this.presentationEpoch += 1
    this.pendingCards.clear()
    this.cardNodes.clear()
    this.expiredPassKeys.clear()
    this.actionNodes.forEach(node => this.destroyNode(node))
    this.actionNodes.clear()
    this.actionKeys.clear()
    this.actionIndexes.clear()
    this.authoritativeActions = []
    this.presentedActionCount = 0
    this.visibleActionStart = 0
  }

  protected onDestroy (): void { this.clearPresentation() }

  private matchesPending (action: PlayAction, actionIndex: number, ticket: string): boolean {
    const pending = this.pendingCards.get(actionIndex)
    return Boolean(pending && pending.key === actionKey(action, actionIndex) && pending.ticket === ticket)
  }

  private renderPresentedActions (): void {
    const actions = this.authoritativeActions.slice(0, Math.min(this.presentedActionCount, this.authoritativeActions.length))
    const humanId = this.authoritativeHumanId
    const authoritativeActionKeys = new Map(this.authoritativeActions.map((action, index) => [index, actionKey(action, index)]))
    this.pendingCards.forEach((pending, actionIndex) => {
      if (authoritativeActionKeys.get(actionIndex) !== pending.key) this.pendingCards.delete(actionIndex)
    })
    const latest = new Map<PlayerId, { action: PlayAction, actionIndex: number }>()
    const recentStart = Math.min(actions.length, this.visibleActionStart)
    actions.slice(recentStart).forEach((action, index) => latest.set(action.playerId, { action, actionIndex: recentStart + index }))
    ;(['p1', 'p2', 'p3', 'p4'] as PlayerId[]).forEach(id => {
      const entry = latest.get(id)
      const old = this.actionNodes.get(id)
      if (!entry) {
        const oldIndex = this.actionIndexes.get(id)
        if (old) this.destroyNode(old)
        this.actionNodes.delete(id)
        this.actionKeys.delete(id)
        this.actionIndexes.delete(id)
        if (oldIndex !== undefined) this.cardNodes.delete(oldIndex)
        return
      }
      const { action, actionIndex } = entry
      const key = actionKey(action, actionIndex)
      if (this.actionKeys.get(id) === key) return
      const oldIndex = this.actionIndexes.get(id)
      if (old) this.destroyNode(old)
      if (oldIndex !== undefined) this.cardNodes.delete(oldIndex)
      if (action.type === 'Pass' && this.expiredPassKeys.has(key)) {
        this.actionNodes.delete(id)
        this.actionKeys.delete(id)
        this.actionIndexes.delete(id)
        return
      }
      const root = new Node(`play-${id}`)
      root.parent = this.node
      const place = (order.indexOf(id) - order.indexOf(humanId) + 4) % 4
      const target = this.positionFor(place, Math.max(1, action.cards.length))
      const pending = this.pendingCards.get(actionIndex)
      root.setPosition(target)
      root.addComponent(UITransform).setContentSize(250, 120)
      const opacity = root.addComponent(UIOpacity)
      opacity.opacity = 255
      this.actionNodes.set(id, root)
      this.actionKeys.set(id, key)
      this.actionIndexes.set(id, actionIndex)
      root.setScale(settledScale)
      if (action.type === 'Pass') {
        root.setPosition(target.clone().add(entranceOffsets[place]))
        root.setScale(new Vec3(0.78, 0.78, 1))
        opacity.opacity = 0
        tween(opacity).to(0.12, { opacity: 255 }).start()
        tween(root).to(0.18, { position: target, scale: Vec3.ONE }, { easing: 'backOut' }).start()
        const textNode = new Node('PassText')
        textNode.parent = root
        textNode.addComponent(UITransform).setContentSize(108, 48)
        const text = textNode.addComponent(Label)
        text.string = '不要'
        text.fontSize = 28
        text.lineHeight = 34
        text.horizontalAlign = Label.HorizontalAlign.CENTER
        text.verticalAlign = Label.VerticalAlign.CENTER
        text.color = new Color(220, 222, 213, 235)
        applyForegroundTextStyle(text, new Color(12, 29, 32, 255), 2)
        tween(opacity).delay(0.72).to(0.32, { opacity: 0 }).call(() => {
          if (this.actionNodes.get(id) !== root || this.actionKeys.get(id) !== key) return
          this.expiredPassKeys.add(key)
          this.actionNodes.delete(id)
          this.actionKeys.delete(id)
          this.actionIndexes.delete(id)
          this.destroyNode(root)
        }).start()
        return
      }
      const spacing = resolvePlayedCardSpacing(action.cards.length)
      const nodes = new Map<string, Node>()
      this.cardNodes.set(actionIndex, { key, nodes })
      action.cards.forEach((card, index) => {
        const node = new Node(`played-${card.id}`)
        node.parent = root
        node.setPosition(new Vec3((index - (action.cards.length - 1) / 2) * spacing, 0, index))
        const view = node.addComponent(CardView)
        view.bind({ id: card.id, ...mapCardToPresentation(card), selected: false, interactive: false })
        node.active = pending?.key !== key || !pending.cardIds.has(card.id)
        nodes.set(card.id, node)
      })
    })
  }

  private destroyNode (node: Node): void {
    Tween.stopAllByTarget(node)
    const opacity = node.getComponent(UIOpacity)
    if (opacity) Tween.stopAllByTarget(opacity)
    if (node.isValid) node.destroy()
  }
}
