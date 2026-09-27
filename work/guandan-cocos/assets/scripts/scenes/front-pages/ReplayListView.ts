import type { ReplaySummary } from '../../services/FrontPageGatewayContracts'
import type { RuntimeUiFactory } from '../../ui/RuntimeUiFactory'
import type { TableViewport } from '../../ui/ScreenAdapter'
import { SecondaryPageShell, secondaryColors as colors } from '../../ui/SecondaryPageUi'

export function renderReplayList (parent: RuntimeUiFactory, replays: ReplaySummary[], status: string,
  actions: { back: () => void, retry: () => void, select: (id: string) => void }, viewport?: TableViewport): void {
  const face = new SecondaryPageShell(parent, '我的对局', actions.back, viewport)
  face.text('ReplayCount', `${replays.length} 场记录`, 363, 212, 300, 44, 22, colors.muted, false)
  if (!replays.length) {
    const loading = status.includes('正在'), empty = status.includes('暂无')
    face.empty(loading ? '正在读取对局' : empty ? '还没有完成的对局' : '对局记录暂时无法加载',
      empty ? '完成对局后，可以在这里查看记录和公开出牌回放。' : status, loading || empty ? undefined : actions.retry)
    return
  }
  const rows = face.scroll('ReplayList', 0, 153, -174, 1064, replays.length * 98)
  replays.forEach((replay, index) => {
    const y = -45 - index * 98
    rows.button('ReplayRecord-' + replay.id, '', 0, y, 1052, () => actions.select(replay.id), false, false, 88)
    rows.text('ReplayRoom', `房间 ${replay.roomId || '—'}`, -282, y + 18, 470, 38, 26, colors.text, true, true)
    rows.text('ReplayDate', new Date(replay.finishedAt).toLocaleString(), -282, y - 21, 470, 32, 20, colors.muted)
    rows.text('ReplayResult', replay.winnerTeam === 'teamA' ? 'A 队获胜' : replay.winnerTeam === 'teamB' ? 'B 队获胜' : '对局已结束', 126, y, 256, 42, 23, colors.muted, false)
    rows.text('ReplayOpen', '查看回放  ›', 407, y, 214, 50, 24, colors.gold, false, true)
  })
  face.text('ReplayStatus', status, -70, -217, 890, 46, 20, colors.muted)
  face.button('ReplayRefresh', '刷新', 444, -217, 152, actions.retry)
}
