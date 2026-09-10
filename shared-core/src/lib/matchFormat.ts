import type { Rank } from '../types/game'

export const MATCH_LEVELS: readonly Rank[] = [2, 3, 4, 5, 6, 7, 8, 9, 10, 'J', 'Q', 'K', 'A']

/** Absent on historical matches, whose original progression contract is preserved. */
export interface MatchFormat {
  kind: 'independent' | 'upgrade' | 'rotating'
  levelMode: 'random' | 'fixed'
  levelRank: Rank
  tributeEnabled: boolean
  doubleDown: 3 | 4
  /** Individual tournaments must determine third place instead of ending at a team double-out. */
  individualRanking?: boolean
  /** Explicit new-room gate; absent preserves historical settlement. */
  upgradeTarget?: 6 | 10 | 'A' | 'A-reset'
  teamRotation?: 'draw' | 'clockwise'
  rotatingScoring?: 3 | 6
}

export interface RoomFormatSettings {
  format: 'rounds' | 'upgrade' | 'rotating' | 'duplicate'
  levelMode: 'random' | 'fixed'
  levelRank: Rank
  tributeEnabled: boolean
  upgradeTarget?: 6 | 10 | 'A' | 'A-reset'
  teamRotation?: 'draw' | 'clockwise'
  rotatingScoring?: 3 | 6
}

/** Shared validation for signed room settings; missing format is legacy, never silently migrated. */
export const normalizeRoomFormat = (source: Record<string, unknown>): RoomFormatSettings | undefined => {
  if (source.format === undefined) {
    if (['levelMode', 'levelRank', 'tributeEnabled', 'upgradeTarget', 'teamRotation', 'rotatingScoring'].some(key => source[key] !== undefined)) throw new Error('请先选择赛制')
    return undefined
  }
  if (!['rounds', 'upgrade', 'rotating', 'duplicate'].includes(source.format as string)) throw new Error('赛制必须为定局、传统升级、转蛋或复式')
  const rotating = source.format === 'rotating'
  if (!rotating && (source.teamRotation !== undefined || source.rotatingScoring !== undefined)) throw new Error('换队与个人计分仅适用于转蛋')
  const teamRotation = source.teamRotation ?? 'draw'
  const rotatingScoring = source.rotatingScoring ?? 3
  if (rotating && !['draw', 'clockwise'].includes(teamRotation as string)) throw new Error('队友轮换方式无效')
  if (rotating && rotatingScoring !== 3 && rotatingScoring !== 6) throw new Error('转蛋须使用3分制或6分制')
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
  return { format: source.format as RoomFormatSettings['format'], levelMode, levelRank: levelRank as Rank, tributeEnabled,
    ...(rotating ? { teamRotation: teamRotation as 'draw' | 'clockwise', rotatingScoring: rotatingScoring as 3 | 6 } : {}),
    ...(target !== undefined ? { upgradeTarget: target as RoomFormatSettings['upgradeTarget'] } : {}) }
}

export const roomMatchFormat = (settings: RoomFormatSettings, doubleDown: 3 | 4 = 3): MatchFormat => ({
  kind: settings.format === 'rounds' || settings.format === 'duplicate' ? 'independent' : settings.format,
  levelMode: settings.levelMode, levelRank: settings.levelRank,
  tributeEnabled: settings.tributeEnabled, doubleDown,
  ...(settings.upgradeTarget !== undefined ? { upgradeTarget: settings.upgradeTarget } : {}),
  ...(settings.format === 'rotating' ? { teamRotation: settings.teamRotation ?? 'draw', rotatingScoring: settings.rotatingScoring ?? 3, doubleDown: 3 } : {}),
})

export const chooseMatchLevel = (format: MatchFormat, random: () => number = Math.random): Rank => {
  if (format.kind === 'upgrade') return 2
  if (format.levelMode === 'fixed') return format.levelRank
  const value = random()
  if (!Number.isFinite(value) || value < 0 || value >= 1) throw new Error('INVALID_LEVEL_RANDOM')
  return MATCH_LEVELS[Math.floor(value * MATCH_LEVELS.length)]
}
