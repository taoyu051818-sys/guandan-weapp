import { type Node, UITransform, Vec3 } from 'cc'
import type { EffectController } from '../effects/EffectController'
import type { EffectQuality } from '../effects/EffectTypes'
import type { EffectLabApi, EffectLabPreview } from './EffectLab'

export type EffectLabPreviewRunnerDependencies = Readonly<{
  effects: EffectController | null
  flightRoot: Node | null
  topEffectRoot: Node | null
  getEffectQuality: () => EffectQuality
  hasLiveTableSnapshot: () => boolean
  inspect: EffectLabApi['inspect']
  scheduleOnce: (callback: () => void, delaySeconds: number) => void
  showNotice: (title: string, detail: string) => void
}>

/** Owns visual preview execution, delayed work generations and root cleanup. */
export class EffectLabPreviewRunner {
  private generation = 0
  private disposed = false

  public constructor (private readonly dependencies: EffectLabPreviewRunnerDependencies) {}

  public beginPreview (): void { if (!this.disposed) this.generation += 1 }

  public cancel (): void {
    if (this.disposed) return
    this.generation += 1
    this.dependencies.effects?.skipAll()
  }

  public dispose (): void { this.generation += 1; this.disposed = true }

  public previewAction (preview: EffectLabPreview): void {
    const { effects } = this.dependencies
    if (!preview.action || !effects || this.disposed) return
    this.showEffectRoots(true)
    effects.resetForRecovery(0)
    effects.previewAction(preview.action, preview.quality, this.worldPoint(new Vec3(-160, -120, 0)), this.worldPoint(Vec3.ZERO))
    this.hideAfter(2.4)
  }

  public previewSettlement (won: boolean, levelUp: number, quality: EffectQuality): void {
    if (this.disposed) return
    this.showEffectRoots(false)
    this.dependencies.effects?.playSettlement(won, levelUp, quality)
    this.hideAfter(2.4)
  }

  public previewTribute (fixture: NonNullable<EffectLabPreview['tribute']>, quality: EffectQuality): void {
    const { effects } = this.dependencies
    if (!effects || this.disposed) return
    this.showEffectRoots(true)
    const source = this.worldPoint(fixture.phase === 'return' ? new Vec3(260, 20, 0) : new Vec3(-260, 20, 0))
    const target = this.worldPoint(fixture.phase === 'return' ? new Vec3(-260, 20, 0) : new Vec3(260, 20, 0))
    const card = fixture.phase === 'return' ? fixture.returnCard : fixture.card
    effects.playTribute({ phase: fixture.phase, from: fixture.from, to: fixture.to, card }, source, target, quality)
    this.hideAfter(1.4)
  }

  public previewFlow (fixture: NonNullable<EffectLabPreview['flow']>, quality: EffectQuality): void {
    const { effects, topEffectRoot } = this.dependencies
    if (!effects || this.disposed) return
    this.showEffectRoots(true)
    effects.skipAll()
    if (fixture.kind === 'tribute' || fixture.kind === 'return-tribute' || fixture.kind === 'anti-tribute') {
      const returning = fixture.kind === 'return-tribute'
      effects.playTribute(
        { phase: fixture.kind === 'anti-tribute' ? 'anti-tribute' : returning ? 'return' : 'tribute', from: returning ? 'p1' : 'p2', to: returning ? 'p2' : 'p1', card: null },
        this.worldPoint(new Vec3(returning ? 260 : -260, 20, 0)),
        this.worldPoint(new Vec3(returning ? -260 : 260, 20, 0)),
        quality,
      )
      this.hideAfter(1.4)
      return
    }
    const target = fixture.kind.startsWith('chat-') || fixture.kind.startsWith('trustee-') ? topEffectRoot ?? undefined : undefined
    effects.previewFlow(fixture.kind, fixture.text, target, quality)
    this.hideAfter(fixture.kind === 'grade' ? 3.2 : 2.4)
  }

  public previewSequence (fixture: NonNullable<EffectLabPreview['sequence']>): void {
    const { effects, topEffectRoot } = this.dependencies
    if (!effects || this.disposed) return
    const generation = this.generation
    this.showEffectRoots(true)
    effects.resetForRecovery(0)
    const seatOrigins = [new Vec3(0, -220, 0), new Vec3(350, 0, 0), new Vec3(0, 205, 0), new Vec3(-350, 0, 0)] as const
    fixture.steps.forEach((step, index) => {
      this.dependencies.scheduleOnce(() => {
        if (!this.isCurrent(generation)) return
        const preview = this.dependencies.inspect(step.fixtureId, step.quality ?? this.dependencies.getEffectQuality())
        const source = fixture.mode === 'seat-matrix' ? seatOrigins[index % seatOrigins.length] : new Vec3(-220 + index * 70, -130, 0)
        if (preview?.action) effects.previewAction(preview.action, preview.quality, this.worldPoint(source), this.worldPoint(Vec3.ZERO))
        else if (preview?.flow) effects.previewFlow(preview.flow.kind, preview.flow.text, topEffectRoot ?? undefined)
      }, step.delayMs / 1000)
    })
    this.hideAfter(Math.max(0, ...fixture.steps.map(step => step.delayMs)) / 1000 + 2.5, generation)
  }

  public async previewDiagnostic (_fixture: NonNullable<EffectLabPreview['diagnostic']>): Promise<void> {
    const { effects } = this.dependencies
    if (!effects || this.disposed) return
    const generation = this.generation
    const audit = await effects.auditRuntimeAssets()
    if (!this.isCurrent(generation)) return
    const runtime = effects.diagnostics()
    const fallback = this.dependencies.inspect('play-bomb-small', 'full')
    if (fallback?.action) {
      this.showEffectRoots(false)
      effects.previewAction(fallback.action, 'full', this.worldPoint(new Vec3(-160, -120, 0)), this.worldPoint(Vec3.ZERO))
      this.hideAfter(1.5, generation)
    }
    this.dependencies.showNotice(
      audit.missing.length ? '资源检查发现缺失' : '资源检查通过',
      `运行时纹理 ${audit.loaded}/${audit.bundled} · 迁移候选 ${audit.migrationCandidates} · 拒绝 ${audit.rejected}\nRenderer ${runtime.registeredRendererKeys.length} 项 · 缺失 ${audit.missing.join('、') || '无'}\n炸弹纹理失败时静默跳过，不使用代码绘制降级。`,
    )
  }

  private showEffectRoots (includeFlight: boolean): void {
    if (includeFlight && this.dependencies.flightRoot) this.dependencies.flightRoot.active = true
    if (this.dependencies.topEffectRoot) this.dependencies.topEffectRoot.active = true
  }

  private hideAfter (delaySeconds: number, generation = this.generation): void {
    this.dependencies.scheduleOnce(() => { if (this.isCurrent(generation)) this.hideEffectRoots() }, delaySeconds)
  }

  private isCurrent (generation: number): boolean { return !this.disposed && generation === this.generation }

  private hideEffectRoots (): void {
    if (this.disposed || this.dependencies.hasLiveTableSnapshot()) return
    this.dependencies.effects?.resetForRecovery(0)
    if (this.dependencies.flightRoot) this.dependencies.flightRoot.active = false
    if (this.dependencies.topEffectRoot) this.dependencies.topEffectRoot.active = false
  }

  private worldPoint (localPosition: Vec3): Vec3 {
    return this.dependencies.topEffectRoot?.getComponent(UITransform)?.convertToWorldSpaceAR(localPosition) ?? localPosition.clone()
  }
}
