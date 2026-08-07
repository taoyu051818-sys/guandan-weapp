export type EffectPolicy = Readonly<{
  /** This controller intentionally supports at most one table-covering effect. */
  maxMajorEffectCount: 0 | 1
  /** A visual effect may expose a skip control, but never captures gameplay input. */
  allowInputDuringEffect: true
  /** A new higher-level effect may replace the lower-level effect already playing. */
  replaceLowerLevelEffect: boolean
}>

export type EffectPolicyOverrides = Partial<Pick<EffectPolicy, 'maxMajorEffectCount' | 'replaceLowerLevelEffect'>>

export const DEFAULT_EFFECT_POLICY: EffectPolicy = Object.freeze({
  maxMajorEffectCount: 1,
  allowInputDuringEffect: true,
  replaceLowerLevelEffect: true,
})

/** Normalizes external configuration back into the scheduler's safe budget. */
export const resolveEffectPolicy = (overrides: EffectPolicyOverrides = {}): EffectPolicy => Object.freeze({
  maxMajorEffectCount: overrides.maxMajorEffectCount === 0 ? 0 : 1,
  allowInputDuringEffect: true,
  replaceLowerLevelEffect: overrides.replaceLowerLevelEffect ?? true,
})
