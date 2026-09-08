import { conflict } from './errors.js'

const seats = ['p1', 'p2', 'p3', 'p4']
/** Signed game-start commits actual seats after pre-game rearrangement. Observers never enter result accounting. */
export const applyFriendRoomRoster = (match, roster) => {
  if (roster === undefined) return
  if (match.kind !== 'friend-room' || match.roomSettings?.spectator === 'off') throw conflict('INVALID_FRIEND_ROSTER', '此房间不支持调整席位')
  if (!roster || typeof roster !== 'object' || Array.isArray(roster) || Object.keys(roster).length !== 4 || new Set(Object.values(roster)).size !== 4) throw conflict('INVALID_FRIEND_ROSTER', '开局须有四名不同玩家')
  const members = match.participants.filter(item => ['matching', 'matched', 'playing'].includes(item.status))
  if (!seats.every(seat => typeof roster[seat] === 'string' && members.some(item => item.userId === roster[seat]))) throw conflict('INVALID_FRIEND_ROSTER', '开局成员不在授权邀请名单中')
  if (match.status === 'playing') {
    if (!seats.every(seat => members.find(item => item.seat === seat)?.userId === roster[seat])) throw conflict('FRIEND_ROSTER_LOCKED', '开局后不能修改参与席位')
    return
  }
  if (!['matching', 'matched'].includes(match.status)) throw conflict('FRIEND_ROSTER_CLOSED', '该房间已结束')
  for (const member of members) {
    member.seat = seats.find(seat => roster[seat] === member.userId) || 'observer'
    member.status = 'matched'
  }
  match.status = 'matched'
}
