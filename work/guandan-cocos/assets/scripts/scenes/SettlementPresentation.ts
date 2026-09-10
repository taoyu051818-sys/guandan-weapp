import type { PlayerId } from '../core/generated'
import type { GameSnapshot } from '../game/GameManager'
import type { TableSettlementContent } from '../ui/TableSettlementView'
import type { NetworkMatchEnded } from '../network/LobbyModels'
import { projectMatchEndedPresentation } from './MatchEndedPresentation'
import type { DuplicateRoomSummary } from '../network/DuplicateRoomModel'

export const projectSettlementContent = (
  snapshot: GameSnapshot, humanId: PlayerId, title: string | null,
  multiplayer: boolean, readyIds: readonly PlayerId[],
  ended?: NetworkMatchEnded | null,
  duplicate?: DuplicateRoomSummary | null,
): TableSettlementContent => {
  const settlement = snapshot.settlement!
  const viewerTeam = snapshot.state.players[humanId].team
  const winnerLabel = settlement.winnerTeam === viewerTeam ? '我方'
    : settlement.winnerTeam === 'teamA' || settlement.winnerTeam === 'teamB' ? '对方' : '胜方'
  const uniqueReady = new Set(readyIds.filter(id => Boolean(snapshot.state.players[id])))
  const terminal = Boolean(ended || settlement.isGameWon)
  const rotating = settlement.format === 'rotating'
  const independent = settlement.format === 'independent' || rotating
  const individual = Boolean(snapshot.state.matchFormat?.individualRanking)
  const readyText = multiplayer && !terminal ? duplicate ? ` · 八席准备 ${duplicate.slots.filter(s => s.ready).length}/8` : ` · 下一局准备 ${uniqueReady.size}/4` : ''
  const resultText = rotating ? `转蛋${snapshot.state.matchFormat?.rotatingScoring ?? 3}分制 · 个人累计积分`
    : independent ? `${winnerLabel}获胜 · 得 ${settlement.pointsEarned ?? 0} 分` : `${winnerLabel}升 ${settlement.levelUp} 级`
  const terminalPresentation = ended ? projectMatchEndedPresentation(ended, humanId, duplicate) : null
  return {
    title: individual ? '本轮结束' : terminalPresentation?.title ?? title ?? '本局结束',
    summary: individual ? `本桌第 ${settlement.fullRank.indexOf(humanId) + 1} 名 · 获得 ${settlement.playerPoints?.[humanId] ?? 0} 分 · 总排名以赛事中心为准` : terminalPresentation?.detail.replace('\n', ' · ') ?? (settlement.isGameWon ? `${winnerLabel}完成过 A · 本场结束` : resultText),
    footer: `${independent ? `本局打 ${snapshot.state.currentLevel} · 不升级、不进贡` : `胜方升 ${settlement.levelUp} 级`}${readyText}`,
    players: settlement.fullRank.map(id => ({
      name: snapshot.state.players[id].name,
      team: id === humanId ? '我' : snapshot.state.players[id].team === viewerTeam ? '队友' : '对手',
      ready: `${individual ? `本轮得 ${settlement.playerPoints?.[id] ?? 0} 分\n` : rotating ? `本局 ${settlement.playerPoints?.[id] ?? 0} · 累计 ${settlement.playerScores?.[id] ?? 0}\n` : ''}${!multiplayer || terminal ? '本局完成' : uniqueReady.has(id) ? '已准备' : '未准备'}`,
    })),
  }
}
