import type { PlayerId, Rank, Team, TributeState } from '../core/generated'

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

/** Creates stable identities for tribute effects shared by recovery and live rendering. */
export const projectTributeEffectTokens = (tribute: TributeState | null): Set<string> => {
  const tokens = new Set<string>()
  if (!tribute) return tokens
  if (tribute.isAntiTribute) tokens.add('anti-tribute')
  tribute.actions.forEach(action => {
    if (action.card) tokens.add(`give:${action.from}:${action.to}:${action.card.id}`)
    if (action.returnCard) tokens.add(`return:${action.to}:${action.from}:${action.returnCard.id}`)
  })
  return tokens
}
