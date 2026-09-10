import { randomBytes } from 'node:crypto'

export const canConfigureRoomBots = room => Boolean(room && (!room.ticketBound || room.entryKind === 'friend'))

/** Server-owned identities; never issue a login, wallet, socket or recovery token to a bot. */
export const setFriendBotIdentity = (room, seat, adding) => {
  room.botUserIdsBySeat ||= {}
  if (adding && room.ticketBound && room.entryKind === 'friend') {
    room.botUserIdsBySeat[seat] = `friendbot_${randomBytes(12).toString('hex')}`
    room.userIdsBySeat[seat] = room.botUserIdsBySeat[seat]
  } else if (!adding) {
    delete room.botUserIdsBySeat[seat]
    room.userIdsBySeat[seat] = null
  }
}
