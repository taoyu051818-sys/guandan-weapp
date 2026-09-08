const platformCollections = [
  'userByAccountId',
  'userStats', 'playerRatings', 'matchHistoryByUser', 'matchQueues', 'tournamentStandings', 'tournamentRoundResults',
  'replays', 'spectatorFeeds', 'seasons', 'seasonProgress', 'taskDefinitions',
  'taskProgress', 'taskClaimIdempotency', 'dailyStats', 'merchants', 'merchantByOwner',
  'merchantStores', 'merchantEmployees', 'merchantPointGrants', 'merchantIdempotency',
  'spectatorEventReceipts', 'tournamentRuns', 'tournamentPlayerRoundResults', 'friendRoomEntryAttempts',
]
export const ensureCollections = (state) => {
  platformCollections.forEach(key => { state[key] ||= {} })
  return state
}
