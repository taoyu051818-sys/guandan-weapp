import { _decorator, Component, Node, SpriteFrame, Texture2D, Tween, Vec3, tween } from 'cc'
import type { PlayAction, PlayerId } from '../core/generated'
import type { AudioEvent } from '../audio/AudioProfiles'
import { loadGameAsset } from '../services/GameAssetLoader'
import { BombEffectRenderer } from './BombEffectRenderer'
import { COMMERCIAL_BOMB_EFFECT_KEYS, isCommercialBombEffectKey } from './ArchivedPlayVisuals'
import { CardBlastReaction, type CardBlastReactionTarget } from './CardBlastReaction'
import { CardFlightController } from './CardFlightController'
import { EffectAssetCatalog, type EffectAssetEntry } from './EffectAssetCatalog'
import { EffectActionPresentationCoordinator, type PlayEffectPresentation } from './EffectActionPresentationCoordinator'
import { EFFECT_SHAKE } from './EffectDesignSystem'
import { EffectHandle, type EffectCancelReason } from './EffectHandle'
import { EffectNodePool } from './EffectNodePool'
import { EffectPlaybackCoordinator } from './EffectPlaybackCoordinator'
import { DEFAULT_EFFECT_POLICY, resolveEffectPolicy, type EffectPolicy, type EffectPolicyOverrides } from './EffectPolicy'
import { EffectProfileResolver } from './EffectProfileResolver'
import { isBombEffectKey } from './EffectRecipes'
import type { EffectRenderContext } from './EffectRenderContext'
import { EffectRendererRegistry } from './EffectRendererRegistry'
import type { FlowEffectKind, TributeFlowEvent } from './FlowEffectTypes'
import { LegacyCoordinateAdapter } from './LegacyCoordinateAdapter'
import { SixBombRenderer } from './SixBombRenderer'
import { TransientEffectNodePool } from './TransientEffectNodePool'
import type { CardFlightOrigin, EffectProfile, EffectQuality, PlayEffectEvent, ShakeStrength } from './EffectTypes'
import { preloadVfxCardFrames } from './VfxCardSnapshot'

const { ccclass } = _decorator
type SourceProvider = (playerId: PlayerId) => Vec3
type TargetProvider = (playerId: PlayerId) => Vec3
type CardBlastTargetProvider = () => readonly CardBlastReactionTarget[]
const EAGER_EFFECT_ASSET_IDS = new Set(['common.impact-ring'])

export type EffectRuntimeDiagnostics = Readonly<{
  activeRendererHandles: number
  activeFlightNodes: number
  activeTransientNodes: number
  pooledTransientNodes: number
  activeMajorEffects: number
  registeredRendererKeys: readonly string[]
}>

export type EffectAssetAudit = Readonly<{
  bundled: number
  loaded: number
  missing: readonly string[]
  migrationCandidates: number
  rejected: number
}>

export type { PlayEffectPresentation } from './EffectActionPresentationCoordinator'

/** One non-blocking scheduler for flights, pattern feedback, sound, haptics and recovery. */
@ccclass('EffectController')
export class EffectController extends Component {
  private tableRoot: Node | null = null
  private flightRoot: Node | null = null
  private topRoot: Node | null = null
  private flight: CardFlightController | null = null
  private readonly pool = new EffectNodePool()
  private readonly resolver = new EffectProfileResolver()
  private readonly assets = new EffectAssetCatalog()
  private readonly renderers = new EffectRendererRegistry(COMMERCIAL_BOMB_EFFECT_KEYS)
  private readonly transientPool = new TransientEffectNodePool()
  private readonly legacyCoordinates = new LegacyCoordinateAdapter()
  private readonly cardBlastReaction = new CardBlastReaction()
  private readonly actionPresentation = new EffectActionPresentationCoordinator<Vec3>()
  private readonly playback = new EffectPlaybackCoordinator({
    isAvailable: () => this.node.isValid,
    getFlight: () => this.flight,
    withQuality: <T>(quality: EffectQuality, work: () => T): T => this.withQuality(quality, work),
    preparePlayImpact: (profile, event, wildcardUsed) => this.preparePlayImpact(profile, event, wildcardUsed),
    renderPlayImpact: (profile, event, wildcardUsed) => this.renderPlayImpact(profile, event, wildcardUsed),
    prepareContext: context => this.renderers.prepare(context),
    renderContext: context => this.renderers.render(context),
    playSound: sound => this.soundPlayer?.(sound),
    playActionVoice: action => this.actionVoicePlayer?.(action),
    vibrate: kind => this.vibrate(kind),
    reportError: (message, error) => console.warn(message, error),
  })
  private quality: EffectQuality = 'full'
  private hapticEnabled = true
  private majorHandle: EffectHandle | null = null
  private shakeHandle: EffectHandle | null = null
  private majorLevel = 0
  private soundPlayer: ((event: AudioEvent) => void) | null = null
  private actionVoicePlayer: ((action: PlayAction) => void) | null = null
  private busyListener: ((busy: boolean) => void) | null = null
  private frames = new Map<string, SpriteFrame>()
  private frameRequests = new Map<string, Promise<SpriteFrame | null>>()
  private policy: EffectPolicy = DEFAULT_EFFECT_POLICY
  private readonly transientNodes = new Set<Node>()
  private busy = false
  private trusteeHandle: EffectHandle | null = null
  private trusteeState: boolean | null = null
  private trusteeTargetWorldPosition: Vec3 | null = null
  private cardBlastTargets: CardBlastTargetProvider | null = null

  public setup (tableRoot: Node, flightRoot: Node, topRoot: Node, soundPlayer: (event: AudioEvent) => void, actionVoicePlayer: (action: PlayAction) => void, busyListener: (busy: boolean) => void, cardBlastTargets?: CardBlastTargetProvider): void {
    this.tableRoot = tableRoot
    this.flightRoot = flightRoot
    this.topRoot = topRoot
    this.flight = new CardFlightController(flightRoot, this.pool)
    this.soundPlayer = soundPlayer
    this.actionVoicePlayer = actionVoicePlayer
    this.busyListener = busyListener
    this.cardBlastTargets = cardBlastTargets ?? null
    if (this.renderers.size === 0) {
      const bomb = new BombEffectRenderer()
      const sixBomb = new SixBombRenderer()
      this.renderers.register(['bomb-small', 'bomb-medium', 'bomb-large'], bomb)
      this.renderers.register('six-bomb', sixBomb)
    }
    this.assets.listAllowed().filter(entry => entry.availability === 'bundled' && EAGER_EFFECT_ASSET_IDS.has(entry.id)).forEach(entry => {
      void this.loadSpriteFrame(entry).then(frame => {
        if (frame && this.node.isValid) this.frames.set(entry.id.replace(/^common\./, ''), frame)
      })
    })
  }

  public configure (quality: EffectQuality, hapticEnabled: boolean, policy: EffectPolicyOverrides = {}): void {
    const qualityChanged = quality !== this.quality
    const previousMajorLimit = this.policy.maxMajorEffectCount
    this.quality = quality
    this.hapticEnabled = hapticEnabled
    this.policy = resolveEffectPolicy(policy)
    if (qualityChanged || (previousMajorLimit > 0 && this.policy.maxMajorEffectCount === 0)) this.skipAll('quality-off')
  }

  public captureLocalOrigins (origins: CardFlightOrigin[]): void { this.actionPresentation.captureLocalOrigins(origins) }

  /** Places an authored UI animation, such as the real hand deal, in the same visible lane. */
  public waitForPresentation (completion: Promise<void>, finish?: () => void): EffectHandle {
    return this.playback.waitForPresentation(completion, finish)
  }

  /** Development-only style entry point: no action cursor or rule state is mutated. */
  public previewAction (action: PlayAction, quality: EffectQuality, sourceWorldPosition = new Vec3(-160, -120, 0), targetWorldPosition = Vec3.ZERO): void {
    const previous = this.quality
    this.quality = quality
    try {
      this.play({
        action,
        actionIndex: 0,
        humanId: action.playerId,
        sourcePositions: action.cards.map(() => sourceWorldPosition),
        targetWorldPosition,
      })
    } finally {
      this.quality = previous
    }
  }

  public previewFlow (kind: FlowEffectKind, text: string, targetNode?: Node, quality: EffectQuality = this.quality): EffectHandle {
    return this.withQuality(quality, () => this.renderFlow(kind, text, targetNode ? { targetNode } : {}))
  }

  public diagnostics (): EffectRuntimeDiagnostics {
    this.transientNodes.forEach(node => { if (!node.isValid) this.transientNodes.delete(node) })
    return Object.freeze({
      activeRendererHandles: this.renderers.activeCount,
      activeFlightNodes: this.flight?.activeCount ?? 0,
      activeTransientNodes: this.transientNodes.size + this.transientPool.activeCount,
      pooledTransientNodes: this.transientPool.pooledCount(),
      activeMajorEffects: this.majorHandle?.isActive ? 1 : 0,
      registeredRendererKeys: Object.freeze(this.renderers.keys()),
    })
  }

  public async auditRuntimeAssets (): Promise<EffectAssetAudit> {
    const entries = this.assets.list()
    const bundled = entries.filter(entry => entry.availability === 'bundled' && entry.decision === 'allow')
    const results = await Promise.all(bundled.map(async entry => ({ id: entry.id, loaded: Boolean(await this.loadSpriteFrame(entry)) })))
    return Object.freeze({
      bundled: bundled.length,
      loaded: results.filter(result => result.loaded).length,
      missing: Object.freeze(results.filter(result => !result.loaded).map(result => result.id)),
      migrationCandidates: entries.filter(entry => entry.availability === 'migration-candidate').length,
      rejected: entries.filter(entry => entry.decision === 'deny').length,
    })
  }

  /** Only one newly appended action may play; baselines and sequence gaps land silently. */
  public syncActions (
    actions: PlayAction[],
    humanId: PlayerId,
    source: SourceProvider,
    target: TargetProvider,
    presentation?: PlayEffectPresentation,
  ): void {
    this.actionPresentation.syncActions(
      actions,
      humanId,
      source,
      target,
      presentation,
      () => this.cancelAll('recovery'),
      request => this.play({ ...request, onCardArrive: card => request.onCardArrive?.(card.id) }),
    )
  }

  public playSettlement (won: boolean, levelUp: number, quality?: EffectQuality): void {
    this.withQuality(quality, () => {
      const profile: EffectProfile = { key: won ? 'victory' : 'defeat', level: 3, label: won ? `胜利  升 ${levelUp} 级` : '本局结束', durationMs: 1200, flightMs: 0, shake: 'none', sound: won ? 'victory' : 'defeat', haptic: won ? 'medium' : 'none', dimTable: false, color: won ? [255, 214, 92] : [164, 183, 184] }
      if (!this.topRoot) return
      const result = this.renderFlow(won ? 'victory' : 'defeat', profile.label, { levelUp })
      if (won && levelUp > 0) {
        void result.finished.then(reason => {
          if (reason === 'completed' && this.node.isValid) this.withQuality(quality, () => this.renderFlow('upgrade', `升 ${levelUp} 级`, { levelUp }))
        })
      }
    })
  }

  /** Migrated 27-step deal clip plus the old backOut/hold/backIn grade notice. */
  public playRoundOpening (gradeText: string): void {
    this.renderFlow('deal', '发牌')
    this.renderFlow('grade', gradeText)
  }

  public playMatchSuccess (): void { this.renderFlow('match-success', '匹配成功') }

  public playPlayerFinished (text: string): void { this.renderFlow('player-finished', text) }

  public playTrusteeState (active: boolean, targetNode?: Node): void {
    if (this.trusteeState === null && !active) { this.trusteeState = false; return }
    const targetWorld = targetNode?.worldPosition.clone() ?? null
    const targetMoved = Boolean(targetWorld && (!this.trusteeTargetWorldPosition || Vec3.distance(targetWorld, this.trusteeTargetWorldPosition) > 1))
    if (this.trusteeState === active && !targetMoved && (active ? Boolean(this.trusteeHandle?.isActive) : true)) return
    this.trusteeState = active
    this.trusteeTargetWorldPosition = targetWorld
    this.trusteeHandle?.cancel('replaced')
    this.trusteeHandle = null
    const handle = this.renderFlow(active ? 'trustee-on' : 'trustee-off', active ? '托管中' : '已取消托管', { targetNode })
    if (active && handle.isActive) {
      this.trusteeHandle = handle
      handle.onFinish(() => { if (this.trusteeHandle === handle) this.trusteeHandle = null })
    }
  }

  public playChatPulse (targetNode: Node, side: 'left' | 'right'): void {
    this.renderFlow(side === 'left' ? 'chat-left' : 'chat-right', '', { targetNode })
  }

  public playTribute (event: TributeFlowEvent, sourceWorldPosition: Vec3, targetWorldPosition: Vec3, quality?: EffectQuality): void {
    this.withQuality(quality, () => {
      const kind: FlowEffectKind = event.phase === 'anti-tribute' ? 'anti-tribute' : event.phase === 'return' ? 'return-tribute' : 'tribute'
      this.renderFlow(kind, kind === 'anti-tribute' ? '抗贡成立' : kind === 'return-tribute' ? '还贡' : '进贡', { card: event.card }, [sourceWorldPosition], targetWorldPosition)
    })
  }

  public skipAll (reason: EffectCancelReason = 'skipped'): void { this.cancelAll(reason) }

  public resetForRecovery (actionCount = 0): void {
    this.skipAll('recovery')
    this.actionPresentation.resetForRecovery(actionCount)
  }

  protected onDestroy (): void {
    this.skipAll('destroyed')
    this.renderers.clear('destroyed')
    this.transientPool.clear()
    this.assets.clear()
    this.pool.clear()
    this.frameRequests.clear()
  }

  private play (event: PlayEffectEvent): void {
    const profile = this.resolver.resolve(event.action, this.quality)
    this.playback.play(event, this.quality, profile)
  }

  private renderPlayImpact (profile: EffectProfile, event: PlayEffectEvent, wildcardUsed: boolean): EffectHandle {
    if (isBombEffectKey(profile.key)) {
      return this.playRegisteredMajor(profile, event, {
        onImpact: () => {
          event.onFlightFinish?.()
          if (!wildcardUsed) return
          try { this.soundPlayer?.('wildcard') } catch (error) { console.warn('[effects] wildcard sound failed', error) }
        },
      })
    }
    if (!isCommercialBombEffectKey(profile.key)) return EffectHandle.completed('unavailable')
    if (this.renderers.resolve(profile.key)) {
      return profile.level >= 2 ? this.playRegisteredMajor(profile, event) : this.renderProfile(profile, event)
    }
    return EffectHandle.completed('unavailable')
  }

  private async preparePlayImpact (profile: EffectProfile, event: PlayEffectEvent, _wildcardUsed: boolean): Promise<boolean> {
    const contexts: EffectRenderContext[] = []
    if (isCommercialBombEffectKey(profile.key)) {
      const context = this.makeRenderContext(profile, event)
      if (context && this.renderers.resolve(profile.key)) contexts.push(context)
    }
    const [cardFramesReady] = await Promise.all([
      preloadVfxCardFrames(event.action.cards),
      Promise.all(contexts.map(context => this.renderers.prepare(context))),
    ])
    return cardFramesReady
  }

  private renderProfile (
    profile: EffectProfile,
    event?: PlayEffectEvent,
    metadata?: Readonly<Record<string, unknown>>,
    sourceWorldPositions?: readonly Vec3[],
    targetWorldPosition?: Vec3,
    prepare = false,
  ): EffectHandle {
    const context = this.makeRenderContext(profile, event, metadata, sourceWorldPositions, targetWorldPosition)
    if (!context) return EffectHandle.completed('unavailable')
    return prepare ? this.playback.renderPreparedContext(context) : this.renderers.render(context)
  }

  private makeRenderContext (
    profile: EffectProfile,
    event?: PlayEffectEvent,
    metadata?: Readonly<Record<string, unknown>>,
    sourceWorldPositions?: readonly Vec3[],
    targetWorldPosition?: Vec3,
  ): EffectRenderContext | null {
    if (!this.tableRoot || !this.flightRoot || !this.topRoot) return null
    const onImpact = metadata?.onImpact
    const quality = this.quality
    return {
      profile,
      quality,
      roots: { tableRoot: this.tableRoot, flightRoot: this.flightRoot, topRoot: this.topRoot },
      assets: this.assets,
      nodePool: this.transientPool,
      legacyCoordinates: this.legacyCoordinates,
      services: {
        loadSpriteFrame: asset => this.loadSpriteFrame(asset),
        playSound: sound => this.soundPlayer?.(sound),
        vibrate: kind => this.vibrate(kind),
        shake: strength => this.withQuality(quality, () => this.playShake(strength)),
        reactTableCards: request => this.withQuality(quality, () => {
          if (quality === 'off') return null
          const targets = this.cardBlastTargets?.() ?? []
          const adjusted = quality === 'reduced' ? { ...request, strength: 'light' as const } : request
          return this.cardBlastReaction.play(targets, adjusted)
        }),
        reportError: (key, error) => console.warn(`[effects] renderer failed: ${key}`, error),
        ...(typeof onImpact === 'function' ? { notifyImpact: onImpact as () => void } : {}),
      },
      ...(event ? { event } : {}),
      ...(sourceWorldPositions ? { sourceWorldPositions } : event ? { sourceWorldPositions: event.sourcePositions } : {}),
      ...(targetWorldPosition ? { targetWorldPosition } : event ? { targetWorldPosition: event.targetWorldPosition } : {}),
      ...(metadata ? { metadata } : {}),
    }
  }

  private playRegisteredMajor (profile: EffectProfile, event?: PlayEffectEvent, metadata?: Readonly<Record<string, unknown>>, prepare = false): EffectHandle {
    if (this.policy.maxMajorEffectCount === 0) return EffectHandle.completed('unavailable')
    if (this.majorHandle?.isActive && (profile.level < this.majorLevel || (profile.level > this.majorLevel && !this.policy.replaceLowerLevelEffect))) {
      return EffectHandle.completed('unavailable')
    }
    this.skipMajor('replaced', true)
    const handle = this.renderProfile(profile, event, metadata, undefined, undefined, prepare)
    if (!handle.isActive) { this.setBusy(false); return handle }
    this.majorHandle = handle
    this.majorLevel = profile.level
    this.setBusy(true)
    handle.onFinish(() => {
      if (this.majorHandle !== handle) return
      this.majorHandle = null
      this.majorLevel = 0
      this.setBusy(false)
    })
    return handle
  }

  private renderFlow (
    kind: FlowEffectKind,
    _text: string,
    _metadata: Readonly<Record<string, unknown>> = {},
    _sourceWorldPositions?: readonly Vec3[],
    _targetWorldPosition?: Vec3,
  ): EffectHandle {
    if (kind === 'victory') this.soundPlayer?.('victory')
    else if (kind === 'defeat') this.soundPlayer?.('defeat')
    return EffectHandle.completed('unavailable')
  }

  private withQuality<T> (quality: EffectQuality | undefined, work: () => T): T {
    if (quality === undefined || quality === this.quality) return work()
    const previous = this.quality
    this.quality = quality
    try { return work() } finally { this.quality = previous }
  }

  private loadSpriteFrame (asset: EffectAssetEntry): Promise<SpriteFrame | null> {
    const path = asset.resourcePath
    if (!path) return Promise.resolve(null)
    const shortId = asset.id.replace(/^common\./, '')
    const cached = this.frames.get(asset.id) ?? this.frames.get(shortId)
    if (cached) return Promise.resolve(cached)
    const pending = this.frameRequests.get(asset.id)
    if (pending) return pending
    const request = new Promise<SpriteFrame | null>(resolve => loadGameAsset(path, Texture2D, (error, texture) => {
      if (error || !texture) { resolve(null); return }
      const frame = new SpriteFrame()
      frame.texture = texture
      this.frames.set(asset.id, frame)
      this.frames.set(shortId, frame)
      resolve(frame)
    })).finally(() => this.frameRequests.delete(asset.id))
    this.frameRequests.set(asset.id, request)
    return request
  }

  private playShake (strength: ShakeStrength): EffectHandle | null {
    if (!this.tableRoot || strength === 'none' || this.quality !== 'full') return null
    const shake = EFFECT_SHAKE[strength]
    const amplitude = shake.amplitude
    const segmentSeconds = shake.durationMs / 1000 / Math.max(1, shake.impulses)
    const root = this.tableRoot
    const origin = root.position.clone()
    this.shakeHandle?.cancel('replaced')
    Tween.stopAllByTarget(root)
    const handle = new EffectHandle(() => {
      if (!root.isValid) return
      Tween.stopAllByTarget(root)
      root.setPosition(origin)
    })
    this.shakeHandle = handle
    handle.onFinish(() => { if (this.shakeHandle === handle) this.shakeHandle = null })
    tween(root)
      .to(segmentSeconds, { position: new Vec3(origin.x - amplitude, origin.y + amplitude * 0.35, origin.z) })
      .to(segmentSeconds, { position: new Vec3(origin.x + amplitude * 0.8, origin.y - amplitude * 0.25, origin.z) })
      .to(segmentSeconds, { position: new Vec3(origin.x - amplitude * 0.45, origin.y, origin.z) })
      .to(segmentSeconds, { position: new Vec3(origin.x + amplitude * 0.25, origin.y, origin.z) })
      .to(segmentSeconds, { position: origin })
      .call(() => handle.complete())
      .start()
    return handle
  }

  private skipMajor (reason: EffectCancelReason = 'skipped', keepBusy = false): void {
    const handle = this.majorHandle
    this.majorHandle = null
    handle?.cancel(reason)
    this.shakeHandle?.cancel(reason)
    this.shakeHandle = null
    this.majorLevel = 0
    if (this.tableRoot) {
      Tween.stopAllByTarget(this.tableRoot)
      this.tableRoot.setPosition(Vec3.ZERO)
    }
    if (!keepBusy) this.setBusy(false)
  }

  private cancelAll (reason: EffectCancelReason): void {
    this.playback.cancelAll(reason)
    this.renderers.cancelAll(reason)
    this.skipMajor(reason)
    this.flight?.skipAll(reason)
    this.cardBlastReaction.cancel(reason)
    this.transientPool.releaseAll()
    this.clearTransientNodes()
    this.actionPresentation.clearPendingOrigins()
    this.trusteeHandle = null
    this.trusteeState = null
    this.trusteeTargetWorldPosition = null
  }

  private destroyTransient (node: Node): void {
    this.transientNodes.delete(node)
    if (!node.isValid) return
    const stop = (target: Node): void => {
      target.children.forEach(stop)
      Tween.stopAllByTarget(target)
      target.components.forEach(component => Tween.stopAllByTarget(component))
    }
    stop(node)
    node.destroy()
  }

  private clearTransientNodes (): void {
    const nodes = Array.from(this.transientNodes)
    this.transientNodes.clear()
    nodes.forEach(node => this.destroyTransient(node))
  }

  private vibrate (kind: EffectProfile['haptic']): void {
    if (!this.hapticEnabled || kind === 'none') return
    const duration = kind === 'light' ? 12 : kind === 'medium' ? 25 : 45
    try { globalThis.navigator?.vibrate?.(duration) } catch { /* unsupported platform */ }
  }

  private setBusy (busy: boolean): void {
    if (this.busy === busy) return
    this.busy = busy
    this.busyListener?.(busy)
  }
}
