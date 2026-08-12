import { _decorator, Color, Component, EventTouch, Graphics, Node, Sprite, SpriteFrame, Tween, UIOpacity, UITransform, Vec2, Vec3, tween } from 'cc'
import { getCachedClassicCardFrames, requestClassicCardFrames } from './ClassicCardFrameStore'
import { CLASSIC_CARD_JOKER_GEOMETRY, CLASSIC_CARD_LAYER_GEOMETRY } from './ClassicCardGeometry'
import type { ClassicCardLayer } from './ClassicCardGeometry'
import { resolveClassicCardPlan } from './CardSkinResolver'
import type { ClassicCardPlan, ClassicCardSuit } from './CardSkinResolver'

export type CardPresentation = { id: string, rank: string, suit: ClassicCardSuit, red: boolean, levelCard: boolean, selected: boolean, lockDraft?: boolean, locked?: boolean, interactive?: boolean }

export const HAND_CARD_TOUCH_START = 'guandan:hand-card-touch-start'
export const HAND_CARD_TOUCH_MOVE = 'guandan:hand-card-touch-move'
export const HAND_CARD_TOUCH_END = 'guandan:hand-card-touch-end'
export const HAND_CARD_TOUCH_CANCEL = 'guandan:hand-card-touch-cancel'

export type HandCardTouch = Readonly<{
  cardId: string
  pointerId: number
  screenPoint: Vec2
}>

const { ccclass } = _decorator

type ClassicLayer = ClassicCardLayer

/** Input-safe card view whose only face renderer is the composited classic art. */
@ccclass('CardView')
export class CardView extends Component {
  private card?: CardPresentation
  private inputBound = false
  private surface: Graphics | null = null
  private selectionOverlay: Graphics | null = null
  private lockDraftOverlay: Graphics | null = null
  private lockOverlay: Graphics | null = null
  private levelFilter: Graphics | null = null
  private opacity: UIOpacity | null = null
  private bombReactionRoot: Node | null = null
  private visualRoot: Node | null = null
  private classicRoot: Node | null = null
  private readonly classicSprites = new Map<ClassicLayer, Sprite>()
  private expectedPlanKey = ''
  private artworkRequestId = 0
  private hitArea: Node | null = null
  private hitAreaWidth = 78
  private hitAreaOffsetX = 0
  private hitAreaHeight = 114
  private hitAreaOffsetY = 0
  private stackCovered = false
  private entranceEpoch = 0
  private entranceResolve: (() => void) | null = null

  protected onLoad (): void {
    let transform = this.getComponent(UITransform)
    if (!transform) transform = this.addComponent(UITransform)
    transform!.setContentSize(82, 150)
    // Keep input on a dedicated, invisible node. Display-only CardViews (the
    // table fan and flight ghosts) never register input, so they cannot become
    // transient blockers above the hand.
    const hitArea = new Node('CardHitArea')
    hitArea.parent = this.node
    hitArea.addComponent(UITransform).setContentSize(78, 114)
    this.hitArea = hitArea
    this.applyHitAreaGeometry()
    // Bomb reactions own this wrapper while selection, press feedback and deal
    // entrance continue to own CardVisual. Keeping those transforms separate
    // makes cancellation restore only decorative state.
    const bombReactionRoot = new Node('BombReactionRoot')
    bombReactionRoot.parent = this.node
    bombReactionRoot.addComponent(UITransform).setContentSize(82, 118)
    this.bombReactionRoot = bombReactionRoot
    const visualRoot = new Node('CardVisual')
    visualRoot.parent = bombReactionRoot
    visualRoot.addComponent(UITransform).setContentSize(82, 118)
    this.visualRoot = visualRoot
    this.surface = visualRoot.addComponent(Graphics)
    this.opacity = this.getComponent(UIOpacity) ?? this.addComponent(UIOpacity)
    this.redrawSurface()
    this.createClassicVisuals(visualRoot)
    this.createLevelFilter(visualRoot)
    this.createSelectionOverlay(visualRoot)
    this.createLockDraftOverlay(visualRoot)
    this.createLockOverlay(visualRoot)
    if (this.card) {
      this.applyCard(++this.artworkRequestId)
      this.redrawLevelFilter(this.card.levelCard)
      this.applySelectionVisual(this.card.selected)
      this.applyLockDraftVisual(Boolean(this.card.lockDraft))
      this.applyLockVisual(Boolean(this.card.locked))
    }
    this.syncInputBinding()
  }

  protected onEnable (): void { this.syncInputBinding() }

  protected onDisable (): void {
    this.finishEntrance()
    this.detachInput()
  }

  protected onDestroy (): void {
    this.finishEntrance()
    this.detachInput()
    this.expectedPlanKey = ''
    this.artworkRequestId += 1
  }

  public bind (card: CardPresentation): void {
    const requestId = ++this.artworkRequestId
    this.card = card
    this.applyCard(requestId)
    this.redrawLevelFilter(card.levelCard)
    this.applySelectionVisual(card.selected)
    this.applyLockDraftVisual(Boolean(card.lockDraft))
    this.applyLockVisual(Boolean(card.locked))
    this.syncInputBinding()
  }

  /**
   * Restricts a fanned card to the portion that is actually exposed. The last
   * card keeps its full face. Adjacent hit areas therefore meet but do not
   * overlap, making a tap deterministic even with a 27-card hand.
   */
  public configureFanHitArea (spacing: number, isLastCard: boolean): void {
    const visibleWidth = 78
    // Width must never exceed centre-to-centre spacing. On a very narrow or
    // portrait viewport even a 12px minimum would overlap the adjacent slot.
    this.hitAreaWidth = isLastCard ? visibleWidth : Math.max(1, Math.min(visibleWidth, spacing))
    this.hitAreaOffsetX = isLastCard ? 0 : (this.hitAreaWidth - visibleWidth) / 2
    this.applyHitAreaGeometry()
  }

  /**
   * Restricts a covered card to its exposed strip without changing its visual
   * scale or artwork. Normal cards and jokers use the same strip geometry.
   */
  public configureStackHitArea (verticalStep: number, stackIndex: number, stackSize: number): void {
    this.stackCovered = verticalStep > 0 && stackSize > 1 && stackIndex < stackSize - 1
    if (this.stackCovered) {
      this.hitAreaHeight = Math.max(1, Math.min(114, verticalStep))
      this.hitAreaOffsetY = (114 - this.hitAreaHeight) / 2
    } else {
      this.hitAreaHeight = 114
      this.hitAreaOffsetY = 0
    }
    this.applyHitAreaGeometry()
    this.refreshStateVisuals()
  }

  private applyHitAreaGeometry (): void {
    this.hitArea?.getComponent(UITransform)?.setContentSize(this.hitAreaWidth, this.hitAreaHeight)
    this.syncHitAreaPosition()
  }

  /** Screen-space hit testing lets the hand controller resolve fast swipes. */
  public hitTestScreenPoint (point: Vec2): boolean {
    return Boolean(this.hitArea?.activeInHierarchy && this.hitArea.getComponent(UITransform)?.hitTest(point))
  }

  /** The visual centre is stable during selection and is also the flight origin. */
  public getVisualWorldPosition (): Vec3 {
    return this.visualRoot?.worldPosition.clone() ?? this.node.worldPosition.clone()
  }

  /** A transform layer reserved for transient table-impact reactions. */
  public getBombReactionRoot (): Node | null {
    return this.bombReactionRoot?.isValid ? this.bombReactionRoot : null
  }

  private applyCard (requestId: number): void {
    if (!this.card) return
    this.redrawSurface()
    this.applyClassicArtwork(requestId)
  }

  private createClassicVisuals (parent: Node): void {
    const root = new Node('ClassicCardSkin')
    root.parent = parent
    root.active = false
    this.classicRoot = root
    const layerNames: Readonly<Record<ClassicLayer, string>> = {
      background: 'ClassicBackground',
      cornerRank: 'ClassicCornerRank',
      cornerSuit: 'ClassicCornerSuit',
      center: 'ClassicCenter',
    }
    ;(Object.keys(CLASSIC_CARD_LAYER_GEOMETRY) as ClassicLayer[]).forEach(layer => {
      const geometry = CLASSIC_CARD_LAYER_GEOMETRY[layer]
      this.classicSprites.set(layer, this.createClassicSprite(
        root,
        layerNames[layer],
        geometry.width,
        geometry.height,
        geometry.x,
        geometry.y,
        geometry.z,
      ))
    })
  }

  private createSelectionOverlay (parent: Node): void {
    const node = new Node('CardSelectionOverlay')
    node.parent = parent
    node.setPosition(new Vec3(0, 0, 8))
    node.addComponent(UITransform).setContentSize(86, 122)
    this.selectionOverlay = node.addComponent(Graphics)
    this.redrawSelectionOverlay(false)
  }

  private createLockOverlay (parent: Node): void {
    const node = new Node('CardLockOverlay')
    node.parent = parent
    node.setPosition(new Vec3(0, 0, 9))
    node.addComponent(UITransform).setContentSize(86, 122)
    this.lockOverlay = node.addComponent(Graphics)
    this.redrawLockOverlay(false)
  }

  private createLockDraftOverlay (parent: Node): void {
    const node = new Node('CardLockDraftOverlay')
    node.parent = parent
    node.setPosition(new Vec3(0, 0, 9))
    node.addComponent(UITransform).setContentSize(86, 122)
    this.lockDraftOverlay = node.addComponent(Graphics)
    this.redrawLockDraftOverlay(false)
  }

  private createLevelFilter (parent: Node): void {
    const node = new Node('CardLevelYellowFilter')
    node.parent = parent
    node.setPosition(new Vec3(0, 0, 7))
    node.addComponent(UITransform).setContentSize(80, 116)
    this.levelFilter = node.addComponent(Graphics)
    this.redrawLevelFilter(false)
  }

  private createClassicSprite (parent: Node, name: string, width: number, height: number, x: number, y: number, z: number): Sprite {
    const node = new Node(name)
    node.parent = parent
    node.setPosition(new Vec3(x, y, z))
    node.addComponent(UITransform).setContentSize(width, height)
    const sprite = node.addComponent(Sprite)
    sprite.type = Sprite.Type.SIMPLE
    sprite.sizeMode = Sprite.SizeMode.CUSTOM
    return sprite
  }

  private applyClassicArtwork (requestId: number): void {
    if (!this.card || !this.classicRoot) return
    const plan = resolveClassicCardPlan(this.card)
    this.expectedPlanKey = plan?.key ?? ''
    if (!plan) {
      this.hideClassicArtwork()
      return
    }

    const cached = getCachedClassicCardFrames(plan)
    if (cached) {
      this.applyClassicFrames(plan, cached)
      return
    }

    this.hideClassicArtwork()
    void requestClassicCardFrames(plan).then(frames => {
      if (!frames || requestId !== this.artworkRequestId || !this.node.isValid) return
      const expected = this.card ? resolveClassicCardPlan(this.card) : null
      if (this.expectedPlanKey !== plan.key || expected?.key !== plan.key) return
      this.applyClassicFrames(plan, frames)
    })
  }

  private applyClassicFrames (plan: ClassicCardPlan, frames: ReadonlyMap<string, SpriteFrame>): void {
    this.setClassicFrame('background', frames.get(plan.background) ?? null)
    this.setClassicFrame('cornerRank', plan.cornerRank ? frames.get(plan.cornerRank) ?? null : null)
    this.setClassicFrame('cornerSuit', plan.cornerSuit ? frames.get(plan.cornerSuit) ?? null : null)
    const centerAsset = plan.joker ?? plan.center
    this.setClassicFrame('center', centerAsset ? frames.get(centerAsset) ?? null : null)
    const centerNode = this.classicSprites.get('center')?.node
    const centerTransform = centerNode?.getComponent(UITransform)
    const centerGeometry = plan.joker ? CLASSIC_CARD_JOKER_GEOMETRY : CLASSIC_CARD_LAYER_GEOMETRY.center
    centerNode?.setPosition(new Vec3(centerGeometry.x, centerGeometry.y, centerGeometry.z))
    centerTransform?.setContentSize(centerGeometry.width, centerGeometry.height)
    this.classicRoot!.active = true
  }

  private setClassicFrame (layer: ClassicLayer, frame: SpriteFrame | null): void {
    const sprite = this.classicSprites.get(layer)
    if (!sprite) return
    sprite.spriteFrame = frame
  }

  private hideClassicArtwork (): void {
    if (this.classicRoot) this.classicRoot.active = false
  }

  /** Staggered deal animation used for new hand cards. */
  public playEntrance (delay = 0): Promise<void> {
    this.finishEntrance()
    if (!this.opacity || !this.visualRoot) return Promise.resolve()
    const epoch = ++this.entranceEpoch
    Tween.stopAllByTarget(this.visualRoot)
    Tween.stopAllByTarget(this.opacity)
    const completion = new Promise<void>(resolve => { this.entranceResolve = resolve })
    this.opacity.opacity = 0
    this.visualRoot.setPosition(new Vec3(0, -86, 0))
    this.visualRoot.setScale(new Vec3(0.72, 0.72, 1))
    tween(this.opacity).delay(delay).to(0.16, { opacity: 255 }).start()
    tween(this.visualRoot).delay(delay).to(0.2, {
      position: Vec3.ZERO,
      scale: Vec3.ONE,
    }, { easing: 'backOut' }).call(() => this.finishEntrance(epoch)).start()
    return completion
  }

  /** Lets the presentation scheduler skip a deal and restore the final card state. */
  public finishEntranceImmediately (): void { this.finishEntrance() }

  /** Resolves the entrance barrier even when another interaction owns CardVisual. */
  private finishEntrance (epoch?: number): void {
    if (epoch !== undefined && epoch !== this.entranceEpoch) return
    this.entranceEpoch += 1
    if (this.opacity?.node.isValid) {
      Tween.stopAllByTarget(this.opacity)
      this.opacity.opacity = 255
    }
    if (this.visualRoot?.isValid) {
      Tween.stopAllByTarget(this.visualRoot)
      this.visualRoot.setPosition(Vec3.ZERO)
      this.visualRoot.setScale(Vec3.ONE)
    }
    const resolve = this.entranceResolve
    this.entranceResolve = null
    resolve?.()
  }

  private redrawSurface (): void {
    if (!this.surface) return
    this.surface.clear()
    this.surface.fillColor = new Color(249, 245, 232, 255)
    this.surface.strokeColor = new Color(177, 141, 68, 255)
    this.surface.lineWidth = 2
    this.surface.roundRect(-39, -57, 78, 114, 8)
    this.surface.fill()
    this.surface.stroke()
  }

  private redrawSelectionOverlay (selected: boolean): void {
    if (!this.selectionOverlay) return
    this.selectionOverlay.clear()
    if (!selected) return
    // A neutral dark wash preserves every classic PNG detail while the warm,
    // heavy outline remains legible on both red and black suits.
    this.selectionOverlay.fillColor = new Color(8, 18, 24, 82)
    if (this.stackCovered) {
      const height = Math.max(6, Math.min(112, this.hitAreaHeight))
      const y = 56 - height
      const radius = Math.min(8, height / 2)
      this.selectionOverlay.roundRect(-38, y, 76, height, radius)
      this.selectionOverlay.fill()
      this.selectionOverlay.strokeColor = new Color(255, 205, 64, 255)
      this.selectionOverlay.lineWidth = 4
      const strokeHeight = Math.max(1, height - 2)
      this.selectionOverlay.roundRect(-39, y + 1, 78, strokeHeight, Math.min(radius, strokeHeight / 2))
      this.selectionOverlay.stroke()
      return
    }
    this.selectionOverlay.roundRect(-38, -56, 76, 112, 8)
    this.selectionOverlay.fill()
    this.selectionOverlay.strokeColor = new Color(255, 205, 64, 255)
    this.selectionOverlay.lineWidth = 4
    this.selectionOverlay.roundRect(-40, -58, 80, 116, 9)
    this.selectionOverlay.stroke()
  }

  private redrawLockOverlay (locked: boolean): void {
    if (!this.lockOverlay) return
    this.lockOverlay.clear()
    if (!locked) return
    this.lockOverlay.strokeColor = new Color(48, 205, 226, 255)
    this.lockOverlay.lineWidth = 3
    if (this.stackCovered) {
      const height = Math.max(6, Math.min(112, this.hitAreaHeight))
      const y = 56 - height
      const strokeHeight = Math.max(1, height - 6)
      this.lockOverlay.roundRect(-35, y + 3, 70, strokeHeight, Math.min(6, strokeHeight / 2))
      this.lockOverlay.stroke()
      return
    }
    this.lockOverlay.roundRect(-35, -53, 70, 106, 7)
    this.lockOverlay.stroke()
    // The small cool-colour clasp stays distinct from the gold selection state.
    this.lockOverlay.fillColor = new Color(48, 205, 226, 230)
    this.lockOverlay.roundRect(24, 42, 12, 10, 2)
    this.lockOverlay.fill()
    this.lockOverlay.strokeColor = new Color(234, 253, 255, 255)
    this.lockOverlay.lineWidth = 2
    this.lockOverlay.moveTo(27, 42)
    this.lockOverlay.lineTo(27, 47)
    this.lockOverlay.lineTo(33, 47)
    this.lockOverlay.lineTo(33, 42)
    this.lockOverlay.stroke()
  }

  private redrawLockDraftOverlay (active: boolean): void {
    if (!this.lockDraftOverlay) return
    this.lockDraftOverlay.clear()
    if (!active) return
    const height = this.stackCovered ? Math.max(6, Math.min(112, this.hitAreaHeight)) : 112
    const y = this.stackCovered ? 56 - height : -56
    const inset = this.stackCovered ? 2 : 0
    this.lockDraftOverlay.fillColor = new Color(38, 170, 220, 52)
    this.lockDraftOverlay.roundRect(-38 + inset, y + inset, 76 - inset * 2, Math.max(2, height - inset * 2), 7)
    this.lockDraftOverlay.fill()
    this.lockDraftOverlay.strokeColor = new Color(110, 229, 255, 255)
    this.lockDraftOverlay.lineWidth = 4
    this.lockDraftOverlay.roundRect(-38 + inset, y + inset, 76 - inset * 2, Math.max(2, height - inset * 2), 7)
    this.lockDraftOverlay.stroke()
  }

  private redrawLevelFilter (isLevelCard: boolean): void {
    if (!this.levelFilter) return
    this.levelFilter.clear()
    if (!isLevelCard) return
    this.levelFilter.fillColor = new Color(255, 190, 28, 54)
    this.levelFilter.roundRect(-38, -56, 76, 112, 8)
    this.levelFilter.fill()
    this.levelFilter.strokeColor = new Color(255, 205, 67, 210)
    this.levelFilter.lineWidth = 2
    this.levelFilter.roundRect(-38, -56, 76, 112, 8)
    this.levelFilter.stroke()
  }

  private applySelectionVisual (selected: boolean): void {
    this.syncHitAreaPosition()
    this.redrawSelectionOverlay(selected)
  }

  private applyLockVisual (locked: boolean): void {
    this.redrawLockOverlay(locked)
  }

  private applyLockDraftVisual (active: boolean): void {
    this.redrawLockDraftOverlay(active)
  }

  private refreshStateVisuals (): void {
    this.applySelectionVisual(Boolean(this.card?.selected))
    this.applyLockDraftVisual(Boolean(this.card?.lockDraft))
    this.applyLockVisual(Boolean(this.card?.locked))
  }

  private syncHitAreaPosition (): void {
    this.hitArea?.setPosition(new Vec3(this.hitAreaOffsetX, this.hitAreaOffsetY, 0))
  }

  private syncInputBinding (): void {
    const shouldBind = Boolean(this.card && this.card.interactive !== false && this.enabledInHierarchy)
    if (!this.hitArea || shouldBind === this.inputBound) return
    if (!shouldBind) { this.detachInput(); return }
    this.inputTargets().forEach(node => {
      node.on(Node.EventType.TOUCH_START, this.handleTouchStart, this)
      node.on(Node.EventType.TOUCH_MOVE, this.handleTouchMove, this)
      node.on(Node.EventType.TOUCH_END, this.handleTouchEnd, this)
      node.on(Node.EventType.TOUCH_CANCEL, this.handleTouchCancel, this)
    })
    this.inputBound = true
  }

  private detachInput (): void {
    if (!this.hitArea || !this.inputBound) return
    this.inputTargets().forEach(node => {
      node.off(Node.EventType.TOUCH_START, this.handleTouchStart, this)
      node.off(Node.EventType.TOUCH_MOVE, this.handleTouchMove, this)
      node.off(Node.EventType.TOUCH_END, this.handleTouchEnd, this)
      node.off(Node.EventType.TOUCH_CANCEL, this.handleTouchCancel, this)
    })
    this.inputBound = false
  }

  private inputTargets (): Node[] {
    return this.hitArea ? [this.hitArea] : []
  }

  private pressIn (): void {
    if (this.card?.interactive === false) return
    this.finishEntrance()
  }

  private pressOut (): void {
    if (this.visualRoot) this.visualRoot.setScale(Vec3.ONE)
  }

  private touchDetail (event: EventTouch): HandCardTouch | null {
    if (!this.card || this.card.interactive === false) return null
    return {
      cardId: this.card.id,
      pointerId: event.getID() ?? 0,
      screenPoint: event.getUILocation().clone(),
    }
  }

  private handleTouchStart (event: EventTouch): void {
    const detail = this.touchDetail(event)
    if (!detail) return
    this.pressIn()
    this.node.parent?.emit(HAND_CARD_TOUCH_START, detail)
  }

  private handleTouchMove (event: EventTouch): void {
    const detail = this.touchDetail(event)
    if (detail) this.node.parent?.emit(HAND_CARD_TOUCH_MOVE, detail)
  }

  private handleTouchEnd (event: EventTouch): void {
    const detail = this.touchDetail(event)
    this.pressOut()
    if (detail) this.node.parent?.emit(HAND_CARD_TOUCH_END, detail)
  }

  private handleTouchCancel (event: EventTouch): void {
    const detail = this.touchDetail(event)
    this.pressOut()
    if (detail) this.node.parent?.emit(HAND_CARD_TOUCH_CANCEL, detail)
  }
}
