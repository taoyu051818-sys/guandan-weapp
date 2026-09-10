import type { PlayerId } from '../core/generated'
import type { NetworkMatchEnded } from '../network/LobbyController'
import type { DuplicateRoomSummary } from '../network/DuplicateRoomModel'
import { duplicateFinalPresentation } from './DuplicateTablePresentation'

export type MatchEndedPresentation = Readonly<{ title: string, detail: string }>

export const projectMatchEndedPresentation = (
  ended: NetworkMatchEnded,
  viewerId: PlayerId,
  duplicate?: DuplicateRoomSummary | null,
): MatchEndedPresentation => {
  if (duplicate) return duplicateFinalPresentation(duplicate)
  if (ended.playerScores) {
    const scores = ended.playerScores
    const top = Math.max(...Object.values(scores))
    const leaders = Object.values(scores).filter(score => score === top).length
    const outcome = scores[viewerId] === top ? leaders > 1 ? '并列第一' : '个人第一' : '积分结算'
    return { title: `本场结束 · ${outcome}`, detail: `已完成 ${ended.roundsPlayed} 局\n我的积分 ${scores[viewerId]} · 最高积分 ${top}` }
  }
  const viewerTeam = viewerId === 'p1' || viewerId === 'p3' ? 'teamA' : 'teamB'
  const opponentTeam = viewerTeam === 'teamA' ? 'teamB' : 'teamA'
  const passedA = ended.reason === 'passed-a'
  const viewerWon = ended.winnerTeam === viewerTeam
  const outcome = passedA
    ? ended.winnerTeam === null ? 'A 关结算' : viewerWon ? '通过 A 关' : 'A 关失败'
    : ended.winnerTeam === null ? '平局' : viewerWon ? '胜利' : '失利'
  const progress = passedA
    ? ended.winnerTeam === null
      ? `A 关终局 · 已完成 ${ended.roundsPlayed} 局`
      : `${viewerWon ? '我方' : '对方'}通过 A 关 · 已完成 ${ended.roundsPlayed} 局`
    : ended.reason === 'time-limit'
      ? `房间时限已到 · 已完成 ${ended.roundsPlayed} 局`
      : ended.reason === 'single-round' ? '随机级牌 · 单局结算' : `已完成 ${ended.configuredRounds} 局`
  return {
    title: `${ended.reason === 'single-round' ? '本局结束' : '本场结束'} · ${outcome}`,
    detail: `${progress}\n我方 ${ended.scores[viewerTeam]} · 对方 ${ended.scores[opponentTeam]}`,
  }
}
