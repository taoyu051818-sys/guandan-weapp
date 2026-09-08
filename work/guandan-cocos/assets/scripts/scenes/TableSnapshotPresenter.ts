import type { PlayerId, Rank, Team } from '../core/generated'

export type TablePlayerTeams = Readonly<Record<PlayerId, Readonly<{ team: Team }>>>

export type TableViewerProjection = Readonly<{
  viewerTeam: Team
  opponentTeam: Team
  viewerLevel: Rank
  opponentLevel: Rank
  levelLabel: string
  settlementWon: boolean | null
  settlementTitle: string | null
}>

/** Other seats disclose their remaining count only at ten cards or fewer. */
export const projectTableSeatStatus = (count: number, isSelf: boolean, finishPlace = 0): string => {
  if (finishPlace > 0) return ['头游', '二游', '三游', '末游'][finishPlace - 1] ?? ''
  if (!Number.isInteger(count) || count < 0) return ''
  return isSelf || (count > 0 && count <= 10) ? `剩${count}张` : ''
}

/** Keeps every team-relative table label anchored to the active viewer's seat. */
export const projectTableViewer = (
  players: TablePlayerTeams,
  viewerId: PlayerId,
  teamLevels: Readonly<Record<Team, Rank>>,
  winnerTeam: Team | null = null,
): TableViewerProjection => {
  const viewerTeam = players[viewerId].team
  const opponentTeam: Team = viewerTeam === 'teamA' ? 'teamB' : 'teamA'
  const settlementWon = winnerTeam === null ? null : winnerTeam === viewerTeam
  return {
    viewerTeam,
    opponentTeam,
    viewerLevel: teamLevels[viewerTeam],
    opponentLevel: teamLevels[opponentTeam],
    levelLabel: `我方 ${String(teamLevels[viewerTeam])} 级    对方 ${String(teamLevels[opponentTeam])} 级`,
    settlementWon,
    settlementTitle: settlementWon === null ? null : settlementWon ? '本局胜利' : '本局失利',
  }
}
