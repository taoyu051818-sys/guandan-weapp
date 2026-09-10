import type { TournamentState, TournamentSummary, TournamentStandings } from '../../services/FrontPageGatewayContracts'

export type TournamentTab = 'status' | 'standings' | 'rules'
export type TournamentCenterState = {
  tournament: TournamentSummary | null
  state: TournamentState | null
  standings: TournamentStandings | null
  busy: boolean
  error: string
  tab: TournamentTab
  rankingPage: number
}
export const tournamentAction = (view: TournamentCenterState): { label: string, kind: 'enroll' | 'check-in' | 'enter' | 'rank' | 'none' } => {
  if (view.busy) return { label: '正在同步', kind: 'none' }
  if (view.error) return { label: '等待同步', kind: 'none' }
  const t = view.tournament, s = view.state
  if (!t || !s) return { label: '暂无可用赛事', kind: 'none' }
  if (s.phase === 'blocked') return { label: '赛事已暂停', kind: 'none' }
  if (s.phase === 'finished') return { label: '最终排名', kind: 'rank' }
  if (!s.viewerEntry.enrolled) return { label: t.status === 'open' ? '免费报名' : '报名已结束', kind: t.status === 'open' ? 'enroll' : 'none' }
  if (!s.viewerEntry.checkedIn) return { label: s.viewerEntry.rosterLocked ? '名单已锁定' : '确认检录', kind: s.viewerEntry.rosterLocked ? 'none' : 'check-in' }
  if (s.phase === 'check-in') return { label: '等待检录完成', kind: 'none' }
  if (s.assignment && ['pending', 'matching', 'matched'].includes(s.assignment.status)) return { label: `进入第 ${s.roundNumber} 轮`, kind: 'enter' }
  return { label: '等待本轮结束', kind: 'none' }
}
export const canWithdrawTournament = (view: TournamentCenterState): boolean =>
  view.tournament?.status === 'open' && view.state?.phase === 'check-in' &&
  view.state.viewerEntry.enrolled && !view.state.viewerEntry.rosterLocked
export const tournamentStatusCopy = (s: TournamentState | null): { title: string, detail: string } => {
  if (!s) return { title: '连接赛事服务', detail: '赛事信息以服务器返回为准' }
  if (s.phase === 'blocked') return { title: '赛事暂停', detail: '有牌桌异常中断，等待组织者处理。\n不会自动补赛或改写已完成的成绩。' }
  if (s.phase === 'finished') return { title: '本次赛事已结束', detail: '全部轮次已结算，可查看最终排名。\n晋级仅为资格标记，暂无自动淘汰赛。' }
  if (s.phase === 'check-in') return { title: `已检录 ${s.checkedInCount} / ${s.capacity} 人`, detail: s.viewerEntry.checkedIn ? '你已检录。满 16 人锁定名单并分桌。\n请留在赛事中心，避免错过开赛。' : s.viewerEntry.enrolled ? '报名成功，请确认检录后等待开赛。\n检录会占用正式比赛名额。' : '免费报名，检录满 16 人开始。\n本赛事不使用机器人补位。' }
  return { title: `第 ${s.roundNumber} / ${s.roundsTotal} 轮`, detail: s.assignment?.status === 'completed' ? '你的牌桌已结束，正在等待其他牌桌。\n全轮结束后，统一分配下一轮牌桌。' : s.assignment ? `你的分桌：第 ${s.assignment.tableNumber} 桌\n请点击下方按钮进入指定牌桌。` : '本轮已开始；当前账号没有本轮分桌。' }
}
