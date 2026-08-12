import type { Node } from 'cc'
import type { CocosAudioController } from '../audio/CocosAudioController'
import type { EffectAssetAudit, EffectController, EffectRuntimeDiagnostics } from '../effects/EffectController'
import type { EffectQuality } from '../effects/EffectTypes'
import { createEffectLab, type EffectLabApi, type EffectLabDriver } from './EffectLab'
import { EffectLabPreviewRunner } from './EffectLabPreviewRunner'

type EffectLabDebugBridge = Readonly<{
  open: () => void
  list: () => ReturnType<EffectLabApi['list']>
  trigger: (id: string, quality?: EffectQuality) => boolean
  skip: () => void
  diagnostics: () => EffectRuntimeDiagnostics | null
  audit: () => Promise<EffectAssetAudit | null>
}>

type EffectLabDebugGlobal = typeof globalThis & {
  __guandanEffectLab?: EffectLabDebugBridge
}

export type EffectLabSceneHostDependencies = Readonly<{
  effects: EffectController | null
  audio: CocosAudioController | null
  flightRoot: Node | null
  topEffectRoot: Node | null
  getEffectQuality: () => EffectQuality
  hasLiveTableSnapshot: () => boolean
  openEffectLabTable: () => void
  startFixedMatch: NonNullable<EffectLabDriver['startFixedMatch']>
  scheduleOnce: (callback: () => void, delaySeconds: number) => void
  showNotice: (title: string, detail: string) => void
}>

/** Owns the development-only EffectLab adapter, previews and global automation bridge. */
export class EffectLabSceneHost {
  private readonly lab: EffectLabApi | null
  private readonly previewRunner: EffectLabPreviewRunner
  private debugBridge: EffectLabDebugBridge | null = null
  private disposed = false

  public constructor (private readonly dependencies: EffectLabSceneHostDependencies) {
    this.previewRunner = new EffectLabPreviewRunner({
      effects: dependencies.effects,
      flightRoot: dependencies.flightRoot,
      topEffectRoot: dependencies.topEffectRoot,
      getEffectQuality: dependencies.getEffectQuality,
      hasLiveTableSnapshot: dependencies.hasLiveTableSnapshot,
      inspect: (id, quality) => this.lab?.inspect(id, quality) ?? null,
      scheduleOnce: dependencies.scheduleOnce,
      showNotice: dependencies.showNotice,
    })
    this.lab = createEffectLab({
      playAction: preview => this.previewRunner.previewAction(preview),
      playAudio: event => { if (!this.disposed) dependencies.audio?.playEvent(event) },
      playCountdown: remaining => { if (!this.disposed) dependencies.audio?.playCountdown(remaining) },
      playTribute: (fixture, quality) => this.previewRunner.previewTribute(fixture, quality),
      playSettlement: (fixture, quality) => this.previewRunner.previewSettlement(fixture.won, fixture.levelUp, quality),
      playFlow: (fixture, quality) => this.previewRunner.previewFlow(fixture, quality),
      playSequence: fixture => this.previewRunner.previewSequence(fixture),
      runDiagnostic: fixture => { void this.previewRunner.previewDiagnostic(fixture) },
      startFixedMatch: (state, fixture) => { if (!this.disposed) dependencies.startFixedMatch(state, fixture) },
      playQuickChat: phrase => { if (!this.disposed) dependencies.audio?.playVoice(phrase.voice) },
    })
  }

  public list (): ReturnType<EffectLabApi['list']> {
    return this.disposed ? [] : this.lab?.list() ?? []
  }

  public trigger (id: string, quality: EffectQuality = 'full'): boolean {
    if (this.disposed) return false
    this.previewRunner.beginPreview()
    return Boolean(this.lab?.trigger(id, quality))
  }

  /** Compile-time gating remains in EffectLab; production never installs this bridge. */
  public installDebugBridge (): void {
    if (!this.lab || this.disposed) return
    const bridge: EffectLabDebugBridge = Object.freeze({
      open: () => { if (!this.disposed) this.dependencies.openEffectLabTable() },
      list: () => this.list(),
      trigger: (id, quality = 'full') => this.trigger(id, quality),
      skip: () => this.previewRunner.cancel(),
      diagnostics: () => this.disposed ? null : this.dependencies.effects?.diagnostics() ?? null,
      audit: async () => {
        if (this.disposed) return null
        const audit = await this.dependencies.effects?.auditRuntimeAssets() ?? null
        return this.disposed ? null : audit
      },
    })
    this.debugBridge = bridge
    ;(globalThis as EffectLabDebugGlobal).__guandanEffectLab = bridge
  }

  public dispose (): void {
    this.previewRunner.dispose()
    this.disposed = true
    const globalHost = globalThis as EffectLabDebugGlobal
    if (globalHost.__guandanEffectLab === this.debugBridge) delete globalHost.__guandanEffectLab
    this.debugBridge = null
  }

}
