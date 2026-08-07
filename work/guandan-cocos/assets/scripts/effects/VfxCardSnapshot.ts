import { _decorator, Component, Node, Sprite, SpriteFrame, UIOpacity, UITransform, Vec3 } from 'cc'
import type { Card } from '../core/generated'
import { getCachedClassicCardFrames, preloadClassicCardFrames, requestClassicCardFrames } from '../ui/ClassicCardFrameStore'
import { resolveClassicCardPlan } from '../ui/CardSkinResolver'
import type { ClassicCardPlan } from '../ui/CardSkinResolver'
import { cardDisplay } from './EffectTypes'

const { ccclass } = _decorator

const DEFAULT_WIDTH = 82
const DEFAULT_HEIGHT = 118

type SnapshotLayer = 'background' | 'cornerRank' | 'cornerSuit' | 'center'

type LayerGeometry = Readonly<{
  width: number
  height: number
  x: number
  y: number
  z: number
}>

const BASE_LAYER_GEOMETRY: Readonly<Record<SnapshotLayer, LayerGeometry>> = Object.freeze({
  background: Object.freeze({ width: 76, height: 112, x: 0, y: 0, z: 0 }),
  cornerRank: Object.freeze({ width: 20, height: 28, x: -26, y: 39, z: 2 }),
  cornerSuit: Object.freeze({ width: 18, height: 19, x: -26, y: 14, z: 2 }),
  center: Object.freeze({ width: 43, height: 45, x: 7, y: -15, z: 1 }),
})

function planForCard (card: Card): ClassicCardPlan | null {
  return resolveClassicCardPlan(cardDisplay(card))
}

export type VfxCardSnapshotOptions = Readonly<{
  name?: string
  width?: number
  height?: number
}>

export type VfxCardSnapshotInstance = Readonly<{
  node: Node
  ready: Promise<boolean>
}>

/**
 * A display-only card face for VFX. Every visible layer is licensed bitmap art;
 * an incomplete texture set stays hidden instead of falling back to runtime art.
 */
@ccclass('VfxCardSnapshot')
export class VfxCardSnapshot extends Component {
  private artworkRoot: Node | null = null
  private readonly layers = new Map<SnapshotLayer, Sprite>()
  private width = DEFAULT_WIDTH
  private height = DEFAULT_HEIGHT
  private requestId = 0
  private expectedPlanKey = ''

  protected onLoad (): void { this.ensureStructure() }

  protected onDestroy (): void {
    this.expectedPlanKey = ''
    this.requestId += 1
  }

  public configure (options: Pick<VfxCardSnapshotOptions, 'width' | 'height'> = {}): void {
    this.width = Math.max(1, options.width ?? DEFAULT_WIDTH)
    this.height = Math.max(1, options.height ?? DEFAULT_HEIGHT)
    this.ensureStructure()
    this.layoutLayers()
  }

  public bind (card: Card): Promise<boolean> {
    this.ensureStructure()
    const requestId = ++this.requestId
    this.hideArtwork(false)
    const plan = planForCard(card)
    this.expectedPlanKey = plan?.key ?? ''
    if (!plan) return Promise.resolve(false)

    const cached = getCachedClassicCardFrames(plan)
    if (cached) {
      this.applyPlan(plan, cached)
      return Promise.resolve(true)
    }

    return requestClassicCardFrames(plan)
      .then(frames => {
        if (!frames || requestId !== this.requestId || !this.node.isValid || this.expectedPlanKey !== plan.key) return false
        this.applyPlan(plan, frames)
        return true
      })
  }

  /** Invalidates pending loads and removes the previous face before pooling. */
  public hide (): void {
    this.requestId += 1
    this.expectedPlanKey = ''
    this.hideArtwork(true)
  }

  private ensureStructure (): void {
    const transform = this.node.getComponent(UITransform) ?? this.node.addComponent(UITransform)
    transform.setContentSize(this.width, this.height)
    if (!this.node.getComponent(UIOpacity)) this.node.addComponent(UIOpacity)
    if (this.artworkRoot) return

    const artworkRoot = new Node('VfxCardArtwork')
    artworkRoot.parent = this.node
    artworkRoot.active = false
    this.artworkRoot = artworkRoot
    this.layers.set('background', this.createLayer(artworkRoot, 'VfxCardBackground'))
    this.layers.set('cornerRank', this.createLayer(artworkRoot, 'VfxCardCornerRank'))
    this.layers.set('cornerSuit', this.createLayer(artworkRoot, 'VfxCardCornerSuit'))
    this.layers.set('center', this.createLayer(artworkRoot, 'VfxCardCenter'))
    this.layoutLayers()
  }

  private createLayer (parent: Node, name: string): Sprite {
    const node = new Node(name)
    node.parent = parent
    node.addComponent(UITransform)
    const sprite = node.addComponent(Sprite)
    sprite.type = Sprite.Type.SIMPLE
    sprite.sizeMode = Sprite.SizeMode.CUSTOM
    node.active = false
    return sprite
  }

  private layoutLayers (): void {
    const scaleX = this.width / DEFAULT_WIDTH
    const scaleY = this.height / DEFAULT_HEIGHT
    for (const [layer, sprite] of this.layers) {
      const geometry = BASE_LAYER_GEOMETRY[layer]
      sprite.node.setPosition(new Vec3(geometry.x * scaleX, geometry.y * scaleY, geometry.z))
      sprite.node.getComponent(UITransform)?.setContentSize(geometry.width * scaleX, geometry.height * scaleY)
    }
  }

  private applyPlan (plan: ClassicCardPlan, frames: ReadonlyMap<string, SpriteFrame>): void {
    this.setLayerFrame('background', frames.get(plan.background) ?? null)
    this.setLayerFrame('cornerRank', plan.cornerRank ? frames.get(plan.cornerRank) ?? null : null)
    this.setLayerFrame('cornerSuit', plan.cornerSuit ? frames.get(plan.cornerSuit) ?? null : null)
    const centerAsset = plan.joker ?? plan.center
    this.setLayerFrame('center', centerAsset ? frames.get(centerAsset) ?? null : null)
    this.layoutCenter(plan)
    if (this.artworkRoot) this.artworkRoot.active = true
  }

  private layoutCenter (plan: ClassicCardPlan): void {
    const center = this.layers.get('center')?.node
    const transform = center?.getComponent(UITransform)
    if (!center || !transform) return
    const scaleX = this.width / DEFAULT_WIDTH
    const scaleY = this.height / DEFAULT_HEIGHT
    if (plan.joker) {
      center.setPosition(new Vec3(0, 0, 1))
      transform.setContentSize(72 * scaleX, 106 * scaleY)
    } else if (plan.center?.startsWith('role_')) {
      center.setPosition(new Vec3(7 * scaleX, -9 * scaleY, 1))
      transform.setContentSize(63 * scaleX, 87 * scaleY)
    } else {
      const geometry = BASE_LAYER_GEOMETRY.center
      center.setPosition(new Vec3(geometry.x * scaleX, geometry.y * scaleY, geometry.z))
      transform.setContentSize(geometry.width * scaleX, geometry.height * scaleY)
    }
  }

  private setLayerFrame (layer: SnapshotLayer, frame: SpriteFrame | null): void {
    const sprite = this.layers.get(layer)
    if (!sprite) return
    sprite.spriteFrame = frame
    sprite.node.active = Boolean(frame)
  }

  private hideArtwork (clearFrames: boolean): void {
    if (this.artworkRoot) this.artworkRoot.active = false
    if (!clearFrames) return
    this.layers.forEach(sprite => {
      sprite.spriteFrame = null
      sprite.node.active = false
    })
  }
}

/** Creates a renderer-owned snapshot; callers may await `ready` before timing. */
export function createVfxCardSnapshot (parent: Node, card: Card, options: VfxCardSnapshotOptions = {}): VfxCardSnapshotInstance {
  const node = new Node(options.name ?? 'VfxCardSnapshot')
  node.parent = parent
  const snapshot = node.addComponent(VfxCardSnapshot)
  snapshot.configure(options)
  return { node, ready: snapshot.bind(card) }
}

/** Warms the shared texture/frame cache for an effect's complete card set. */
export function preloadVfxCardFrames (cards: readonly Card[]): Promise<boolean> {
  const plans = cards.map(planForCard)
  if (plans.some(plan => !plan)) return Promise.resolve(false)
  return preloadClassicCardFrames(plans as ClassicCardPlan[])
}
