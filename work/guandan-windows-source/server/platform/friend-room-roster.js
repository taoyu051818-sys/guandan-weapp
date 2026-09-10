import { conflict } from './errors.js'
import { applyDuplicateRoster } from './duplicate-room-roster.js'

const seats = ['p1', 'p2', 'p3', 'p4']
/** Signed game-start commits actual seats after pre-game rearrangement. Observers never enter result accounting. */
export const applyFriendRoomRoster = (match, roster) => {
  if (roster === undefined) return
  if (match.kind === 'friend-room' && match.roomSettings?.format === 'duplicate') return applyDuplicateRoster(match, roster)
  if (match.kind !== 'friend-room') throw conflict('INVALID_FRIEND_ROSTER', '此房间不支持调整席位')
  if (!roster || typeof roster !== 'object' || Array.isArray(roster) || Object.keys(roster).length !== 4 || new Set(Object.values(roster)).size !== 4) throw conflict('INVALID_FRIEND_ROSTER', '开局须有四名不同玩家')
  const members = match.participants.filter(item => ['matching', 'matched', 'playing'].includes(item.status))
  const isBotId = id => typeof id === 'string' && /^friendbot_[a-f0-9]{24}$/.test(id)
  if (!seats.every(seat => typeof roster[seat] === 'string' && (members.some(item => item.userId === roster[seat]) || isBotId(roster[seat])))) throw conflict('INVALID_FRIEND_ROSTER', '开局成员不在授权邀请名单中')
  if (match.roomSettings?.spectator === 'off' && members.some(item => !item.isBot && roster[item.seat] !== item.userId)) {
    throw conflict('INVALID_FRIEND_ROSTER', '本房间未允许换座，不能覆盖已预约的玩家席位')
  }
  if (match.status === 'playing') {
    if (!seats.every(seat => members.find(item => item.seat === seat)?.userId === roster[seat])) throw conflict('FRIEND_ROSTER_LOCKED', '开局后不能修改参与席位')
    return
  }
  if (!['matching', 'matched'].includes(match.status)) throw conflict('FRIEND_ROSTER_CLOSED', '该房间已结束')
  for (const seat of seats) if (!members.some(item => item.userId === roster[seat])) {
    const bot = { userId: roster[seat], seat, isBot: true, status: 'matched' }
    members.push(bot)
    match.participants.push(bot)
  }
  for (const member of members) {
    member.seat = seats.find(seat => roster[seat] === member.userId) || 'observer'
    member.status = 'matched'
  }
  match.status = 'matched'
}
