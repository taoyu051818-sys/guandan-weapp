import type { Rank } from '../types/game'

export const MATCH_LEVELS: readonly Rank[] = [2, 3, 4, 5, 6, 7, 8, 9, 10, 'J', 'Q', 'K', 'A']

/** Absent on historical matches, whose original progression contract is preserved. */
export interface MatchFormat {
  kind: 'independent' | 'upgrade'
  levelMode: 'random' | 'fixed'
  levelRank: Rank
  tributeEnabled: boolean
  doubleDown: 3 | 4
  /** Explicit new-room gate; absent preserves historical settlement. */
  upgradeTarget?: 6 | 10 | 'A' | 'A-reset'
}

export interface RoomFormatSettings {
  format: 'rounds' | 'upgrade'
  levelMode: 'random' | 'fixed'
  levelRank: Rank
  tributeEnabled: boolean
  upgradeTarget?: 6 | 10 | 'A' | 'A-reset'
}

/** Shared validation for signed room settings; missing format is legacy, never silently migrated. */
export const normalizeRoomFormat = (source: Record<string, unknown>): RoomFormatSettings | undefined => {
  if (source.format === undefined) {
    if (['levelMode', 'levelRank', 'tributeEnabled', 'upgradeTarget'].some(key => source[key] !== undefined)) throw new Error('请先选择赛制')
    return undefined
  }
  if (source.format !== 'rounds' && source.format !== 'upgrade') throw new Error('赛制必须为定局或传统升级')
  const upgrade = source.format === 'upgrade'
  const levelMode = source.levelMode ?? (upgrade ? 'fixed' : 'random')
  const levelRank = source.levelRank ?? 2
  const tributeEnabled = source.tributeEnabled ?? upgrade
  if (levelMode !== 'random' && levelMode !== 'fixed') throw new Error('级牌方式无效')
  if (!MATCH_LEVELS.includes(levelRank as Rank)) throw new Error('级牌须为 2～A')
  if (typeof tributeEnabled !== 'boolean') throw new Error('进贡开关无效')
  if (upgrade && (levelMode !== 'fixed' || levelRank !== 2)) throw new Error('传统升级从 2 开始')
  if (!upgrade && tributeEnabled) throw new Error('定局玩法不进贡')
  const target = source.upgradeTarget
  if (target !== undefined && (!upgrade || ![6, 10, 'A', 'A-reset'].includes(target as never))) throw new Error('升级目标无效')
  return { format: source.format, levelMode, levelRank: levelRank as Rank, tributeEnabled,
    ...(target !== undefined ? { upgradeTarget: target as RoomFormatSettings['upgradeTarget'] } : {}) }
}

export const roomMatchFormat = (settings: RoomFormatSettings, doubleDown: 3 | 4 = 3): MatchFormat => ({
  kind: settings.format === 'rounds' ? 'independent' : 'upgrade',
  levelMode: settings.levelMode, levelRank: settings.levelRank,
  tributeEnabled: settings.tributeEnabled, doubleDown,
  ...(settings.upgradeTarget !== undefined ? { upgradeTarget: settings.upgradeTarget } : {}),
})

export const chooseMatchLevel = (format: MatchFormat, random: () => number = Math.random): Rank => {
  if (format.kind === 'upgrade') return 2
  if (format.levelMode === 'fixed') return format.levelRank
  const value = random()
  if (!Number.isFinite(value) || value < 0 || value >= 1) throw new Error('INVALID_LEVEL_RANDOM')
  return MATCH_LEVELS[Math.floor(value * MATCH_LEVELS.length)]
}
