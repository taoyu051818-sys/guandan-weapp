import { PlayType } from '../core/generated'

export const COMMERCIAL_BOMB_EFFECT_KEYS = Object.freeze([
  'bomb-small',
  'bomb-medium',
  'bomb-large',
  'six-bomb',
] as const)

export type CommercialBombEffectKey = typeof COMMERCIAL_BOMB_EFFECT_KEYS[number]

export type RejectedNonCommercialVfx = Readonly<{
  id: string
  playTypes: readonly PlayType[]
  effectKeys: readonly string[]
  previousRenderer: string
  commercialStatus: 'rejected'
  runtimeAllowed: false
  reason: string
}>

const rejected = (
  id: string,
  playTypes: readonly PlayType[],
  effectKeys: readonly string[],
  previousRenderer: string,
  reason: string,
): RejectedNonCommercialVfx => Object.freeze({
  id,
  playTypes: Object.freeze([...playTypes]),
  effectKeys: Object.freeze([...effectKeys]),
  previousRenderer,
  commercialStatus: 'rejected',
  runtimeAllowed: false,
  reason: `未达到商业化标准：${reason}。禁止运行时注册、测试入口或素材回接。`,
})

/**
 * Permanent rejection inventory for the removed placeholder VFX. Keeping the
 * decision as code makes a future renderer registration fail regression review
 * instead of silently reviving an effect that was already rejected by product.
 */
export const REJECTED_NON_COMMERCIAL_VFX: readonly RejectedNonCommercialVfx[] = Object.freeze([
  rejected(
    'ordinary-card-pattern-impact',
    [PlayType.Pair, PlayType.Triple, PlayType.TripleWithPair, PlayType.Straight, PlayType.Tube, PlayType.Plate],
    ['pair', 'triple', 'triplewithpair', 'straight', 'tube', 'plate'],
    'CardPatternEffectRenderer',
    '通用光圈、旋转徽记和星点缺少牌型专属美术语言',
  ),
  rejected(
    'straight-flush-impact',
    [PlayType.StraightFlush],
    ['straight-flush'],
    'SignaturePatternEffectRenderer',
    '同花顺使用通用漩涡和五牌印记，品质不足以进入商业牌局',
  ),
  rejected(
    'king-bomb-impact',
    [PlayType.Rocket],
    ['king-bomb'],
    'SignaturePatternEffectRenderer',
    '王炸沿用通用皇家光柱、漩涡与星点，尚未通过独立商业验收',
  ),
  rejected(
    'wildcard-overlay',
    [],
    ['wildcard'],
    'SignaturePatternEffectRenderer',
    '逢人配使用通用心形徽记，不能作为正式语义特效',
  ),
  rejected(
    'generic-flow-feedback',
    [],
    ['flow:*'],
    'FlowEffectRenderer',
    '发牌、聊天、贡还、胜负和升级均为通用粒子或文字占位表现',
  ),
])

const COMMERCIAL_BOMB_EFFECT_KEY_SET: ReadonlySet<string> = new Set(COMMERCIAL_BOMB_EFFECT_KEYS)
const REJECTED_EFFECT_KEY_SET: ReadonlySet<string> = new Set(
  REJECTED_NON_COMMERCIAL_VFX.flatMap(entry => entry.effectKeys.filter(key => key !== 'flow:*')),
)
const REJECTED_PLAY_TYPE_SET: ReadonlySet<PlayType> = new Set(
  REJECTED_NON_COMMERCIAL_VFX.flatMap(entry => entry.playTypes),
)

export const isCommercialBombEffectKey = (key: string): key is CommercialBombEffectKey =>
  COMMERCIAL_BOMB_EFFECT_KEY_SET.has(key)

export const isRejectedNonCommercialEffectKey = (key: string): boolean =>
  REJECTED_EFFECT_KEY_SET.has(key) || key.startsWith('flow:')

export const isArchivedPlayVisual = (type: PlayType, profileKey = ''): boolean =>
  REJECTED_PLAY_TYPE_SET.has(type) || isRejectedNonCommercialEffectKey(profileKey)

export const ARCHIVED_PLAY_VISUAL_LABELS: Readonly<Record<string, string>> = Object.freeze(
  Object.fromEntries(REJECTED_NON_COMMERCIAL_VFX.flatMap(entry => entry.effectKeys.map(key => [key, entry.reason]))),
)
