import { Color, Label, Node, UITransform, Vec3 } from 'cc'
import { RuntimeUiFactory } from '../../ui/RuntimeUiFactory'
import { TABLE_BUTTON_HEIGHT, TABLE_BUTTON_FONT } from '../../ui/TableButtonMetrics'
import type { TableViewport } from '../../ui/ScreenAdapter'
import { canWithdrawTournament, tournamentAction, tournamentStatusCopy, type TournamentCenterState, type TournamentTab } from './TournamentCenterModel'

const palette = {
  panel: new Color(16, 43, 48, 239), line: new Color(150, 191, 184, 145),
  text: new Color(249, 244, 222), muted: new Color(190, 212, 207),
  gold: new Color(248, 208, 112), button: new Color(49, 100, 94, 255),
}
type Actions = { back: () => void, withdraw: () => void, action: () => void, tab: (tab: TournamentTab) => void, page: (delta: number) => void }

/** Fixed design grid, uniformly fit into the safe landscape area; no capsule frames. */
export function renderTournamentCenter (parent: RuntimeUiFactory, viewport: TableViewport, view: TournamentCenterState, actions: Actions): void {
  const surface = new Node('TournamentSurface')
  surface.parent = parent.parent
  surface.addComponent(UITransform).setContentSize(1180, 560)
  const width = viewport.width - (viewport.safeLeft || 0) - (viewport.safeRight || 0)
  const height = viewport.height - (viewport.safeTop || 0) - (viewport.safeBottom || 0)
  const scale = Math.min(width / 1280, height / 589)
  surface.setScale(new Vec3(scale, scale, 1))
  surface.setPosition(new Vec3(((viewport.safeLeft || 0) - (viewport.safeRight || 0)) / 2, ((viewport.safeBottom || 0) - (viewport.safeTop || 0)) / 2, 0))
  const ui = new RuntimeUiFactory(surface)
  const text = (name: string, value: string, x: number, y: number, w: number, h: number, size = 24, color = palette.text) => {
    const label = ui.label(name, x, y, size)
    label.string = value
    label.node.getComponent(UITransform)?.setContentSize(w, h)
    label.color = color
    label.lineHeight = size + 9
    label.enableWrapText = true
    label.overflow = Label.Overflow.SHRINK
    return label
  }
  const button = (name: string, label: string, x: number, y: number, w: number, callback: () => void, primary = false, disabled = false) => {
    const node = ui.button(name, label, x, w, TABLE_BUTTON_HEIGHT, TABLE_BUTTON_FONT, {
      frame: 'control', fill: primary ? new Color(133, 87, 28, 255) : palette.button,
      stroke: primary ? palette.gold : palette.line, disabled,
    })
    node.setPosition(new Vec3(x, y, 0))
    if (!disabled) node.on(Node.EventType.TOUCH_END, callback)
    return node
  }
  button('TournamentBack', '返回', -510, 239, 140, actions.back)
  text('TournamentTitle', '陵水赛事', -303, 239, 230, 64, 38)
  ui.panel('TournamentSubtitleBase', -48, 239, 192, 48, { fill: palette.panel, stroke: palette.line, frame: 'panel' })
  text('TournamentSubtitle', '16 人积分赛', -48, 239, 180, 44, 23, palette.muted)
  ui.panel('TournamentOverview', -408, -1, 342, 374, { fill: palette.panel, stroke: palette.line, frame: 'panel' })
  ui.image('TournamentArtwork', 'ui/lobby/entry-tournament-cutout-v4/texture', -408, 49, 244, 244)
  text('TournamentName', view.tournament?.name ?? '16 人积分赛', -408, -91, 310, 54, 29)
  text('TournamentFormat', '免费报名 · 3 轮换桌', -408, -142, 308, 44, 23, palette.gold)
  ui.panel('TournamentContent', 187, -1, 790, 374, { fill: palette.panel, stroke: palette.line, frame: 'panel' })
  const tabs: Array<[TournamentTab, string]> = [['status', '赛况'], ['standings', '排名'], ['rules', '规则']]
  tabs.forEach(([tab, title], index) => button('TournamentTab-' + tab, title, 187 + (index - 1) * 152, 146, 140, () => actions.tab(tab), view.tab === tab))
  if (view.tab === 'status') {
    const copy = tournamentStatusCopy(view.state)
    text('TournamentPhase', copy.title, 187, 64, 720, 60, 36, palette.gold)
    text('TournamentDetail', copy.detail, 187, -24, 716, 104, 27)
    const progress = view.state?.phase === 'round-active' ? `本轮已完成 ${view.state.tablesSettled} / ${view.state.tablesTotal} 桌` : '每轮一副 · 随机级牌 · 个人积分'
    text('TournamentProgress', progress, 187, -126, 710, 50, 23, palette.muted)
  } else if (view.tab === 'rules') {
    text('TournamentRules', '16 人检录后开赛，3 轮 × 4 桌，不重复同桌。\n每桌随机级牌，只打一副；不升级、不进贡。\n个人计分：头游 3、二游 2、三游 1、末游 0。\n双上不提前结束，打出第三名后结算。\n同分比较：对手分、胜场、头游次数、账号顺序。\n3 轮结束前 8 名标记晋级，不自动进入淘汰赛。\n每轮等 4 桌结束再换桌；异常中断暂停赛事。', 187, -28, 730, 236, 22)
  } else {
    const all = view.standings?.standings ?? []
    const maxPage = Math.max(0, Math.ceil(all.length / 4) - 1)
    const page = Math.min(maxPage, view.rankingPage)
    ;[['名次', -105, 70], ['玩家', 55, 235], ['积分', 235, 85], ['场数', 340, 75], ['结果', 470, 125]].forEach(([title, x, width]) =>
      text('RankingHeader-' + title, String(title), Number(x), 81, Number(width), 35, 22, palette.muted))
    all.slice(page * 4, page * 4 + 4).forEach((row, index) => {
      const y = 37 - index * 43
      const own = row.userId === view.standings?.viewerStanding?.userId
      text('RankingPlace', String(row.rank), -105, y, 70, 38, 26, own ? palette.gold : palette.text)
      text('RankingName', Array.from(row.displayName).slice(0, 9).join(''), 55, y, 235, 38, 24, own ? palette.gold : palette.text)
      text('RankingPoints', String(row.points), 235, y, 85, 38, 26)
      text('RankingPlayed', String(row.played), 340, y, 75, 38, 24, palette.muted)
      text('RankingQualification', row.qualificationStatus === 'qualified' ? '已晋级' : row.qualificationStatus === 'eliminated' ? '未晋级' : '待定', 470, y, 125, 38, 22, row.advanced ? palette.gold : palette.muted)
    })
    if (!all.length) text('RankingEmpty', '暂无成绩，完成比赛后更新', 187, -18, 710, 65, 27, palette.muted)
    text('RankingPage', `${page + 1} / ${maxPage + 1}${view.standings?.provisional === false ? ' · 最终' : ' · 暂定'}`, 45, -145, 310, 38, 22, palette.muted)
    button('RankingPrevious', '上一页', 318, -145, 128, () => actions.page(-1), false, page === 0)
    button('RankingNext', '下一页', 463, -145, 128, () => actions.page(1), false, page === maxPage)
  }
  const action = tournamentAction(view)
  const feedback = view.state?.phase === 'finished' ? '最终成绩已公布；前 8 名标记晋级。'
    : view.state?.phase === 'round-active' ? '本轮完成后返回赛事中心，等待下一轮分桌。'
    : view.state?.phase === 'blocked' ? '赛事已暂停；已结算的成绩保留。'
    : view.state?.viewerEntry.checkedIn ? '已检录，请保持在线等待分桌。' : '报名后请确认检录；每轮随机级牌，只打一副。'
  text('TournamentFeedback', view.error || (view.busy ? '正在同步赛事信息…' : feedback), -206, -232, 708, 58, 22, view.error ? palette.gold : palette.muted)
  if (canWithdrawTournament(view)) button('TournamentWithdraw', '取消报名', 263, -232, 194, actions.withdraw, false, view.busy)
  button('TournamentAction', action.label, 486, -232, 218, actions.action, true, action.kind === 'none')
}
