import { Color, Node, Sprite, SpriteFrame, UIOpacity, UITransform, Vec3, tween } from 'cc'
import { EFFECT_PALETTES, clampEffectCount, rgba, resolveEffectStyle, type EffectLayer, type EffectStyle } from './EffectDesignSystem'
import { EffectHandle } from './EffectHandle'
import { createResponsiveEffectRoot, setEffectLayer, stopTree } from './EffectPrimitives'
import type { EffectRenderer } from './EffectRenderer'
import type { EffectRenderContext } from './EffectRenderContext'
import { isSixBombEffectKey, resolveSixBombRecipe, type SixBombEffectRecipe } from './EffectRecipes'

const PARTICLE_POOL_KEY = 'six-bomb-sprite-particle'
const SIX_BOMB_ASSET_IDS = [
  'bomb.hot-core',
  'bomb.spark-streak',
  'bomb.noise',
  'common.impact-ring',
  'common.flame',
  'common.smoke',
] as const

type SixBombAssetId = typeof SIX_BOMB_ASSET_IDS[number]
type FrameStore = ReadonlyMap<SixBombAssetId, SpriteFrame>
type SixBombTiming = Readonly<{ settleMs: number, releaseMs: number, totalMs: number }>

const seconds = (milliseconds: number): number => Math.max(0, milliseconds) / 1000

const resolveTiming = (style: EffectStyle, requestedDurationMs: number): SixBombTiming => {
  const totalMs = Math.max(360, Math.min(requestedDurationMs, style.timeline.totalMs))
  return Object.freeze({
    settleMs: Math.min(220, Math.round(totalMs * 0.24)),
    releaseMs: Math.max(240, totalMs - Math.min(240, Math.round(totalMs * 0.24))),
    totalMs,
  })
}

const resetPooledSprite = (node: Node): void => {
  node.active = false
  node.setPosition(Vec3.ZERO)
  node.setScale(Vec3.ONE)
  node.setRotationFromEuler(0, 0, 0)
  node.getComponent(UITransform)?.setContentSize(128, 128)
  const sprite = node.getComponent(Sprite)
  if (sprite) {
    sprite.spriteFrame = null
    sprite.color = new Color(255, 255, 255, 255)
    sprite.sizeMode = Sprite.SizeMode.CUSTOM
    sprite.enabled = false
  }
  const opacity = node.getComponent(UIOpacity)
  if (opacity) opacity.opacity = 0
}

const createSpriteNode = (
  parent: Node,
  name: string,
  frame: SpriteFrame | undefined,
  width: number,
  height: number,
  layer: EffectLayer,
  color: Color,
): Node | null => {
  if (!frame) return null
  const node = new Node(name)
  node.parent = parent
  node.addComponent(UITransform).setContentSize(width, height)
  const sprite = node.addComponent(Sprite)
  sprite.type = Sprite.Type.SIMPLE
  sprite.sizeMode = Sprite.SizeMode.CUSTOM
  sprite.spriteFrame = frame
  sprite.color = color
  node.addComponent(UIOpacity)
  setEffectLayer(node, layer)
  return node
}

/** Six-card impact starts after the real card projectile has reached the table. */
export class SixBombRenderer implements EffectRenderer {
  public supports (context: EffectRenderContext): boolean {
    return isSixBombEffectKey(context.profile.key) && context.quality !== 'off' && context.event?.action.cards.length === 6
  }

  public async prepare (context: EffectRenderContext): Promise<boolean> {
    if (!isSixBombEffectKey(context.profile.key) || context.quality === 'off') return false
    if (context.event?.action.cards.length !== 6) return false
    const frames = await this.loadFrames(context)
    return this.hasRequiredFrames(context.quality === 'full', frames)
  }

  public render (context: EffectRenderContext): EffectHandle {
    if (!isSixBombEffectKey(context.profile.key)) return EffectHandle.completed('unavailable')
    const recipe = resolveSixBombRecipe(context.quality)
    if (!recipe) return EffectHandle.completed('quality-off')
    if (context.event?.action.cards.length !== 6) return EffectHandle.completed('unavailable')
    const style = resolveEffectStyle(context.profile.key, context.profile.level, context.quality)
    const timing = resolveTiming(style, recipe.durationMs)
    this.ensureParticlePool(context)

    const root = createResponsiveEffectRoot(context.roots.topRoot, 'Rendered-six-bomb', { layer: style.layers.BACK_FX })
    const pooledNodes = new Set<Node>()
    let shakeHandle: EffectHandle | null = null
    let cardReactionHandle: EffectHandle | null = null
    const handle = new EffectHandle(reason => {
      if (shakeHandle?.isActive) {
        if (reason === 'completed') shakeHandle.complete()
        else shakeHandle.cancel(reason)
      }
      if (cardReactionHandle?.isActive) {
        if (reason === 'completed') cardReactionHandle.complete()
        else cardReactionHandle.cancel(reason)
      }
      shakeHandle = null
      cardReactionHandle = null
      const nodes = Array.from(pooledNodes)
      pooledNodes.clear()
      nodes.forEach(node => context.nodePool.release(node))
      if (!root.isValid) return
      stopTree(root)
      root.destroy()
    })

    void this.loadFrames(context).then(frames => {
      if (!handle.isActive || !root.isValid) return
      if (!this.hasRequiredFrames(context.quality === 'full', frames)) { handle.cancel('unavailable'); return }
      if (recipe.dimAlpha > 0) this.addDimmer(root, recipe, style, timing, frames)
      this.addCore(root, style, timing, frames)
      this.addShockwaves(root, recipe, style, timing, frames)
      this.addParticles(root, context, recipe, style, timing, frames, pooledNodes)
      try {
        cardReactionHandle = context.services?.reactTableCards?.({
          impactWorldPosition: context.targetWorldPosition?.clone() ?? context.roots.topRoot.worldPosition.clone(),
          strength: 'medium',
        }) ?? null
      } catch (error) {
        context.services?.reportError?.(`${context.profile.key}:card-reaction`, error)
      }
      shakeHandle = style.budget.allowShake ? context.services?.shake?.(context.profile.shake) ?? null : null
      if (shakeHandle) {
        handle.addCleanup(reason => {
          if (!shakeHandle?.isActive) return
          if (reason === 'completed') shakeHandle.complete()
          else shakeHandle.cancel(reason)
        })
      }
      tween(root).delay(seconds(timing.totalMs)).call(() => handle.complete()).start()
    }).catch(error => {
      context.services?.reportError?.(context.profile.key, error)
      if (handle.isActive) handle.cancel('failed')
    })
    return handle
  }

  private ensureParticlePool (context: EffectRenderContext): void {
    if (context.nodePool.hasType(PARTICLE_POOL_KEY)) return
    context.nodePool.registerType(PARTICLE_POOL_KEY, () => {
      const node = new Node('SixBombSpriteParticle')
      node.addComponent(UITransform).setContentSize(128, 128)
      const sprite = node.addComponent(Sprite)
      sprite.sizeMode = Sprite.SizeMode.CUSTOM
      sprite.enabled = false
      node.addComponent(UIOpacity)
      node.active = false
      return node
    }, node => resetPooledSprite(node))
  }

  private async loadFrames (context: EffectRenderContext): Promise<FrameStore> {
    const frames = new Map<SixBombAssetId, SpriteFrame>()
    const loader = context.services?.loadSpriteFrame
    if (!loader) return frames
    const results = await Promise.all(SIX_BOMB_ASSET_IDS.map(async (id): Promise<readonly [SixBombAssetId, SpriteFrame | null]> => {
      const asset = context.assets.resolve(id, context.quality)
      if (!asset) return [id, null] as const
      try { return [id, await loader(asset)] as const } catch (error) {
        context.services?.reportError?.(`${context.profile.key}:${id}`, error)
        return [id, null] as const
      }
    }))
    results.forEach(([id, frame]) => { if (frame) frames.set(id, frame) })
    return frames
  }

  private hasRequiredFrames (fullQuality: boolean, frames: FrameStore): boolean {
    const required: SixBombAssetId[] = ['bomb.hot-core', 'bomb.spark-streak', 'common.impact-ring']
    if (fullQuality) required.push('bomb.noise', 'common.flame', 'common.smoke')
    return required.every(id => frames.has(id))
  }

  private addDimmer (root: Node, recipe: SixBombEffectRecipe, style: EffectStyle, timing: SixBombTiming, frames: FrameStore): void {
    if (!style.budget.allowDimmer) return
    const size = root.getComponent(UITransform)?.contentSize
    const node = createSpriteNode(root, 'SixBombBitmapDimmer', frames.get('bomb.noise'), size?.width ?? 1280, size?.height ?? 720, style.layers.DIMMER, rgba(EFFECT_PALETTES.ink.primary))
    if (!node) return
    const opacity = node.getComponent(UIOpacity)!
    opacity.opacity = 0
    tween(opacity).to(0.09, { opacity: Math.min(recipe.dimAlpha, style.dimmerAlpha) }).delay(seconds(Math.max(0, timing.releaseMs - 90))).to(seconds(Math.max(120, timing.totalMs - timing.releaseMs)), { opacity: 0 }).start()
  }

  private addCore (root: Node, style: EffectStyle, timing: SixBombTiming, frames: FrameStore): void {
    const node = createSpriteNode(root, 'SixBombHotCore', frames.get('bomb.hot-core'), 300, 300, style.layers.CORE, rgba(style.palette.highlight))
    if (!node) return
    node.setPosition(new Vec3(0, -26))
    node.setScale(new Vec3(0.3, 0.3, 1))
    const opacity = node.getComponent(UIOpacity)!
    opacity.opacity = 0
    tween(node).to(seconds(timing.settleMs), { scale: new Vec3(1.1, 1.1, 1) }, { easing: style.easing.impact }).to(0.09, { scale: Vec3.ONE }).start()
    tween(opacity).to(0.045, { opacity: 255 }).delay(seconds(Math.max(0, timing.releaseMs - 120))).to(0.12, { opacity: 0 }).start()
  }

  private addShockwaves (root: Node, recipe: SixBombEffectRecipe, style: EffectStyle, timing: SixBombTiming, frames: FrameStore): void {
    const frame = frames.get('common.impact-ring')
    if (!frame) return
    const count = clampEffectCount(recipe.shockwaveCount, style.budget.ringLimit)
    for (let index = 0; index < count; index += 1) {
      const node = createSpriteNode(root, `SixBombShockwave-${index + 1}`, frame, 300, 300, style.layers.BACK_FX, rgba(index % 2 ? style.palette.primary : style.palette.highlight, 230))
      if (!node) continue
      node.setPosition(new Vec3(0, -26))
      node.setScale(new Vec3(0.22, 0.22, 1))
      const opacity = node.getComponent(UIOpacity)!
      opacity.opacity = 0
      const delayMs = index * 58
      tween(node).delay(seconds(delayMs)).to(seconds(Math.max(180, timing.releaseMs - delayMs)), { scale: new Vec3(2.35 + index * 0.2, 2.35 + index * 0.2, 1) }, { easing: style.easing.impact }).start()
      tween(opacity).delay(seconds(delayMs)).to(0.04, { opacity: 220 }).delay(0.12).to(0.18, { opacity: 0 }).start()
    }
  }

  private acquireParticle (context: EffectRenderContext, root: Node, pooledNodes: Set<Node>, name: string, frame: SpriteFrame | undefined, width: number, height: number, layer: EffectLayer, color: Color): Node | null {
    if (!frame) return null
    const node = context.nodePool.acquire(PARTICLE_POOL_KEY)
    node.name = name
    node.parent = root
    node.getComponent(UITransform)?.setContentSize(width, height)
    const sprite = node.getComponent(Sprite)!
    sprite.enabled = false
    sprite.spriteFrame = frame
    sprite.color = color
    sprite.sizeMode = Sprite.SizeMode.CUSTOM
    node.getComponent(UIOpacity)!.opacity = 0
    setEffectLayer(node, layer)
    pooledNodes.add(node)
    sprite.enabled = true
    node.active = true
    return node
  }

  private addParticles (root: Node, context: EffectRenderContext, recipe: SixBombEffectRecipe, style: EffectStyle, timing: SixBombTiming, frames: FrameStore, pooledNodes: Set<Node>): void {
    const sparkCount = clampEffectCount(recipe.sparkCount, Math.ceil(style.budget.particleLimit * 0.62))
    const flameCount = clampEffectCount(recipe.flameCount, style.budget.particleLimit - sparkCount)
    const smokeCount = style.budget.allowSmoke ? clampEffectCount(recipe.smokeCount, style.budget.smokeLimit) : 0
    for (let index = 0; index < sparkCount; index += 1) this.addSpark(root, context, style, timing, frames, pooledNodes, index, sparkCount)
    for (let index = 0; index < flameCount; index += 1) this.addFlame(root, context, style, timing, frames, pooledNodes, index, flameCount)
    for (let index = 0; index < smokeCount; index += 1) this.addSmoke(root, context, style, timing, frames, pooledNodes, index, smokeCount)
  }

  private addSpark (root: Node, context: EffectRenderContext, style: EffectStyle, timing: SixBombTiming, frames: FrameStore, pooledNodes: Set<Node>, index: number, count: number): void {
    const node = this.acquireParticle(context, root, pooledNodes, `SixBombSpark-${index + 1}`, frames.get('bomb.spark-streak'), 58, 18, style.layers.PARTICLE, rgba(index % 3 ? style.palette.primary : style.palette.highlight, 248))
    if (!node) return
    const angle = index / Math.max(1, count) * Math.PI * 2 + (index % 4) * 0.08
    const distance = 184 + (index % 5) * 24
    node.setPosition(new Vec3(Math.cos(angle) * 28, -26 + Math.sin(angle) * 22))
    node.setRotationFromEuler(0, 0, angle * 180 / Math.PI)
    const opacity = node.getComponent(UIOpacity)!
    const delayMs = index % 6 * 14
    tween(node).delay(seconds(delayMs)).to(seconds(Math.max(160, timing.releaseMs - delayMs)), { position: new Vec3(Math.cos(angle) * distance, -26 + Math.sin(angle) * distance * 0.7), scale: new Vec3(0.28, 0.28, 1) }, { easing: style.easing.travelOut }).start()
    tween(opacity).delay(seconds(delayMs)).to(0.035, { opacity: 255 }).delay(0.16).to(0.16, { opacity: 0 }).start()
  }

  private addFlame (root: Node, context: EffectRenderContext, style: EffectStyle, timing: SixBombTiming, frames: FrameStore, pooledNodes: Set<Node>, index: number, count: number): void {
    const node = this.acquireParticle(context, root, pooledNodes, `SixBombFlame-${index + 1}`, frames.get('common.flame'), 96, 126, style.layers.PARTICLE, rgba(index % 2 ? style.palette.primary : style.palette.secondary, 220))
    if (!node) return
    const angle = index / Math.max(1, count) * Math.PI * 2
    const x = Math.cos(angle) * (112 + index % 3 * 18)
    const y = -24 + Math.sin(angle) * 72
    node.setPosition(new Vec3(x, y))
    node.setScale(new Vec3(0.22, 0.22, 1))
    const opacity = node.getComponent(UIOpacity)!
    const delayMs = 28 + index * 18
    tween(node).delay(seconds(delayMs)).to(seconds(timing.settleMs), { scale: new Vec3(0.72, 0.98, 1), position: new Vec3(x * 1.08, y + 28) }, { easing: style.easing.impact }).to(0.2, { scale: new Vec3(0.38, 0.54, 1), position: new Vec3(x * 1.12, y + 64) }).start()
    tween(opacity).delay(seconds(delayMs)).to(0.04, { opacity: 225 }).delay(0.22).to(0.18, { opacity: 0 }).start()
  }

  private addSmoke (root: Node, context: EffectRenderContext, style: EffectStyle, timing: SixBombTiming, frames: FrameStore, pooledNodes: Set<Node>, index: number, count: number): void {
    const node = this.acquireParticle(context, root, pooledNodes, `SixBombSmoke-${index + 1}`, frames.get('common.smoke'), 150, 150, style.layers.BACK_FX, rgba(EFFECT_PALETTES.neutral.primary, 155))
    if (!node) return
    const angle = index / Math.max(1, count) * Math.PI * 2 + 0.45
    const x = Math.cos(angle) * 88
    const y = -28 + Math.sin(angle) * 58
    node.setPosition(new Vec3(x, y))
    node.setScale(new Vec3(0.3, 0.3, 1))
    const opacity = node.getComponent(UIOpacity)!
    const delayMs = timing.settleMs + index * 24
    tween(node).delay(seconds(delayMs)).to(seconds(Math.max(180, timing.totalMs - delayMs)), { scale: Vec3.ONE, position: new Vec3(x * 1.16, y + 62 + index * 5) }, { easing: style.easing.settle }).start()
    tween(opacity).delay(seconds(delayMs)).to(0.08, { opacity: 150 }).delay(seconds(Math.max(0, timing.releaseMs - delayMs - 80))).to(seconds(Math.max(100, timing.totalMs - timing.releaseMs)), { opacity: 0 }).start()
  }

}
