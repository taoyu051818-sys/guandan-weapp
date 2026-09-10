import { PlayType, type PlayAction } from '../core/generated'

export type PlayVoiceProfile = Readonly<{
  /** Keys below game-assets/audio/voices, ordered from preferred to fallback. */
  assetKeys: readonly string[]
  volumeScale: number
}>

const voiceProfile = (assetKeys: readonly string[], volumeScale = 0.92): PlayVoiceProfile =>
  Object.freeze({ assetKeys: Object.freeze([...assetKeys]), volumeScale })

const singleVoices: Readonly<Record<string, PlayVoiceProfile>> = Object.freeze({
  '2': voiceProfile(['niuma/single_2']),
  '3': voiceProfile(['niuma/single_3']),
  '4': voiceProfile(['niuma/single_4']),
  '5': voiceProfile(['niuma/single_5', 'licensed/single_5_female']),
  '6': voiceProfile(['niuma/single_6']),
  '7': voiceProfile(['niuma/single_7']),
  '8': voiceProfile(['niuma/single_8']),
  '9': voiceProfile(['niuma/single_9']),
  '10': voiceProfile(['niuma/single_10']),
  J: voiceProfile(['niuma/single_j']),
  Q: voiceProfile(['niuma/single_q']),
  K: voiceProfile(['niuma/single_k']),
  A: voiceProfile(['niuma/single_a']),
  Small: voiceProfile(['niuma/single_small_joker']),
  Big: voiceProfile(['niuma/single_big_joker']),
})

const pairVoices: Readonly<Record<string, PlayVoiceProfile>> = Object.freeze({
  '2': voiceProfile(['niuma/pair_2']),
  '3': voiceProfile(['niuma/pair_3']),
  '4': voiceProfile(['niuma/pair_4']),
  '5': voiceProfile(['niuma/pair_5']),
  '6': voiceProfile(['niuma/pair_6']),
  '7': voiceProfile(['niuma/pair_7']),
  '8': voiceProfile(['niuma/pair_8']),
  '9': voiceProfile(['niuma/pair_9']),
  '10': voiceProfile(['niuma/pair_10']),
  J: voiceProfile(['niuma/pair_j']),
  Q: voiceProfile(['niuma/pair_q']),
  K: voiceProfile(['niuma/pair_k']),
  A: voiceProfile(['niuma/pair_a']),
  Small: voiceProfile(['niuma/pair_joker_generic']),
  Big: voiceProfile(['niuma/pair_joker_generic']),
})

const straightVoice = voiceProfile(['niuma/straight'])
const tripleVoice = voiceProfile(['niuma/triple'])
const tripleWithPairVoice = voiceProfile(['niuma/triple_with_pair'])
const tubeVoice = voiceProfile(['niuma/tube'])
const plateVoice = voiceProfile(['tts/steel_plate'], 0.92)
const straightFlushVoice = voiceProfile(['niuma/straight_flush'])
const bombVoice = voiceProfile(['niuma/bomb'])
const kingBombVoice = voiceProfile(['niuma/king_bomb'])

/**
 * Resolves only unambiguous announcements. The curated Female matrix covers all
 * physical ranks and valid heart-wildcard pairs, announcing the resolved pair rank.
 */
export const resolvePlayVoiceProfile = (action: PlayAction): PlayVoiceProfile | null => {
  if (action.type === PlayType.Straight) return straightVoice
  if (action.type === PlayType.Triple) return tripleVoice
  if (action.type === PlayType.TripleWithPair) return tripleWithPairVoice
  if (action.type === PlayType.Tube) return tubeVoice
  if (action.type === PlayType.Plate) return plateVoice
  if (action.type === PlayType.StraightFlush) return straightFlushVoice
  if (action.type === PlayType.Bomb) return bombVoice
  if (action.type === PlayType.Rocket) return kingBombVoice
  if (action.type !== PlayType.Single && action.type !== PlayType.Pair) return null
  if (action.resolution?.wildcardUsages?.length) {
    if (action.type !== PlayType.Pair || action.cards.length !== 2) return null
    const natural = action.cards.find(card => !card.isRedJoker)
    const rank = natural?.rank
    if (!natural || rank === 'Small' || rank === 'Big' || natural.suit === 'joker') return null
    const usages = action.resolution.wildcardUsages
    if (!usages.every(usage => usage.representedValue === natural.value && usage.representedSuit !== 'joker' &&
      action.cards.some(card => card.id === usage.cardId && card.isRedJoker))) return null
    return pairVoices[String(rank)] ?? null
  }
  const ranks = new Set(action.cards.map(card => String(card.rank)))
  if (ranks.size !== 1) return null
  const rank = ranks.values().next().value as string | undefined
  if (!rank) return null
  return action.type === PlayType.Single ? singleVoices[rank] ?? null : pairVoices[rank] ?? null
}
