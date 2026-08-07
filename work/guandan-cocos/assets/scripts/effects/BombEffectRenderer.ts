import { Color, Node, Sprite, SpriteFrame, UIOpacity, UITransform, Vec3, tween } from 'cc'
import { clampEffectCount, resolveEffectStyle, rgba, type EffectStyle } from './EffectDesignSystem'
import { EffectHandle } from './EffectHandle'
import { createResponsiveEffectRoot, setEffectLayer, stopTree } from './EffectPrimitives'
import type { EffectRenderer } from './EffectRenderer'
import type { EffectRenderContext } from './EffectRenderContext'
import { isBombEffectKey, resolveBombRecipe, type BombEffectRecipe } from './EffectRecipes'

const PROJECTILE_POOL_KEY = 'bomb-projectile-sprite'
const PARTICLE_POOL_KEY = 'bomb-transient-sprite'
const BOMB_ASSET_IDS = [
  'bomb.body',
  'bomb.trail',
  'bomb.hot-core',
  'bomb.spark-streak',
  'bomb.debris',
] as const

type BombAssetId = typeof BOMB_ASSET_IDS[number]
type FrameStore = ReadonlyMap<BombAssetId, SpriteFrame>
type BombImpactHandles = Readonly<{
  shake: EffectHandle | null
  cardReaction: EffectHandle | null
}>

const resetPooledSprite = (node: Node): void => {
  // An acquired node stays hidden until a valid SpriteFrame is configured.
  // This prevents an active-but-invisible projectile during async loading.
  node.active = false
  node.setPosition(Vec3.ZERO)
  node.setScale(Vec3.ONE)
  node.setRotationFromEuler(0, 0, 0)
  const transform = node.getComponent(UITransform)
  transform?.setContentSize(160, 160)
  transform?.setAnchorPoint(0.5, 0.5)
  const sprite = node.getComponent(Sprite)
  if (sprite) {
    sprite.enabled = false
    sprite.spriteFrame = null
    sprite.color = new Color(255, 255, 255, 255)
    sprite.sizeMode = Sprite.SizeMode.CUSTOM
  }
  const opacity = node.getComponent(UIOpacity)
  if (opacity) opacity.opacity = 255
}

const makePooledSprite = (name: string): Node => {
  const node = new Node(name)
  node.addComponent(UITransform).setContentSize(160, 160)
  const sprite = node.addComponent(Sprite)
  sprite.enabled = false
  sprite.sizeMode = Sprite.SizeMode.CUSTOM
  node.addComponent(UIOpacity)
  node.active = false
  return node
}

const quadraticPoint = (start: Vec3, control: Vec3, end: Vec3, t: number): Vec3 => {
  const inverse = 1 - t
  return new Vec3(
    inverse * inverse * start.x + 2 * inverse * t * control.x + t * t * end.x,
    inverse * inverse * start.y + 2 * inverse * t * control.y + t * t * end.y,
    start.z + (end.z - start.z) * t,
  )
}

const quadraticTangentAngle = (start: Vec3, control: Vec3, end: Vec3, t: number): number => {
  const x = 2 * (1 - t) * (control.x - start.x) + 2 * t * (end.x - control.x)
  const y = 2 * (1 - t) * (control.y - start.y) + 2 * t * (end.y - control.y)
  return Math.atan2(y, x) * 180 / Math.PI
}

/** Sprite-only bomb throw and impact. Missing textures skip their own visual layer. */
export class BombEffectRenderer implements EffectRenderer {
  public supports (context: EffectRenderContext): boolean {
    return isBombEffectKey(context.profile.key) && context.quality !== 'off'
  }

  public async prepare (context: EffectRenderContext): Promise<boolean> {
    if (!isBombEffectKey(context.profile.key) || context.quality === 'off') return false
    await this.loadFrames(context)
    // Missing optional layers are handled independently by render(); preparation
    // only guarantees that cold asset requests have settled before queue release.
    return true
  }

  public render (context: EffectRenderContext): EffectHandle {
    if (!isBombEffectKey(context.profile.key)) return EffectHandle.completed('unavailable')
    const recipe = resolveBombRecipe(context.profile.key, context.quality)
    if (!recipe) return EffectHandle.completed('quality-off')
    const style = resolveEffectStyle(context.profile.key, context.profile.level, context.quality)
    this.ensurePools(context)

    // The whole bomb must sit above other transient top-root feedback. Internal
    // layers still order trail, body, impact and copy relative to each other.
    const root = createResponsiveEffectRoot(context.roots.topRoot, `Rendered-${recipe.key}`, { layer: style.layers.COPY })
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

    const rootTransform = root.getComponent(UITransform)
    const targetWorld = context.targetWorldPosition?.clone() ?? context.roots.topRoot.worldPosition.clone()
    const fallbackSource = targetWorld.clone().add(new Vec3(-280, -160, 0))
    const sourceWorld = context.sourceWorldPositions?.[0]?.clone() ?? fallbackSource
    const toLocal = (world: Vec3): Vec3 => rootTransform?.convertToNodeSpaceAR(world) ?? world.clone()
    const source = toLocal(sourceWorld)
    const target = toLocal(targetWorld)

    void this.loadFrames(context).then(frames => {
      if (!handle.isActive || !root.isValid) return
      const impact = (): void => {
        if (!handle.isActive) return
        try {
          const impactHandles = this.beginExplosion(root, target, context, recipe, style, handle, frames, pooledNodes)
          shakeHandle = impactHandles.shake
          cardReactionHandle = impactHandles.cardReaction
        } catch (error) {
          context.services?.reportError?.(context.profile.key, error)
          handle.cancel('failed')
        }
      }
      this.beginProjectile(root, source, target, context, recipe, style, handle, frames, pooledNodes, impact)
    }).catch(error => {
      context.services?.reportError?.(context.profile.key, error)
      if (handle.isActive) handle.cancel('failed')
    })
    return handle
  }

  private ensurePools (context: EffectRenderContext): void {
    if (!context.nodePool.hasType(PROJECTILE_POOL_KEY)) {
      context.nodePool.registerType(PROJECTILE_POOL_KEY, () => makePooledSprite('BombProjectile'), node => resetPooledSprite(node))
    }
    if (!context.nodePool.hasType(PARTICLE_POOL_KEY)) {
      context.nodePool.registerType(PARTICLE_POOL_KEY, () => makePooledSprite('BombParticle'), node => resetPooledSprite(node))
    }
  }

  private async loadFrames (context: EffectRenderContext): Promise<FrameStore> {
    const frames = new Map<BombAssetId, SpriteFrame>()
    const loader = context.services?.loadSpriteFrame
    if (!loader) return frames
    const results = await Promise.all(BOMB_ASSET_IDS.map(async (id): Promise<readonly [BombAssetId, SpriteFrame | null]> => {
      const asset = context.assets.resolve(id, context.quality)
      if (!asset) return [id, null] as const
      try {
        return [id, await loader(asset)] as const
      } catch (error) {
        context.services?.reportError?.(`${context.profile.key}:${id}`, error)
        return [id, null] as const
      }
    }))
    results.forEach(([id, frame]) => { if (frame) frames.set(id, frame) })
    return frames
  }

  /** Applies the frame while hidden, then exposes a fully configured Sprite. */
  private acquireSprite (
    context: EffectRenderContext,
    key: string,
    name: string,
    parent: Node,
    pooledNodes: Set<Node>,
    frame: SpriteFrame,
    width: number,
    height: number,
    color: Color,
  ): Node {
    const node = context.nodePool.acquire(key)
    node.name = name
    node.parent = parent
    const sprite = node.getComponent(Sprite)!
    sprite.enabled = false
    sprite.sizeMode = Sprite.SizeMode.CUSTOM
    sprite.spriteFrame = frame
    sprite.color = color
    node.getComponent(UITransform)?.setContentSize(width, height)
    node.getComponent(UIOpacity)!.opacity = 255
    pooledNodes.add(node)
    sprite.enabled = true
    node.active = true
    return node
  }

  private releaseSprite (context: EffectRenderContext, node: Node, pooledNodes: Set<Node>): void {
    if (!pooledNodes.delete(node)) return
    context.nodePool.release(node)
  }

  private beginProjectile (
    root: Node,
    source: Vec3,
    target: Vec3,
    context: EffectRenderContext,
    recipe: BombEffectRecipe,
    style: EffectStyle,
    handle: EffectHandle,
    frames: FrameStore,
    pooledNodes: Set<Node>,
    onImpact: () => void,
  ): void {
    const frame = frames.get('bomb.body')
    if (!frame) {
      // Preserve arrival-synchronised audio/explosion even when the projectile
      // layer is unavailable. No invisible projectile node is acquired.
      tween(root).delay(Math.max(0, context.profile.flightMs) / 1000).call(onImpact).start()
      return
    }
    const projectile = this.acquireSprite(
      context,
      PROJECTILE_POOL_KEY,
      'BombProjectile',
      root,
      pooledNodes,
      frame,
      128,
      128,
      new Color(255, 255, 255, 255),
    )
    projectile.getComponent(UITransform)?.setAnchorPoint(0.46, 0.44)
    projectile.setPosition(source)
    setEffectLayer(projectile, style.layers.SUBJECT)
    this.playProjectile(root, projectile, source, target, context, recipe, style, handle, frames, pooledNodes, () => {
      this.releaseSprite(context, projectile, pooledNodes)
      onImpact()
    })
  }

  private playProjectile (
    root: Node,
    projectile: Node,
    source: Vec3,
    target: Vec3,
    context: EffectRenderContext,
    recipe: BombEffectRecipe,
    style: EffectStyle,
    handle: EffectHandle,
    frames: FrameStore,
    pooledNodes: Set<Node>,
    onImpact: () => void,
  ): void {
    const distance = Math.hypot(target.x - source.x, target.y - source.y)
    const arcHeight = Math.max(88, Math.min(210, distance * 0.32))
    const control = new Vec3((source.x + target.x) / 2, (source.y + target.y) / 2 + arcHeight, Math.max(source.z, target.z) + 2)
    const seconds = Math.max(0, context.profile.flightMs) / 1000
    if (seconds <= 0) { projectile.setPosition(target); onImpact(); return }
    const requestedTrails = Math.max(7, Math.ceil(recipe.sparkCount * 0.72))
    const trailCount = style.budget.allowTrails
      ? clampEffectCount(requestedTrails, Math.min(style.budget.particleLimit, style.budget.trailLimit * 4))
      : 0
    let emitted = 0
    tween(projectile)
      .update(seconds, (_node, rawRatio) => {
        if (!handle.isActive) return
        const ratio = rawRatio ?? 0
        const t = (1 - Math.cos(Math.PI * ratio)) / 2
        projectile.setPosition(quadraticPoint(source, control, target, t))
        projectile.setRotationFromEuler(0, 0, (source.x <= target.x ? -1 : 1) * 520 * t)
        const pulse = 0.9 + Math.sin(Math.PI * t) * 0.18
        projectile.setScale(new Vec3(pulse, pulse, 1))
        const targetTrailCount = Math.min(trailCount, Math.floor(ratio * trailCount) + 1)
        while (emitted < targetTrailCount) {
          const trailT = Math.min(1, emitted / Math.max(1, trailCount - 1))
          this.addTrail(
            root,
            quadraticPoint(source, control, target, trailT),
            quadraticTangentAngle(source, control, target, trailT),
            context,
            style,
            frames,
            pooledNodes,
          )
          emitted += 1
        }
      })
      .call(onImpact)
      .start()
  }

  private addTrail (
    root: Node,
    position: Vec3,
    angle: number,
    context: EffectRenderContext,
    style: EffectStyle,
    frames: FrameStore,
    pooledNodes: Set<Node>,
  ): void {
    const frame = frames.get('bomb.trail')
    if (!frame) return
    const node = this.acquireSprite(context, PARTICLE_POOL_KEY, 'BombTrail', root, pooledNodes, frame, 112, 28, rgba(style.palette.highlight, 218))
    node.getComponent(UITransform)?.setAnchorPoint(0.82, 0.5)
    setEffectLayer(node, style.layers.TRAIL)
    node.setPosition(position)
    node.setRotationFromEuler(0, 0, angle + 180)
    node.setScale(new Vec3(0.82, 0.82, 1))
    const opacity = node.getComponent(UIOpacity)!
    tween(node).to(0.22, { scale: new Vec3(0.22, 0.22, 1) }, { easing: style.easing.settle }).call(() => this.releaseSprite(context, node, pooledNodes)).start()
    tween(opacity).to(0.22, { opacity: 0 }).start()
  }

  private beginExplosion (
    root: Node,
    target: Vec3,
    context: EffectRenderContext,
    recipe: BombEffectRecipe,
    style: EffectStyle,
    handle: EffectHandle,
    frames: FrameStore,
    pooledNodes: Set<Node>,
  ): BombImpactHandles {
    const impact = new Node('BombImpact')
    impact.parent = root
    impact.setPosition(target)
    impact.addComponent(UITransform).setContentSize(720, 620)
    setEffectLayer(impact, style.layers.CORE)

    this.addHotCore(impact, context, recipe, style, frames, pooledNodes)
    const ringCount = clampEffectCount(recipe.ringCount, style.budget.ringLimit)
    for (let index = 0; index < ringCount; index += 1) this.addWave(impact, context, index, recipe.scale, style, frames, pooledNodes)
    const sparkCount = clampEffectCount(recipe.sparkCount, Math.ceil(style.budget.particleLimit * 0.55))
    const flameCount = clampEffectCount(recipe.flameCount, style.budget.particleLimit - sparkCount)
    const requestedDebris = flameCount > 0 ? Math.max(4, Math.ceil(sparkCount * 0.46)) : 0
    const debrisCount = clampEffectCount(requestedDebris, style.budget.particleLimit - sparkCount - flameCount)
    const smokeCount = style.budget.allowSmoke ? clampEffectCount(recipe.smokeCount, style.budget.smokeLimit) : 0
    for (let index = 0; index < sparkCount; index += 1) this.addSpark(impact, context, index, sparkCount, recipe.scale, style, frames, pooledNodes)
    for (let index = 0; index < flameCount; index += 1) this.addFlame(impact, context, index, flameCount, recipe.scale, style, frames, pooledNodes)
    for (let index = 0; index < smokeCount; index += 1) this.addSmoke(impact, context, index, smokeCount, recipe.scale, style, frames, pooledNodes)
    for (let index = 0; index < debrisCount; index += 1) this.addDebris(impact, context, index, debrisCount, recipe.scale, style, frames, pooledNodes)
    tween(root).delay(recipe.durationMs / 1000).call(() => handle.complete()).start()
    if (context.profile.sound) {
      try { context.services?.playSound?.(context.profile.sound) } catch (error) { context.services?.reportError?.(`${context.profile.key}:sound`, error) }
    }
    try { context.services?.vibrate?.(context.profile.haptic) } catch (error) { context.services?.reportError?.(`${context.profile.key}:haptic`, error) }
    try { context.services?.notifyImpact?.() } catch (error) { context.services?.reportError?.(`${context.profile.key}:impact`, error) }
    let cardReaction: EffectHandle | null = null
    const strength = recipe.key === 'bomb-small' ? 'light' : recipe.key === 'bomb-medium' ? 'medium' : 'strong'
    try {
      cardReaction = context.services?.reactTableCards?.({
        impactWorldPosition: context.targetWorldPosition?.clone() ?? context.roots.topRoot.worldPosition.clone(),
        strength,
      }) ?? null
    } catch (error) {
      context.services?.reportError?.(`${context.profile.key}:card-reaction`, error)
    }
    let shake: EffectHandle | null = null
    if (style.budget.allowShake) {
      try { shake = context.services?.shake?.(context.profile.shake) ?? null } catch (error) { context.services?.reportError?.(`${context.profile.key}:shake`, error) }
    }
    return { shake, cardReaction }
  }

  private addHotCore (
    root: Node,
    context: EffectRenderContext,
    recipe: BombEffectRecipe,
    style: EffectStyle,
    frames: FrameStore,
    pooledNodes: Set<Node>,
  ): void {
    const frame = frames.get('bomb.hot-core')
    if (!frame) return
    if (recipe.flashAlpha > 0) {
      const flash = this.acquireSprite(context, PARTICLE_POOL_KEY, 'BombImpactFlash', root, pooledNodes, frame, 360, 360, new Color(255, 255, 255, recipe.flashAlpha))
      setEffectLayer(flash, style.layers.CORE)
      flash.setScale(new Vec3(0.12, 0.12, 1))
      const flashOpacity = flash.getComponent(UIOpacity)!
      tween(flash).to(0.09, { scale: new Vec3(recipe.scale * 1.5, recipe.scale * 1.5, 1) }, { easing: style.easing.impact }).call(() => this.releaseSprite(context, flash, pooledNodes)).start()
      tween(flashOpacity).to(0.09, { opacity: 0 }).start()
    }
    const node = this.acquireSprite(context, PARTICLE_POOL_KEY, 'BombHotCore', root, pooledNodes, frame, 280, 280, new Color(255, 255, 255, 255))
    setEffectLayer(node, style.layers.CORE)
    node.setPosition(new Vec3(0, 0, 3))
    node.setScale(new Vec3(0.12, 0.12, 1))
    const opacity = node.getComponent(UIOpacity)!
    tween(node).to(0.13, { scale: new Vec3(recipe.scale * 1.08, recipe.scale * 1.08, 1) }, { easing: style.easing.impact }).to(0.22, { scale: new Vec3(recipe.scale * 0.5, recipe.scale * 0.5, 1) }, { easing: style.easing.settle }).call(() => this.releaseSprite(context, node, pooledNodes)).start()
    tween(opacity).delay(0.11).to(0.24, { opacity: 0 }).start()
  }

  private addWave (
    root: Node,
    context: EffectRenderContext,
    index: number,
    scale: number,
    style: EffectStyle,
    frames: FrameStore,
    pooledNodes: Set<Node>,
  ): void {
    const frame = frames.get('bomb.hot-core')
    if (!frame) return
    const alpha = 150 - index * 28
    const node = this.acquireSprite(context, PARTICLE_POOL_KEY, `BombWave-${index + 1}`, root, pooledNodes, frame, 300, 300, rgba(style.palette.primary, alpha))
    setEffectLayer(node, style.layers.BACK_FX)
    node.setScale(new Vec3(0.16, 0.16, 1))
    const opacity = node.getComponent(UIOpacity)!
    const delay = index * 0.052
    const duration = 0.34 + index * 0.05
    tween(node).delay(delay).to(duration, { scale: new Vec3(scale * (1.42 + index * 0.3), scale * (1.42 + index * 0.3), 1) }, { easing: style.easing.impact }).call(() => this.releaseSprite(context, node, pooledNodes)).start()
    tween(opacity).delay(delay + 0.07).to(duration - 0.04, { opacity: 0 }).start()
  }

  private addSpark (
    root: Node,
    context: EffectRenderContext,
    index: number,
    count: number,
    scale: number,
    style: EffectStyle,
    frames: FrameStore,
    pooledNodes: Set<Node>,
  ): void {
    const frame = frames.get('bomb.spark-streak')
    if (!frame) return
    const angle = index / Math.max(1, count) * Math.PI * 2 + index % 3 * 0.11
    const radius = (118 + index % 5 * 22) * scale
    const node = this.acquireSprite(context, PARTICLE_POOL_KEY, `BombSpark-${index + 1}`, root, pooledNodes, frame, 72 + index % 3 * 10, 18, new Color(255, 255, 255, 250))
    node.getComponent(UITransform)?.setAnchorPoint(0.82, 0.5)
    node.setRotationFromEuler(0, 0, angle * 180 / Math.PI)
    node.setPosition(new Vec3(Math.cos(angle) * 20, Math.sin(angle) * 16, 8))
    setEffectLayer(node, style.layers.PARTICLE)
    const opacity = node.getComponent(UIOpacity)!
    const delay = index % 5 * 0.016
    const duration = 0.24 + index % 3 * 0.035
    const end = new Vec3(Math.cos(angle) * radius, Math.sin(angle) * radius * 0.82, 8)
    tween(node).delay(delay).to(duration, { position: end, scale: new Vec3(0.38, 0.38, 1) }, { easing: style.easing.travelOut }).call(() => this.releaseSprite(context, node, pooledNodes)).start()
    tween(opacity).delay(delay + 0.09).to(duration - 0.04, { opacity: 0 }).start()
  }

  private addFlame (
    root: Node,
    context: EffectRenderContext,
    index: number,
    count: number,
    scale: number,
    style: EffectStyle,
    frames: FrameStore,
    pooledNodes: Set<Node>,
  ): void {
    const frame = frames.get('bomb.trail')
    if (!frame) return
    const angle = index / Math.max(1, count) * Math.PI * 2 + 0.28
    const node = this.acquireSprite(context, PARTICLE_POOL_KEY, `BombFlame-${index + 1}`, root, pooledNodes, frame, 118, 34, rgba(style.palette.highlight, 225))
    const start = new Vec3(Math.cos(angle) * 25, Math.sin(angle) * 18, 5)
    node.setPosition(start)
    setEffectLayer(node, style.layers.PARTICLE)
    node.setRotationFromEuler(0, 0, angle * 180 / Math.PI)
    node.setScale(new Vec3(0.18, 0.18, 1))
    const opacity = node.getComponent(UIOpacity)!
    const delay = index * 0.022
    const end = new Vec3(Math.cos(angle) * 62, Math.sin(angle) * 48 + 26, 5)
    tween(node).delay(delay).to(0.21, { scale: new Vec3(scale * 0.8, scale, 1), position: end }, { easing: style.easing.impact }).to(0.2, { scale: new Vec3(scale * 0.35, scale * 0.5, 1), position: new Vec3(end.x * 1.08, end.y + 48, 5) }, { easing: style.easing.settle }).call(() => this.releaseSprite(context, node, pooledNodes)).start()
    tween(opacity).delay(0.16 + delay).to(0.26, { opacity: 0 }).start()
  }

  private addSmoke (
    root: Node,
    context: EffectRenderContext,
    index: number,
    count: number,
    scale: number,
    style: EffectStyle,
    frames: FrameStore,
    pooledNodes: Set<Node>,
  ): void {
    const frame = frames.get('bomb.hot-core')
    if (!frame) return
    const angle = index / Math.max(1, count) * Math.PI * 2 + 0.7
    const node = this.acquireSprite(context, PARTICLE_POOL_KEY, `BombSmoke-${index + 1}`, root, pooledNodes, frame, 180, 180, rgba(style.palette.primary, 58))
    setEffectLayer(node, style.layers.BACK_FX)
    const start = new Vec3(Math.cos(angle) * 27, Math.sin(angle) * 20, 0)
    node.setPosition(start)
    node.setScale(new Vec3(0.25, 0.25, 1))
    const opacity = node.getComponent(UIOpacity)!
    opacity.opacity = 0
    const delay = 0.07 + index * 0.04
    const end = new Vec3(Math.cos(angle) * 48, 48 + index * 16, 0)
    tween(node).delay(delay).to(0.5, { scale: new Vec3(scale * 1.08, scale * 1.08, 1), position: end }, { easing: style.easing.settle }).call(() => this.releaseSprite(context, node, pooledNodes)).start()
    tween(opacity).delay(delay).to(0.09, { opacity: 115 }).delay(0.19).to(0.22, { opacity: 0 }).start()
  }

  private addDebris (
    root: Node,
    context: EffectRenderContext,
    index: number,
    count: number,
    scale: number,
    style: EffectStyle,
    frames: FrameStore,
    pooledNodes: Set<Node>,
  ): void {
    const frame = frames.get('bomb.debris')
    if (!frame) return
    const angle = index / Math.max(1, count) * Math.PI * 2 + 0.17
    const node = this.acquireSprite(context, PARTICLE_POOL_KEY, `BombDebris-${index + 1}`, root, pooledNodes, frame, 48, 48, new Color(255, 255, 255, 255))
    node.setPosition(new Vec3(Math.cos(angle) * 18, Math.sin(angle) * 14, 6))
    setEffectLayer(node, style.layers.PARTICLE)
    node.setRotationFromEuler(0, 0, angle * 180 / Math.PI)
    node.setScale(new Vec3(0.72, 0.72, 1))
    const opacity = node.getComponent(UIOpacity)!
    const distance = (96 + index % 4 * 22) * scale
    const peak = new Vec3(Math.cos(angle) * distance, 42 + Math.abs(Math.sin(angle)) * 68, 6)
    const end = new Vec3(peak.x * 1.15, peak.y - 128 - index % 3 * 18, 6)
    const delay = index % 4 * 0.014
    tween(node).delay(delay).to(0.22, { position: peak, eulerAngles: new Vec3(0, 0, 150 + index * 37) }, { easing: style.easing.travelOut }).to(0.3, { position: end, eulerAngles: new Vec3(0, 0, 310 + index * 51), scale: new Vec3(0.42, 0.42, 1) }, { easing: style.easing.travelIn }).call(() => this.releaseSprite(context, node, pooledNodes)).start()
    tween(opacity).delay(delay + 0.28).to(0.24, { opacity: 0 }).start()
  }

}
