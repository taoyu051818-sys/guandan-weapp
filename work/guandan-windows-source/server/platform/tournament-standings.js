/** Pure ranking projection. Only the result transaction persists rank/qualification. */
export const rankTournamentEntries = (state, tournamentId) => {
  const entries = Object.values(state.tournamentStandings).filter(item => item.tournamentId === tournamentId)
  const pointsByUser = new Map(entries.map(item => [item.userId, item.points]))
  const standings = entries.map(standing => ({
    ...standing,
    opponents: [...standing.opponents],
    opponentPoints: standing.opponents.reduce((sum, id) => sum + (pointsByUser.get(id) || 0), 0),
  }))
  standings.sort((left, right) => (
    right.points - left.points ||
    right.opponentPoints - left.opponentPoints ||
    right.wins - left.wins ||
    right.firstPlaces - left.firstPlaces ||
    left.userId.localeCompare(right.userId)
  ))
  standings.forEach((standing, index) => { standing.rank = index + 1 })
  return standings
}

export const qualificationStatus = (tournament, standing, index) => {
  if (tournament.status !== 'finished' || standing.played < Math.max(1, Number(tournament.roundsTotal) || 1)) return 'pending'
  return index < Number(tournament.advanceCount || 0) ? 'qualified' : 'eliminated'
}

export const publicTournamentStanding = (state, tournament, standing, index) => {
  const qualification = qualificationStatus(tournament, standing, index)
  return {
    userId: standing.userId,
    displayName: state.users[standing.userId]?.displayName || '牌友',
    played: standing.played,
    wins: standing.wins,
    firstPlaces: standing.firstPlaces,
    points: standing.points,
    opponentPoints: standing.opponentPoints,
    rank: index + 1,
    advanced: qualification === 'qualified',
    qualificationStatus: qualification,
  }
}
