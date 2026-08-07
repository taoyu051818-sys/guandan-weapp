import { PlayType, type PlayAction } from '../core/generated'
import type { EffectProfile, EffectQuality } from './EffectTypes'

const profile = (value: EffectProfile): EffectProfile => value

// Normal card plays rely on the human announcement only. The former generic
// electronic "card" sound overlapped the voice and made both less legible.
const normal = profile({ key: 'play-normal', level: 0, label: '', durationMs: 0, flightMs: 260, shake: 'none', sound: null, haptic: 'light', dimTable: false, color: [116, 220, 198] })
const pass = profile({ key: 'pass', level: 0, label: '', durationMs: 0, flightMs: 0, shake: 'none', sound: 'pass', haptic: 'none', dimTable: false, color: [116, 220, 198] })

/** Converts rule semantics into art direction. Rules never reference concrete assets. */
export class EffectProfileResolver {
  public resolve (action: PlayAction, quality: EffectQuality): EffectProfile {
    if (action.type === PlayType.Pass) return this.applyQuality(pass, quality)
    if (action.type === PlayType.Bomb) {
      const count = action.resolution?.length ?? action.cards.length
      const level = count >= 8 ? 3 : 2
      if (count === 6) {
        return this.applyQuality({ key: 'six-bomb', level, label: '六张炸弹', durationMs: 1040, flightMs: 300, shake: 'medium', sound: 'bomb', haptic: 'heavy', dimTable: true, color: [255, 121, 45] }, quality)
      }
      return this.applyQuality({ key: count <= 5 ? 'bomb-small' : count <= 7 ? 'bomb-medium' : 'bomb-large', level, label: `${count}张炸弹`, durationMs: count <= 5 ? 520 : count <= 7 ? 620 : 760, flightMs: 300, shake: count <= 5 ? 'light' : count <= 7 ? 'medium' : 'strong', sound: 'bomb', haptic: count <= 5 ? 'medium' : 'heavy', dimTable: count >= 8, color: [255, 139, 61] }, quality)
    }
    // All non-bomb impact VFX were rejected as non-commercial. They retain the
    // real card flight and one human announcement, but have no post-flight layer.
    return this.applyQuality(normal, quality)
  }

  private applyQuality (source: EffectProfile, quality: EffectQuality): EffectProfile {
    if (quality === 'full') return source
    if (quality === 'reduced') return { ...source, level: Math.min(source.level, 1) as 0 | 1, durationMs: Math.min(source.durationMs, 420), flightMs: Math.min(source.flightMs, 240), shake: 'none', haptic: 'none', dimTable: false }
    // Visual quality does not mute sound; the independent sound setting owns that choice.
    return { ...source, key: 'none', level: 0, label: '', durationMs: 0, flightMs: 0, shake: 'none', haptic: 'none', dimTable: false }
  }
}
