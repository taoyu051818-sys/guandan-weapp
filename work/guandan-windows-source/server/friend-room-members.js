/** Friend-room identity is independent of a playing seat. Never use the view target for authorization. */
export const FRIEND_SEATS = ['p1', 'p2', 'p3', 'p4']
export const supportsRoomObservers = room => room?.entryKind === 'friend' && ['live', 'delay-15', 'delay-30', 'delay-60', 'delayed-round'].includes(room.roomSettings?.spectator)
export const roomMember = (room, connectionId) => connectionId && room?.friendMembers?.find(member => member.connectionId === connectionId) || null
export const memberIsHost = (room, connectionId) => {
  const member = roomMember(room, connectionId)
  return Boolean(connectionId && (member ? member.userId === room.friendHostUserId : room?.seats?.p1 === connectionId))
}
export const memberForToken = (room, token, sameToken) => room?.friendMembers?.find(member => sameToken(member.resumeToken, token)) || null

export const registerRoomMember = (room, seat, { name = '牌友', hostUserId } = {}) => {
  if (!supportsRoomObservers(room)) return null
  room.friendMembers ||= []
  const userId = room.userIdsBySeat[seat] || `local:${room.resumeTokens[seat]}`
  let member = room.friendMembers.find(item => item.userId === userId)
  if (!member) {
    member = { userId, seat, entrySeat: seat, name, viewPlayerId: seat, resumeToken: room.resumeTokens[seat] }
    room.friendMembers.push(member)
  }
  Object.assign(member, { connectionId: room.seats[seat], resumeToken: room.resumeTokens[seat], jti: room.ticketJtisBySeat[seat], exp: room.ticketExpiresAtBySeat[seat] })
  room.friendHostUserId ||= hostUserId || (seat === 'p1' ? userId : null)
  return member
}

export const clearMemberSeat = (room, member) => {
  const seat = member.seat
  if (!seat) return
  for (const field of ['seats', 'resumeTokens', 'userIdsBySeat', 'ticketJtisBySeat', 'ticketExpiresAtBySeat']) room[field][seat] = null
  room.lobbyReady[seat] = false
  member.seat = null
}

export const moveRoomMember = (room, member, seat) => {
  if (!supportsRoomObservers(room)) throw new Error('本房间未允许观战')
  if (room.state || room.pendingGameStartEvent) throw new Error('开局后不能站起或重新入座，请在下一场调整座位')
  if (seat !== null && !FRIEND_SEATS.includes(seat)) throw new Error('座位无效')
  if (seat === member.seat) return
  if (seat && (room.resumeTokens[seat] || room.botPlayerIds?.includes(seat))) throw new Error('该座位已有人，请选择空座位')
  clearMemberSeat(room, member)
  member.seat = seat
  if (seat) {
    room.seats[seat] = member.connectionId
    room.resumeTokens[seat] = member.resumeToken
    room.userIdsBySeat[seat] = member.userId.startsWith('local:') ? null : member.userId
    room.ticketJtisBySeat[seat] = member.jti || null
    room.ticketExpiresAtBySeat[seat] = member.exp || null
    room.lobbyReady[seat] = false
    member.viewPlayerId = seat
  }
  room.version += 1
}

export const friendMemberMetadata = (room, member) => ({
  roomRole: member?.seat ? 'player' : 'observer',
  seatedPlayerId: member?.seat || null,
  viewPlayerId: member?.seat || member?.viewPlayerId || 'p1',
  isRoomHost: Boolean(member && member.userId === room.friendHostUserId),
  hostPlayerId: room.friendMembers?.find(item => item.userId === room.friendHostUserId)?.seat || null,
  observers: (room.friendMembers || []).filter(item => !item.seat).map(item => ({ name: item.name, isHost: item.userId === room.friendHostUserId })),
})
