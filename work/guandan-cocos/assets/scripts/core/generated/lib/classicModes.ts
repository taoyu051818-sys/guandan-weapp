import type { MatchFormat } from './matchFormat'

/** One contract for the lobby, platform admission and authoritative game server. */
export const CLASSIC_MODES = [
  { id: 'classic', label: '经典', description: '随机级牌 · 单局对战' },
  { id: 'no-shuffle', label: '不洗牌', description: '不洗牌发牌 · 随机级牌 · 单局对战' },
  { id: 'consecutive', label: '连打过A', description: '从2升级 · 进贡还贡 · 连打过A' },
] as const
export type ClassicMode = typeof CLASSIC_MODES[number]['id']
export const CLASSIC_BASE_STAKES = [50, 300, 2000, 10000] as const
export type ClassicBaseStake = typeof CLASSIC_BASE_STAKES[number]
export type ClassicQueueId = `${ClassicMode}_${ClassicBaseStake}`
export const classicQueueId = (mode: ClassicMode, stake: ClassicBaseStake): ClassicQueueId => `${mode}_${stake}`
export const CLASSIC_QUEUES = CLASSIC_MODES.flatMap(mode => CLASSIC_BASE_STAKES.map(stake => ({
  id: classicQueueId(mode.id, stake), mode: mode.id, stake, label: mode.label,
})))

export const classicQueue = (id: string) => CLASSIC_QUEUES.find(queue => queue.id === id)
export const isPublicClassicQueue = (id: string): boolean => id === 'quick' || Boolean(classicQueue(id))

export const classicMatchFormat = (id: string): MatchFormat | undefined => {
  const mode = id === 'quick' ? 'classic' : classicQueue(id)?.mode
  if (!mode) return undefined
  if (mode === 'consecutive') return {
    kind: 'upgrade', levelMode: 'fixed', levelRank: 2, tributeEnabled: true, doubleDown: 3, upgradeTarget: 'A',
  }
  return {
    kind: 'independent', levelMode: 'random', levelRank: 2, tributeEnabled: false, doubleDown: 3,
    ...(mode === 'no-shuffle' ? { dealMode: 'no-shuffle' as const } : {}),
  }
}
