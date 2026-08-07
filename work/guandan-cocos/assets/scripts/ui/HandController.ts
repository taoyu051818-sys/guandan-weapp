import { _decorator, Component, instantiate, Node, Prefab, Tween, UITransform, Vec2, Vec3, tween } from 'cc'
import type { Card } from '../core/generated'
import type { CardBlastReactionTarget } from '../effects/CardBlastReaction'
import { HandDragSelectionPolicy, sampleHandDragSegment } from '../game/HandDragSelectionPolicy'
import { createHandStackLayout, type HandStackGroup } from '../game/HandStackLayout'
import { mapCardToPresentation } from './CardPresentationMapper'
import {
  CardView,
  HAND_CARD_TOUCH_CANCEL,
  HAND_CARD_TOUCH_END,
  HAND_CARD_TOUCH_MOVE,
  HAND_CARD_TOUCH_START,
  type HandCardTouch,
} from './CardView'

const { ccclass, property } = _decorator

@ccclass('HandController')
export class HandController extends Component {
  @property(Prefab)
  public cardPrefab: Prefab | null = null
  private cards = new Map<string, Node>()
  private entranceCompletion: Promise<void> | null = null
  private readonly dragSelection = new HandDragSelectionPolicy()
  private selectedCardIds = new Set<string>()
  private interactive = false

  protected onLoad (): void {
    this.node.on(HAND_CARD_TOUCH_START, this.handleCardTouchStart, this)
    this.node.on(HAND_CARD_TOUCH_MOVE, this.handleCardTouchMove, this)
    this.node.on(HAND_CARD_TOUCH_END, this.handleCardTouchEnd, this)
    this.node.on(HAND_CARD_TOUCH_CANCEL, this.handleCardTouchCancel, this)
  }

  protected onDestroy (): void {
    this.dragSelection.cancel()
    this.node.off(HAND_CARD_TOUCH_START, this.handleCardTouchStart, this)
    this.node.off(HAND_CARD_TOUCH_MOVE, this.handleCardTouchMove, this)
    this.node.off(HAND_CARD_TOUCH_END, this.handleCardTouchEnd, this)
    this.node.off(HAND_CARD_TOUCH_CANCEL, this.handleCardTouchCancel, this)
  }

  /** Captures immutable world origins before GameManager removes played hand nodes. */
  public captureCardOrigins (cardIds: Iterable<string>): Array<{ cardId: string, worldPosition: Vec3 }> {
    return Array.from(cardIds).flatMap(cardId => {
      const node = this.cards.get(cardId)
      if (!node?.isValid) return []
      const view = node.getComponent(CardView)
      return [{ cardId, worldPosition: view?.getVisualWorldPosition() ?? node.worldPosition.clone() }]
    })
  }

  /** Resolves current visible cards at impact time; callers must not cache nodes. */
  public collectCardBlastTargets (): CardBlastReactionTarget[] {
    return Array.from(this.cards.entries()).flatMap(([cardId, node]) => {
      if (!node.isValid || !node.activeInHierarchy) return []
      const target = node.getComponent(CardView)?.getBombReactionRoot()
      return target?.isValid && target.activeInHierarchy
        ? [{ key: `hand:${cardId}`, node: target }]
        : []
    })
  }

  /** Returns the newest unconsumed deal barrier exactly once. */
  public consumeEntranceCompletion (): Promise<void> | null {
    const completion = this.entranceCompletion
    this.entranceCompletion = null
    return completion
  }

  /** Commits every in-progress entrance so skipping the lane cannot leave a deal running. */
  public finishEntrances (): void {
    this.cards.forEach(node => node.getComponent(CardView)?.finishEntranceImmediately())
  }

  public render (
    hand: Card[],
    selectedCardIds: string[],
    sortOrder: 'asc' | 'desc' = 'desc',
    interactive = false,
    displayCardIds?: readonly string[],
    stackGroups: readonly HandStackGroup[] = [],
  ): number {
    const fallback = [...hand].sort((a, b) => sortOrder === 'desc' ? b.value - a.value : a.value - b.value)
    const byId = new Map(hand.map(card => [card.id, card]))
    const requested = displayCardIds?.map(id => byId.get(id)).filter((card): card is Card => Boolean(card)) ?? []
    const requestedIds = new Set(requested.map(card => card.id))
    const displayHand = requested.length ? requested.concat(fallback.filter(card => !requestedIds.has(card.id))) : fallback
    const ids = new Set(displayHand.map(card => card.id))
    this.cards.forEach((node, id) => {
      if (!ids.has(id)) {
        node.destroy()
        this.cards.delete(id)
      }
    })
    const availableWidth = Math.max(280, (this.getComponent(UITransform)?.contentSize.width ?? 1040) - 100)
    const layout = createHandStackLayout(displayHand.map(card => card.id), stackGroups, availableWidth)
    const slotByCard = new Map(layout.slots.map(slot => [slot.cardId, slot]))
    const selectedIds = new Set(selectedCardIds)
    this.selectedCardIds = selectedIds
    this.interactive = interactive
    if (!interactive) this.dragSelection.cancel()
    const entranceCompletions: Promise<void>[] = []
    displayHand.forEach((card, index) => {
      let node = this.cards.get(card.id)
      const selected = selectedIds.has(card.id)
      const isNew = !node
      if (!node) {
        node = this.cardPrefab ? instantiate(this.cardPrefab) : new Node(`card-${card.id}`)
        if (!node.getComponent(CardView)) node.addComponent(CardView)
        node.parent = this.node
        this.cards.set(card.id, node)
      }
      // The slot owns layout only. CardView keeps selection feedback flat and
      // reserves CardVisual transforms exclusively for the deal entrance.
      const slot = slotByCard.get(card.id)
      const target = new Vec3(slot?.x ?? 0, slot?.y ?? 0, index)
      const view = node.getComponent(CardView)
      view?.bind({
        id: card.id,
        ...mapCardToPresentation(card),
        selected,
        interactive,
      })
      view?.configureFanHitArea(layout.laneSpacing || 78, (slot?.laneIndex ?? index) === layout.laneCount - 1)
      view?.configureStackHitArea(slot?.stackStep ?? 0, slot?.stackIndex ?? 0, slot?.stackSize ?? 1)
      Tween.stopAllByTarget(node)
      if (isNew) node.setPosition(target)
      else if (!node.position.equals(target, 0.1)) tween(node).to(0.18, { position: target }, { easing: 'quadOut' }).start()
      if (isNew) {
        const completion = view?.playEntrance(index * 0.025)
        if (completion) entranceCompletions.push(completion)
      }
    })
    // A locked stack keeps its lane and internal cover order regardless of
    // selection. Only an ungrouped selected card receives top render priority.
    const renderEntries = displayHand
      .map((card, displayIndex) => ({ node: this.cards.get(card.id), selected: selectedIds.has(card.id), displayIndex, slot: slotByCard.get(card.id) }))
      .filter((entry): entry is { node: Node, selected: boolean, displayIndex: number, slot: ReturnType<typeof createHandStackLayout>['slots'][number] } => Boolean(entry.node && entry.slot))
    const orderedNodes = renderEntries.sort((left, right) => {
      const leftSelectedLoose = !left.slot.stackId && left.selected
      const rightSelectedLoose = !right.slot.stackId && right.selected
      if (leftSelectedLoose !== rightSelectedLoose) return leftSelectedLoose ? 1 : -1
      const laneDifference = left.slot.laneIndex - right.slot.laneIndex
      if (laneDifference) return laneDifference
      // Cocos renders the larger sibling index on top. Later downward cards
      // must cover the lower body of the preceding card in the same stack.
      return left.slot.stackIndex - right.slot.stackIndex
    })
    orderedNodes.forEach((entry, index) => entry.node.setSiblingIndex(index))
    if (entranceCompletions.length) {
      const batch = Promise.all(entranceCompletions).then(() => {})
      const previous = this.entranceCompletion
      this.entranceCompletion = previous ? Promise.all([previous, batch]).then(() => {}) : batch
    }
    return layout.maxRise
  }

  private handleCardTouchStart (detail: HandCardTouch): void {
    if (!this.interactive) return
    this.dragSelection.begin(detail.pointerId, detail.cardId, this.selectedCardIds.has(detail.cardId), detail.screenPoint)
  }

  private handleCardTouchMove (detail: HandCardTouch): void {
    if (!this.interactive) return
    const segment = this.dragSelection.move(detail.pointerId, detail.screenPoint)
    if (segment) this.applyDragSegment(segment)
  }

  private handleCardTouchEnd (detail: HandCardTouch): void {
    if (!this.interactive) return
    const finalSegment = this.dragSelection.move(detail.pointerId, detail.screenPoint)
    if (finalSegment) this.applyDragSegment(finalSegment)
    const tap = this.dragSelection.end(detail.pointerId)
    if (tap) this.applySelectionTarget(tap.cardId, tap.selected)
  }

  private handleCardTouchCancel (detail: HandCardTouch): void {
    this.dragSelection.cancel(detail.pointerId)
  }

  private applyDragSegment (segment: Parameters<typeof sampleHandDragSegment>[0]): void {
    for (const point of sampleHandDragSegment(segment)) {
      const cardId = this.findTopCardAt(point)
      if (!cardId) continue
      const selected = this.dragSelection.claim(cardId)
      if (selected !== null) this.applySelectionTarget(cardId, selected)
    }
  }

  private findTopCardAt (screenPoint: Readonly<{ x: number, y: number }>): string | null {
    const point = new Vec2(screenPoint.x, screenPoint.y)
    const topFirst = Array.from(this.cards.entries())
      .filter(([, node]) => node.isValid && node.activeInHierarchy)
      .sort((left, right) => right[1].getSiblingIndex() - left[1].getSiblingIndex())
    for (const [cardId, node] of topFirst) {
      if (node.getComponent(CardView)?.hitTestScreenPoint(point)) return cardId
    }
    return null
  }

  private applySelectionTarget (cardId: string, selected: boolean): void {
    if (!this.cards.has(cardId) || this.selectedCardIds.has(cardId) === selected) return
    if (selected) this.selectedCardIds.add(cardId)
    else this.selectedCardIds.delete(cardId)
    this.node.emit('guandan:card-toggle', cardId)
  }
}
