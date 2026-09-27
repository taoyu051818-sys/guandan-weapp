import type { AuthGateway, PlayerDashboard, SeasonTaskList } from '../../services/FrontPageGatewayContracts'
import { mountProfileAvatar } from '../../ui/ProfileAvatar'
import type { RuntimeUiFactory } from '../../ui/RuntimeUiFactory'
import type { TableViewport } from '../../ui/ScreenAdapter'
import { SecondaryPageShell, secondaryColors as colors } from '../../ui/SecondaryPageUi'

export function renderPlayerCenter (parent: RuntimeUiFactory, dashboard: PlayerDashboard | null, status: string,
  points: string, auth: AuthGateway, actions: { back: () => void, retry: () => void, edit: () => void,
    tasks: () => void, records: () => void, ranking: () => void }, viewport?: TableViewport): void {
  const face = new SecondaryPageShell(parent, '个人中心', actions.back, viewport)
  if (!dashboard) {
    const loading = status.includes('正在')
    face.empty(loading ? '正在同步个人资料' : '个人资料暂时不可用', loading ? '请稍候，你的资料会在这里显示。' : status, loading ? undefined : actions.retry)
    return
  }
  face.text('ProfileSync', status, 365, 212, 310, 40, 20, colors.muted, false)
  face.panel('IdentityCard', -360, -12, 320, 326, colors.inset)
  mountProfileAvatar(face.ui.parent, dashboard.user, auth, -360, 83, 96)
  face.text('ProfileName', dashboard.user.displayName, -360, 4, 284, 42, 28, colors.text, false, true)
  face.text('ProfileAccount', `账号 ${dashboard.user.accountId}`, -360, -38, 284, 34, 20, colors.muted, false)
  face.button('EditProfile', '编辑资料', -360, -116, 232, actions.edit)
  const metrics = [ ['积分', points], ['综合分', String(Math.round(dashboard.rating.comprehensiveScore))] ]
  metrics.forEach(([label, value], index) => {
    const x = -3 + index * 346
    face.panel('ProfileMetric', x, 98, 326, 122)
    face.text('MetricLabel', label, x, 126, 282, 30, 21, colors.muted)
    face.text('MetricValue', value, x, 77, 282, 55, 42, colors.gold, true, true)
  })
  const games = Math.max(0, dashboard.rating.games)
  const winRate = games ? Math.round(Math.max(0, dashboard.rating.wins) * 100 / games) : 0
  const stats = [['对局', String(games)], ['胜率', `${winRate}%`], ['头游', String(dashboard.stats.firstPlaceFinishes)]]
  stats.forEach(([label, value], index) => {
    const x = -60 + index * 218
    face.text('StatValue', value, x, 2, 190, 46, 30, colors.text, false, true)
    face.text('StatLabel', label, x, -38, 190, 30, 20, colors.muted, false)
  })
  face.ui.panel('ProfileDivider', 174, -68, 676, 1, { fill: colors.line, lineWidth: 0, frame: 'square' })
  const season = dashboard.season
  face.text('SeasonName', season?.name ?? '暂无进行中的赛季', 174, -107, 674, 38, 24, colors.text)
  face.text('SeasonProgress', season ? `${season.progress.score} 分  ·  已完成 ${season.progress.gamesPlayed} 场` : '赛季开放后可在此查看进度', 174, -145, 674, 34, 20, colors.muted)
  face.button('ProfileTasks', '赛季任务', -352, -217, 322, actions.tasks)
  face.button('ProfileRecords', '我的对局', 0, -217, 322, actions.records)
  face.button('ProfileRanking', '好友排行榜', 352, -217, 322, actions.ranking)
}

export function renderSeasonTasks (parent: RuntimeUiFactory, list: SeasonTaskList | null, status: string,
  configured: boolean, pending: string | null, actions: { back: () => void, retry: () => void, claim: (id: string) => void }, viewport?: TableViewport): void {
  const face = new SecondaryPageShell(parent, '赛季任务', actions.back, viewport)
  face.text('SeasonTitle', list?.season?.name ?? '', 374, 212, 290, 44, 21, colors.muted, false)
  if (!list || !list.tasks.length) {
    const loading = status.includes('正在')
    face.empty(loading ? '正在读取任务' : list ? '暂无赛季任务' : '任务暂时无法加载',
      list ? '新任务开放后，会在这里显示。' : status, !list && !loading ? actions.retry : undefined)
    return
  }
  const content = face.scroll('SeasonTaskList', 0, 153, -172, 1064, list.tasks.length * 104)
  list.tasks.forEach((task, index) => {
    const y = -49 - index * 104, progress = Math.min(Math.max(task.progress, 0), task.target)
    const claimable = configured && task.completed && !task.claimed
    content.panel('SeasonTaskRow', 0, y, 1052, 94)
    content.text('TaskName', task.name, -274, y + 18, 450, 40, 25, colors.text, true, true)
    content.text('TaskProgress', `进度 ${progress} / ${task.target}`, -274, y - 20, 450, 30, 20, colors.muted)
    content.text('TaskReward', `+${task.rewardPoints} 积分`, 165, y, 226, 50, 27, colors.gold, false, true)
    const state = pending === task.id ? '领取中…' : task.claimed ? '已领取' : claimable ? '领取奖励' : task.completed ? '演示完成' : '进行中'
    if (claimable) content.button('ClaimSeasonTask', state, 408, y, 200, () => actions.claim(task.id), true, Boolean(pending))
    else content.text('TaskState', state, 408, y, 200, 52, 22, colors.muted, false)
  })
  face.text('TaskStatus', status, 0, -217, 990, 44, 20, colors.muted, false)
}
