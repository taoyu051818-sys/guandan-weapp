import type { DuplicateRoomSummary } from '../network/DuplicateRoomModel'

export const duplicateTableLabel = (d?: DuplicateRoomSummary | null): string | null => {
  if (!d) return null
  const home = d.slots.find(s => s.seat === d.mySeat)?.table ?? 'A'
  return `复式 ${d.watching ?? home}桌 · 红 ${d.scores.red} : 蓝 ${d.scores.blue}`
}

export const duplicateFinalPresentation = (d: DuplicateRoomSummary): Readonly<{ title: string, detail: string }> => {
  const team = d.slots.find(s => s.seat === d.mySeat)?.team
  const winner = d.scores.red === d.scores.blue ? null : d.scores.red > d.scores.blue ? 'red' : 'blue'
  const outcome = !winner ? '平局' : !team ? `${winner === 'red' ? '红' : '蓝'}队获胜` : winner === team ? '胜利' : '失利'
  return { title: `复式全场结束 · ${d.history.length < d.configuredRounds ? '时限结束' : outcome}`, detail: `两桌已完成 ${d.history.length}/${d.configuredRounds} 局\n红队 ${d.scores.red} · 蓝队 ${d.scores.blue}` }
}
