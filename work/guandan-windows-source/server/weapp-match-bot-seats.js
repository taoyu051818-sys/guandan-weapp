const playerIds = ['p1', 'p2', 'p3', 'p4']

export const botUserIdsBySeatFromClaims = claims => (
  claims?.roomKind === 'match' && claims.botUserIdsBySeat
    ? Object.fromEntries(playerIds.filter(id => typeof claims.botUserIdsBySeat[id] === 'string').map(id => [id, claims.botUserIdsBySeat[id]]))
    : {}
)

export const botSeatBindingsMatch = (room, claims) => {
  const claimed = botUserIdsBySeatFromClaims(claims)
  const stored = Object.fromEntries(playerIds.filter(id => typeof room?.botUserIdsBySeat?.[id] === 'string').map(id => [id, room.botUserIdsBySeat[id]]))
  return JSON.stringify(claimed) === JSON.stringify(stored)
}

/** Applies only server-verified ticket metadata; bot seats never own a socket or resume token. */
export const ensureMatchBotMetadata = room => {
  const supplied = Array.isArray(room.botPlayerIds) ? room.botPlayerIds : []
  room.botUserIdsBySeat ||= {}
  const requiresSignedBindings = Boolean(room.ticketBound && room.entryKind === 'match')
  room.botPlayerIds = playerIds.slice(1).filter(id => (
    supplied.includes(id) && (!requiresSignedBindings || typeof room.botUserIdsBySeat[id] === 'string')
  ))
  room.botPlayerIds.forEach(id => {
    if (room.seats) room.seats[id] = null
    if (room.resumeTokens) room.resumeTokens[id] = null
    if (room.userIdsBySeat) room.userIdsBySeat[id] = requiresSignedBindings ? room.botUserIdsBySeat[id] : null
    if (room.ticketJtisBySeat) room.ticketJtisBySeat[id] = null
    if (room.ticketExpiresAtBySeat) room.ticketExpiresAtBySeat[id] = null
  })
  return room.botPlayerIds
}
