/** Recovery publishes current authoritative state, never replays chat or old animations. */
export const createCommandPublication = ({
  publishRoomMembers, publishLobbyReady, publishState, publishTribute,
  publishRoundEnded, publishRoundReady, publishTrustees, publishTurnStatus, publishDissolveVote,
}) => room => {
  publishRoomMembers(room)
  if (!room.state) { publishLobbyReady(room); return }
  if (room.state.phase === 'tribute') publishTribute(room)
  else publishState(room)
  publishTrustees(room)
  publishTurnStatus(room)
  publishDissolveVote(room)
  if (room.roundResult) {
    publishRoundEnded(room, room.roundResult)
    publishRoundReady(room)
  }
}
