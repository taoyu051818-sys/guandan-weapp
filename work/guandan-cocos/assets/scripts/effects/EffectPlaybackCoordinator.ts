import { PlayType, type PlayAction } from '../core/generated'
import type { CardFlightController } from './CardFlightController'
import { EffectHandle, type EffectCancelReason } from './EffectHandle'
import { isBombEffectKey } from './EffectRecipes'
import type { EffectRenderContext } from './EffectRenderContext'
import type { EffectProfile, EffectQuality, PlayEffectEvent } from './EffectTypes'

export type EffectPlaybackCoordinatorDependencies = Readonly<{
  isAvailable: () => boolean
  getFlight: () => CardFlightController | null
  withQuality: <T>(quality: EffectQuality, work: () => T) => T
  preparePlayImpact: (profile: EffectProfile, event: PlayEffectEvent, wildcardUsed: boolean) => Promise<boolean>
  renderPlayImpact: (profile: EffectProfile, event: PlayEffectEvent, wildcardUsed: boolean) => EffectHandle
  prepareContext: (context: EffectRenderContext) => Promise<boolean>
  renderContext: (context: EffectRenderContext) => EffectHandle
  playSound: (sound: NonNullable<EffectProfile['sound']>) => void
  playActionVoice: (action: PlayAction) => void
  vibrate: (kind: EffectProfile['haptic']) => void
  reportError: (message: string, error: unknown) => void
}>

/** Serializes visible effects and owns every handle waiting on asynchronous preparation. */
export class EffectPlaybackCoordinator {
  private generation = 0
  private startQueue: Promise<void> = Promise.resolve()
  private readonly pendingPlayHandles = new Set<EffectHandle>()
  private readonly queuedVisibleHandles = new Set<EffectHandle>()
  private readonly pendingPreparedHandles = new Set<EffectHandle>()

  public constructor (private readonly dependencies: EffectPlaybackCoordinatorDependencies) {}

  public waitForPresentation (completion: Promise<void>, finish?: () => void): EffectHandle {
    return this.enqueueVisibleEffect(() => {
      const handle = new EffectHandle(() => { try { finish?.() } catch { /* best-effort authored UI cleanup */ } })
      void completion.then(
        () => { if (handle.isActive) handle.complete() },
        error => { this.dependencies.reportError('[effects] presentation barrier failed', error); if (handle.isActive) handle.cancel('failed') },
      )
      return handle
    })
  }

  public play (event: PlayEffectEvent, effectQuality: EffectQuality, profile: EffectProfile): EffectHandle {
    const rendererOwnsBombFlight = isBombEffectKey(profile.key)
    const wildcardUsed = Boolean(event.action.resolution?.wildcardUsages?.length)
    const generation = this.generation
    let presentationStarted = false
    let presentationFinished = false
    let flightHandle: EffectHandle | null = null
    let impactHandle: EffectHandle | null = null
    const beginPresentation = (): void => {
      if (presentationStarted) return
      presentationStarted = true
      try { event.onFlightStart?.() } catch { /* stale presentation tickets are harmless */ }
    }
    const finishPresentation = (): void => {
      if (presentationFinished) return
      presentationFinished = true
      try { event.onFlightFinish?.() } catch { /* presentation callbacks cannot own the lane */ }
    }
    const playEvent: PlayEffectEvent = { ...event, onFlightFinish: finishPresentation }
    const handle = new EffectHandle(reason => {
      if (flightHandle?.isActive) flightHandle.cancel(reason === 'completed' ? 'skipped' : reason)
      if (impactHandle?.isActive) impactHandle.cancel(reason === 'completed' ? 'skipped' : reason)
      if (reason !== 'recovery' && reason !== 'destroyed') {
        beginPresentation()
        finishPresentation()
      }
    })
    this.pendingPlayHandles.add(handle)
    handle.onFinish(() => this.pendingPlayHandles.delete(handle))
    const renderImpact = (): void => {
      if (!handle.isActive || !this.dependencies.isAvailable() || generation !== this.generation) return
      try {
        this.dependencies.withQuality(effectQuality, () => {
          if (!rendererOwnsBombFlight && profile.sound) this.dependencies.playSound(profile.sound)
          if (wildcardUsed) this.dependencies.playSound('wildcard')
          if (!rendererOwnsBombFlight) this.dependencies.vibrate(profile.haptic)
          impactHandle = this.dependencies.renderPlayImpact(profile, playEvent, wildcardUsed)
        })
      } catch (error) {
        this.dependencies.reportError(`[effects] impact render failed: ${profile.key}`, error)
        impactHandle = EffectHandle.completed('failed')
      }
    }
    // One visible action owns the lane through flight and impact. Each flight
    // card still lands on its own timeline and reveals its matching table card.
    const start = async (): Promise<void> => {
      if (!handle.isActive) return
      if (!this.dependencies.isAvailable() || generation !== this.generation) { handle.cancel('unavailable'); return }
      if (effectQuality === 'off') {
        beginPresentation()
        try { this.dependencies.playActionVoice(event.action) } catch (error) { this.dependencies.reportError('[effects] action voice failed', error) }
        try {
          if (profile.sound) this.dependencies.playSound(profile.sound)
          if (wildcardUsed) this.dependencies.playSound('wildcard')
        } catch (error) { this.dependencies.reportError('[effects] semantic audio failed', error) }
        handle.complete()
        return
      }
      if (event.action.type === PlayType.Pass) {
        beginPresentation()
        try { this.dependencies.playActionVoice(event.action) } catch (error) { this.dependencies.reportError('[effects] action voice failed', error) }
        try { this.dependencies.playSound('pass') } catch (error) { this.dependencies.reportError('[effects] pass sound failed', error) }
        handle.complete()
        return
      }
      const cardFramesReady = await this.dependencies.withQuality(effectQuality, () => this.dependencies.preparePlayImpact(profile, playEvent, wildcardUsed))
      if (!handle.isActive) return
      if (!this.dependencies.isAvailable() || generation !== this.generation) { handle.cancel('unavailable'); return }
      beginPresentation()
      try { this.dependencies.playActionVoice(event.action) } catch (error) { this.dependencies.reportError('[effects] action voice failed', error) }
      if (!rendererOwnsBombFlight) {
        const flight = this.dependencies.getFlight()
        if (!cardFramesReady || !flight) {
          try {
            if (profile.sound) this.dependencies.playSound(profile.sound)
            if (wildcardUsed) this.dependencies.playSound('wildcard')
          } catch (error) { this.dependencies.reportError('[effects] fallback semantic audio failed', error) }
          handle.complete()
          return
        }
        flightHandle = flight.play(
          event.action.cards,
          event.sourcePositions,
          event.targetWorldPosition,
          profile.flightMs,
          renderImpact,
          (card, cardIndex) => playEvent.onCardArrive?.(card, cardIndex),
        )
        const flightReason = await flightHandle.finished
        if (!handle.isActive) return
        if (flightReason !== 'completed') { handle.cancel(flightReason); return }
        const impactReason = impactHandle?.isActive ? await impactHandle.finished : impactHandle?.finishReason
        if (!handle.isActive) return
        if (impactReason && impactReason !== 'completed') handle.cancel(impactReason)
        else handle.complete()
        return
      }
      impactHandle = this.dependencies.withQuality(effectQuality, () => this.dependencies.renderPlayImpact(profile, playEvent, wildcardUsed))
      const bombReason = impactHandle.isActive ? await impactHandle.finished : impactHandle.finishReason ?? 'unavailable'
      if (!handle.isActive) return
      if (bombReason === 'completed') handle.complete()
      else handle.cancel(bombReason)
    }
    this.startQueue = this.startQueue.then(start, start).catch(error => {
      this.dependencies.reportError(`[effects] impact preparation failed: ${profile.key}`, error)
      if (handle.isActive) handle.cancel('failed')
    })
    return handle
  }

  public renderPreparedContext (context: EffectRenderContext): EffectHandle {
    const generation = this.generation
    let child: EffectHandle | null = null
    const handle = new EffectHandle(reason => {
      if (!child?.isActive) return
      if (reason === 'completed') child.complete()
      else child.cancel(reason)
    })
    this.pendingPreparedHandles.add(handle)
    handle.onFinish(() => this.pendingPreparedHandles.delete(handle))
    void this.dependencies.prepareContext(context).then(ready => {
      if (!handle.isActive) return
      if (!ready || !this.dependencies.isAvailable() || generation !== this.generation) { handle.cancel('unavailable'); return }
      child = this.dependencies.renderContext(context)
      child.onFinish(reason => {
        if (!handle.isActive) return
        if (reason === 'completed') handle.complete()
        else handle.cancel(reason)
      })
    }).catch(error => {
      context.services?.reportError?.(context.profile.key, error)
      if (handle.isActive) handle.cancel('failed')
    })
    return handle
  }

  public cancelAll (reason: EffectCancelReason): void {
    this.generation += 1
    this.startQueue = Promise.resolve()
    this.cancelHandles(this.pendingPlayHandles, reason)
    this.cancelHandles(this.queuedVisibleHandles, reason)
    this.cancelHandles(this.pendingPreparedHandles, reason)
  }

  private enqueueVisibleEffect (startEffect: () => EffectHandle): EffectHandle {
    const generation = this.generation
    let child: EffectHandle | null = null
    const handle = new EffectHandle(reason => {
      if (!child?.isActive) return
      if (reason === 'completed') child.complete()
      else child.cancel(reason)
    })
    this.queuedVisibleHandles.add(handle)
    handle.onFinish(() => this.queuedVisibleHandles.delete(handle))
    const start = async (): Promise<void> => {
      if (!handle.isActive) return
      if (!this.dependencies.isAvailable() || generation !== this.generation) { handle.cancel('unavailable'); return }
      try {
        child = startEffect()
        const reason = child.isActive ? await child.finished : child.finishReason ?? 'unavailable'
        if (!handle.isActive) return
        if (reason === 'completed') handle.complete()
        else handle.cancel(reason)
      } catch (error) {
        this.dependencies.reportError('[effects] visible presentation failed', error)
        if (handle.isActive) handle.cancel('failed')
      }
    }
    this.startQueue = this.startQueue.then(start, start).catch(error => {
      this.dependencies.reportError('[effects] visible presentation queue failed', error)
      if (handle.isActive) handle.cancel('failed')
    })
    return handle
  }

  private cancelHandles (handles: Set<EffectHandle>, reason: EffectCancelReason): void {
    const pending = Array.from(handles)
    handles.clear()
    pending.forEach(handle => handle.cancel(reason))
  }
}
