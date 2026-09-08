const playerIds = ['p1', 'p2', 'p3', 'p4']

const clone = (value) => JSON.parse(JSON.stringify(value))

export const stateForViewer = (state, viewerId) => {
  const projected = clone(state)
  const viewer = state.players[viewerId]
  const teammates = playerIds.filter(id => id !== viewerId && viewer &&
    ['teamA', 'teamB'].includes(viewer.team) && state.players[id].team === viewer.team)
  const teammateId = teammates.length === 1 ? teammates[0] : null
  // Finished players may follow their own living teammate, never an opponent.
  // Derived from authoritative state, not a client-selected viewpoint or request flag.
  const watchedId = state.phase === 'playing' && viewer?.hand.length === 0 &&
    state.finishedPlayers?.includes(viewerId) && teammateId &&
    !state.finishedPlayers.includes(teammateId) && state.players[teammateId].hand.length > 0
    ? teammateId : null
  playerIds.filter(id => id !== viewerId && id !== watchedId).forEach(id => {
    projected.players[id].hand = projected.players[id].hand.map((_, index) => ({ id: `hidden-${id}-${index}` }))
  })
  if (projected.tribute?.exchanges) {
    projected.tribute.exchanges = projected.tribute.exchanges.map(exchange => ({
      ...exchange,
      tributeCardId: projected.tribute.status === 'selecting_tribute' && exchange.from !== viewerId
        ? null
        : exchange.tributeCardId,
      returnCardId: projected.tribute.status === 'selecting_return' && exchange.to !== viewerId
        ? null
        : exchange.returnCardId,
    }))
  }
  return projected
}

const cardById = (state, cardId) => {
  if (!cardId) return null
  for (const playerId of playerIds) {
    const card = state.players[playerId].hand.find(candidate => candidate.id === cardId)
    if (card) return card
  }
  return null
}

/** Compatibility projection for the legacy Cocos tribute UI. */
export const tributeForViewer = (state, viewerId) => {
  const tribute = state?.tribute
  if (!tribute) return null
  if (tribute.exchanges) {
    const phase = tribute.status === 'selecting_tribute'
      ? 'tributing'
      : tribute.status === 'selecting_return'
        ? 'returning'
        : 'done'
    return {
      isDoubleDown: tribute.mode === 'double',
      isAntiTribute: tribute.status === 'resisted',
      phase,
      actions: tribute.exchanges.map(exchange => ({
        from: exchange.from,
        to: exchange.to,
        card: phase === 'tributing' && exchange.from !== viewerId
          ? null
          : cardById(state, exchange.tributeCardId),
        returnCard: phase === 'returning' && exchange.to !== viewerId
          ? null
          : cardById(state, exchange.returnCardId),
      })),
    }
  }

  // Persisted legacy rooms can still pass a TributeState during one-time migration.
  return {
    ...tribute,
    actions: tribute.actions.map(action => ({
      ...action,
      card: tribute.phase === 'tributing' && action.from !== viewerId ? null : action.card,
      returnCard: tribute.phase === 'returning' && action.to !== viewerId ? null : action.returnCard,
    })),
  }
}
