import type { PlayerId } from '../core/generated'
import type { GameSnapshot } from '../game/GameManager'
import type { TableSettlementContent } from '../ui/TableSettlementView'
import type { NetworkMatchEnded } from '../network/LobbyModels'
import { projectMatchEndedPresentation } from './MatchEndedPresentation'

export const projectSettlementContent = (
  snapshot: GameSnapshot, humanId: PlayerId, title: string | null,
  multiplayer: boolean, readyIds: readonly PlayerId[],
  ended?: NetworkMatchEnded | null,
): TableSettlementContent => {
  const settlement = snapshot.settlement!
  const viewerTeam = snapshot.state.players[humanId].team
  const winnerLabel = settlement.winnerTeam === viewerTeam ? '我方'
    : settlement.winnerTeam === 'teamA' || settlement.winnerTeam === 'teamB' ? '对方' : '胜方'
  const uniqueReady = new Set(readyIds.filter(id => Boolean(snapshot.state.players[id])))
  const terminal = Boolean(ended || settlement.isGameWon)
  const independent = settlement.format === 'independent'
  const readyText = multiplayer && !terminal ? ` · 下一局准备 ${uniqueReady.size}/4` : ''
  const resultText = independent ? `${winnerLabel}获胜 · 得 ${settlement.pointsEarned ?? 0} 分` : `${winnerLabel}升 ${settlement.levelUp} 级`
  const terminalPresentation = ended ? projectMatchEndedPresentation(ended, humanId) : null
  return {
    title: terminalPresentation?.title ?? title ?? '本局结束',
    summary: terminalPresentation?.detail.replace('\n', ' · ') ?? (settlement.isGameWon ? `${winnerLabel}完成过 A · 本场结束` : resultText),
    footer: `${independent ? `本局打 ${snapshot.state.currentLevel} · 不升级、不进贡` : `胜方升 ${settlement.levelUp} 级`}${readyText}`,
    players: settlement.fullRank.map(id => ({
      name: snapshot.state.players[id].name,
      team: id === humanId ? '我' : snapshot.state.players[id].team === viewerTeam ? '队友' : '对手',
      ready: !multiplayer || terminal ? '本局完成' : uniqueReady.has(id) ? '已准备' : '未准备',
    })),
  }
}
