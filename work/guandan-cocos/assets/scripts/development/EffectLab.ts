import { DEBUG, DEV } from 'cc/env'
import { PlayType, type Card, type EngineState, type PlayAction, type PlayerId, type Rank, type Suit } from '../core/generated'
import { resolveAudioProfile, resolveCountdownProfile, type AudioEvent, type AudioProfile, type CountdownSecond } from '../audio/AudioProfiles'
import { resolvePlayVoiceProfile, type PlayVoiceProfile } from '../audio/PlayVoiceProfiles'
import { EffectProfileResolver } from '../effects/EffectProfileResolver'
import type { FlowEffectKind } from '../effects/FlowEffectTypes'
import type { EffectProfile, EffectQuality } from '../effects/EffectTypes'
import type { QuickChatPhrase } from '../ui/QuickChatPolicy'
import { FIXED_MATCH_FIXTURES } from './FixedMatchFixtures'

export type EffectLabFixtureKind = 'match' | 'play' | 'flow' | 'sequence' | 'diagnostic' | 'audio' | 'quick-chat' | 'countdown' | 'tribute' | 'settlement'

export type EffectLabFixtureSummary = Readonly<{
  id: string
  label: string
  kind: EffectLabFixtureKind
  description: string
}>

export type EffectLabTribute = Readonly<{
  phase: 'tribute' | 'return' | 'anti-tribute'
  from: PlayerId
  to: PlayerId
  card: Card | null
  returnCard: Card | null
}>

export type EffectLabSettlement = Readonly<{
  won: boolean
  levelUp: number
}>

export type EffectLabFlow = Readonly<{
  kind: FlowEffectKind
  text: string
}>

export type EffectLabSequenceStep = Readonly<{
  fixtureId: string
  delayMs: number
  quality?: EffectQuality
}>

export type EffectLabSequence = Readonly<{
  mode: 'rapid' | 'major-replace' | 'quality-matrix' | 'style-matrix' | 'seat-matrix'
  steps: readonly EffectLabSequenceStep[]
}>

export type EffectLabDiagnostic = Readonly<{
  check: 'runtime-assets'
}>

export type EffectLabPreview = Readonly<{
  fixture: EffectLabFixtureSummary
  action?: PlayAction
  effectProfile?: EffectProfile
  actionVoiceProfile?: PlayVoiceProfile | null
  audioProfile?: AudioProfile | null
  additionalAudioProfiles?: readonly AudioProfile[]
  countdownSecond?: CountdownSecond
  tribute?: EffectLabTribute
  settlement?: EffectLabSettlement
  matchState?: EngineState
  quickChat?: QuickChatPhrase
  flow?: EffectLabFlow
  sequence?: EffectLabSequence
  diagnostic?: EffectLabDiagnostic
  quality: EffectQuality
}>

/** Scene adapter. The lab never reaches into GameScene, networking or rule state. */
export type EffectLabDriver = Readonly<{
  playAction?: (preview: EffectLabPreview) => void
  playAudio?: (event: AudioEvent, profile: AudioProfile) => void
  playCountdown?: (remaining: CountdownSecond, profile: AudioProfile) => void
  playTribute?: (fixture: EffectLabTribute, quality: EffectQuality) => void
  playSettlement?: (fixture: EffectLabSettlement, quality: EffectQuality) => void
  startFixedMatch?: (state: EngineState, fixture: EffectLabFixtureSummary) => void
  playQuickChat?: (phrase: QuickChatPhrase) => void
  playFlow?: (fixture: EffectLabFlow, quality: EffectQuality) => void
  playSequence?: (fixture: EffectLabSequence) => void
  runDiagnostic?: (fixture: EffectLabDiagnostic) => void
}>

export interface EffectLabApi {
  list(kind?: EffectLabFixtureKind): readonly EffectLabFixtureSummary[]
  inspect(id: string, quality?: EffectQuality): EffectLabPreview | null
  trigger(id: string, quality?: EffectQuality): EffectLabPreview | null
}

type PlayDefinition = Readonly<{ kind: 'play', makeAction: () => PlayAction }>
type AudioDefinition = Readonly<{ kind: 'audio', event: AudioEvent }>
type QuickChatDefinition = Readonly<{ kind: 'quick-chat', phrase: QuickChatPhrase }>
type CountdownDefinition = Readonly<{ kind: 'countdown', remaining: CountdownSecond }>
type TributeDefinition = Readonly<{ kind: 'tribute', tribute: EffectLabTribute }>
type SettlementDefinition = Readonly<{ kind: 'settlement', settlement: EffectLabSettlement }>
type MatchDefinition = Readonly<{ kind: 'match', makeState: () => EngineState }>
type FlowDefinition = Readonly<{ kind: 'flow', flow: EffectLabFlow }>
type SequenceDefinition = Readonly<{ kind: 'sequence', sequence: EffectLabSequence }>
type DiagnosticDefinition = Readonly<{ kind: 'diagnostic', diagnostic: EffectLabDiagnostic }>
type FixtureDefinition = EffectLabFixtureSummary & (MatchDefinition | PlayDefinition | FlowDefinition | SequenceDefinition | DiagnosticDefinition | AudioDefinition | QuickChatDefinition | CountdownDefinition | TributeDefinition | SettlementDefinition)

const valueOf = (rank: Rank): number => typeof rank === 'number' ? rank : rank === 'J' ? 11 : rank === 'Q' ? 12 : rank === 'K' ? 13 : rank === 'A' ? 14 : rank === 'Small' ? 16 : 17
const card = (id: string, suit: Suit, rank: Rank, isLevelCard = false, isRedJoker = false): Card => ({ id, suit, rank, value: valueOf(rank), isLevelCard, ...(isRedJoker ? { isRedJoker: true } : {}) })
const sameRank = (prefix: string, rank: Rank, copies: number): Card[] => {
  const physicalCopies: readonly Suit[] = ['spade', 'spade', 'heart', 'heart', 'club', 'club', 'diamond', 'diamond']
  return Array.from({ length: copies }, (_, index) => card(`${prefix}-${index + 1}`, physicalCopies[index], rank))
}
const action = (type: PlayType, cards: Card[], maxValue: number, wildcardUsages: NonNullable<PlayAction['resolution']>['wildcardUsages'] = []): PlayAction => ({
  playerId: 'p1',
  type,
  cards,
  resolution: { type, maxValue, length: cards.length, ...(wildcardUsages.length ? { wildcardUsages } : {}) },
})

const playFixture = (id: string, label: string, description: string, makeAction: () => PlayAction): FixtureDefinition => Object.freeze({ id, label, description, kind: 'play', makeAction })
const sequenceFixture = (id: string, label: string, description: string, mode: EffectLabSequence['mode'], steps: readonly EffectLabSequenceStep[]): FixtureDefinition => Object.freeze({ id, label, description, kind: 'sequence', sequence: Object.freeze({ mode, steps: Object.freeze(steps.map(step => Object.freeze({ ...step }))) }) })
const diagnosticFixture = (id: string, label: string, description: string): FixtureDefinition => Object.freeze({ id, label, description, kind: 'diagnostic', diagnostic: Object.freeze({ check: 'runtime-assets' }) })

const PLAY_FIXTURES: readonly FixtureDefinition[] = [
  playFixture('play-bomb-small', '商业保留 · 四张炸弹', '正式牌局唯一保留的四张炸弹投掷与分层爆炸。', () => action(PlayType.Bomb, sameRank('bomb-small', 8, 4), 8)),
  playFixture('play-six-bomb', '商业保留 · 六张炸弹', '正式牌局保留的六炸专用冲击表现。', () => action(PlayType.Bomb, sameRank('six-bomb', 9, 6), 9)),
  playFixture('play-bomb-medium', '商业保留 · 七张炸弹', '正式牌局保留的中型炸弹投掷与分层爆炸。', () => action(PlayType.Bomb, sameRank('bomb-medium', 9, 7), 9)),
  playFixture('play-bomb-large', '商业保留 · 八张炸弹', '正式牌局保留的加强投掷与高强度爆炸。', () => action(PlayType.Bomb, sameRank('bomb-large', 10, 8), 10)),
]

const SEQUENCE_FIXTURES: readonly FixtureDefinition[] = [
  sequenceFixture('sequence-quality-matrix', '三档效果矩阵', '同一中炸依次以完整、精简、关闭模式触发。', 'quality-matrix', [
    { fixtureId: 'play-bomb-medium', delayMs: 0, quality: 'full' },
    { fixtureId: 'play-bomb-medium', delayMs: 850, quality: 'reduced' },
    { fixtureId: 'play-bomb-medium', delayMs: 1450, quality: 'off' },
  ]),
  sequenceFixture('sequence-seat-matrix', '四座位炸弹巡检', '从下、右、上、左四个座位依次投掷四张炸弹。', 'seat-matrix', [
    { fixtureId: 'play-bomb-small', delayMs: 0, quality: 'full' },
    { fixtureId: 'play-bomb-small', delayMs: 900, quality: 'full' },
    { fixtureId: 'play-bomb-small', delayMs: 1800, quality: 'full' },
    { fixtureId: 'play-bomb-small', delayMs: 2700, quality: 'full' },
  ]),
]
const DIAGNOSTIC_FIXTURES: readonly FixtureDefinition[] = [
  diagnosticFixture('diagnostic-runtime-assets', '资源失败检查', '检查运行时纹理加载、迁移候选隔离及拒绝素材门禁。'),
]
const MATCH_FIXTURES: readonly FixtureDefinition[] = FIXED_MATCH_FIXTURES.map(fixture => Object.freeze({
  id: fixture.id,
  label: fixture.label,
  description: fixture.description,
  kind: 'match' as const,
  makeState: fixture.createState,
}))

const FIXTURES: readonly FixtureDefinition[] = Object.freeze([
  ...MATCH_FIXTURES,
  ...PLAY_FIXTURES,
  ...SEQUENCE_FIXTURES,
  ...DIAGNOSTIC_FIXTURES,
])
const FIXTURE_BY_ID = new Map(FIXTURES.map(fixture => [fixture.id, fixture]))
const summaryOf = (fixture: FixtureDefinition): EffectLabFixtureSummary => Object.freeze({ id: fixture.id, label: fixture.label, kind: fixture.kind, description: fixture.description })
const cloneCard = (source: Card): Card => ({ ...source })
const cloneAction = (source: PlayAction): PlayAction => ({
  ...source,
  cards: source.cards.map(cloneCard),
  resolution: source.resolution ? { ...source.resolution, wildcardUsages: source.resolution.wildcardUsages?.map(usage => ({ ...usage })) } : undefined,
})

class DevelopmentEffectLab implements EffectLabApi {
  private readonly resolver = new EffectProfileResolver()

  public constructor (private readonly driver: EffectLabDriver) {}

  public list (kind?: EffectLabFixtureKind): readonly EffectLabFixtureSummary[] {
    return Object.freeze(FIXTURES.filter(fixture => !kind || fixture.kind === kind).map(summaryOf))
  }

  public inspect (id: string, quality: EffectQuality = 'full'): EffectLabPreview | null {
    const definition = FIXTURE_BY_ID.get(id)
    if (!definition) return null
    const fixture = summaryOf(definition)
    if (definition.kind === 'match') return Object.freeze({ fixture, matchState: definition.makeState(), quality })
    if (definition.kind === 'play') {
      const action = cloneAction(definition.makeAction())
      const resolvedProfile = this.resolver.resolve(action, quality)
      const effectProfile: EffectProfile = Object.freeze({
        ...resolvedProfile,
        color: Object.freeze([...resolvedProfile.color]) as EffectProfile['color'],
      })
      const audioProfile = effectProfile.sound ? resolveAudioProfile(effectProfile.sound) : null
      const additionalAudioProfiles = action.resolution?.wildcardUsages?.length
        ? [resolveAudioProfile('wildcard')].filter((profile): profile is AudioProfile => Boolean(profile))
        : []
      return Object.freeze({ fixture, action, effectProfile, actionVoiceProfile: resolvePlayVoiceProfile(action), audioProfile, additionalAudioProfiles: Object.freeze(additionalAudioProfiles), quality })
    }
    if (definition.kind === 'flow') return Object.freeze({ fixture, flow: { ...definition.flow }, quality })
    if (definition.kind === 'sequence') return Object.freeze({ fixture, sequence: { ...definition.sequence, steps: definition.sequence.steps.map(step => ({ ...step })) }, quality })
    if (definition.kind === 'diagnostic') return Object.freeze({ fixture, diagnostic: { ...definition.diagnostic }, quality })
    if (definition.kind === 'audio') return Object.freeze({ fixture, audioProfile: resolveAudioProfile(definition.event), quality })
    if (definition.kind === 'quick-chat') return Object.freeze({ fixture, quickChat: definition.phrase, quality })
    if (definition.kind === 'countdown') return Object.freeze({ fixture, countdownSecond: definition.remaining, audioProfile: resolveCountdownProfile(definition.remaining), quality })
    if (definition.kind === 'tribute') return Object.freeze({ fixture, tribute: { ...definition.tribute, card: definition.tribute.card ? cloneCard(definition.tribute.card) : null, returnCard: definition.tribute.returnCard ? cloneCard(definition.tribute.returnCard) : null }, quality })
    return Object.freeze({ fixture, settlement: { ...definition.settlement }, quality })
  }

  public trigger (id: string, quality: EffectQuality = 'full'): EffectLabPreview | null {
    const definition = FIXTURE_BY_ID.get(id)
    const preview = this.inspect(id, quality)
    if (!definition || !preview) return null
    if (definition.kind === 'match' && preview.matchState) this.driver.startFixedMatch?.(preview.matchState, preview.fixture)
    else if (definition.kind === 'play') this.driver.playAction?.(preview)
    else if (definition.kind === 'audio' && preview.audioProfile) this.driver.playAudio?.(definition.event, preview.audioProfile)
    else if (definition.kind === 'quick-chat' && preview.quickChat) this.driver.playQuickChat?.(preview.quickChat)
    else if (definition.kind === 'countdown' && preview.audioProfile) this.driver.playCountdown?.(definition.remaining, preview.audioProfile)
    else if (definition.kind === 'tribute' && preview.tribute) this.driver.playTribute?.(preview.tribute, preview.quality)
    else if (definition.kind === 'settlement' && preview.settlement) this.driver.playSettlement?.(preview.settlement, preview.quality)
    else if (definition.kind === 'flow' && preview.flow) this.driver.playFlow?.(preview.flow, preview.quality)
    else if (definition.kind === 'sequence' && preview.sequence) this.driver.playSequence?.(preview.sequence)
    else if (definition.kind === 'diagnostic' && preview.diagnostic) this.driver.runDiagnostic?.(preview.diagnostic)
    return preview
  }
}

/** Build-time gate. Production builds cannot enable the lab through a URL or persisted flag. */
export const isEffectLabAvailable = (): boolean => DEV || DEBUG

export const createEffectLab = (driver: EffectLabDriver = {}): EffectLabApi | null =>
  isEffectLabAvailable() ? new DevelopmentEffectLab(driver) : null
