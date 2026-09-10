import { conflict } from './errors.js'

/** Game-server-signed roster. Eight slots are global; each child table still has four local IDs. */
export const applyDuplicateRoster = (match, roster) => {
  const seats = Array.from({ length: 8 }, (_, i) => `p${i + 1}`)
  if (!roster || Object.keys(roster).length !== 8 || new Set(Object.values(roster)).size !== 8) throw conflict('INVALID_DUPLICATE_ROSTER', '复式开局须有八个不同身份')
  const active = match.participants.filter(p => ['matching', 'matched', 'playing'].includes(p.status))
  for (const seat of seats) {
    const userId = roster[seat]
    if (typeof userId !== 'string') throw conflict('INVALID_DUPLICATE_ROSTER', '复式席位不完整')
    if (!active.some(p => p.userId === userId) && !/^dupbot_[a-f0-9]{24}$/.test(userId)) throw conflict('INVALID_DUPLICATE_ROSTER', '存在未经授权的参赛者')
  }
  if (match.status === 'playing') {
    if (!seats.every(seat => active.find(p => p.seat === seat)?.userId === roster[seat])) throw conflict('DUPLICATE_ROSTER_LOCKED', '复式开始后不能换座')
    return
  }
  if (!['matching', 'matched'].includes(match.status)) throw conflict('DUPLICATE_ROOM_CLOSED', '复式房间已结束')
  for (const seat of seats) if (!active.some(p => p.userId === roster[seat])) {
    const bot = { userId: roster[seat], seat, isBot: true, status: 'matched' }
    active.push(bot); match.participants.push(bot)
  }
  for (const p of active) { p.seat = seats.find(seat => roster[seat] === p.userId) || 'observer'; p.status = 'matched' }
  match.status = 'matched'
}
