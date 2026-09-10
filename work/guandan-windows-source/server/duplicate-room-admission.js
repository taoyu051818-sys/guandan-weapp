import { randomBytes, timingSafeEqual } from 'node:crypto'
import { normalizeFriendRoomSettings } from './friend-room-settings.js'
import { DUPLICATE_SEATS, occupant } from './duplicate-room-model.js'

export const newDuplicateToken = () => randomBytes(32).toString('hex')
const sameToken = (a, b) => typeof a === 'string' && typeof b === 'string' && a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b))
export const duplicateEntry = (room, connection, message, verifier, now) => {
  const p = message.payload || {}
  if (message.type === 'rejoinRoom') {
    if (!room || room.phase === 'closed') throw new Error('复式房间已关闭')
    const m = room.members.find(m => !m.left && !m.bot && sameToken(m.token, p.resumeToken))
    if (!m || m.connectionId && m.connectionId !== connection.id) throw new Error('重连凭证无效或该账号已在线')
    if (message.requestId <= Math.max(0, ...Object.keys(m.receipts || {}).map(Number))) m.receipts = {}
    m.connectionId = connection.id; return { room, member: m }
  }
  const { claims } = verifier.inspectWithConsumptionStatus(p.gameTicket, { roomId: String(p.roomId || '') })
  if (!claims || claims.roomKind !== 'friend' || claims.roomSettings?.format !== 'duplicate') throw new Error('复式须使用有效的签名好友房票据')
  if (p.entryAttemptId !== claims.entryAttemptId) throw new Error('入桌请求与票据不一致')
  const settings = normalizeFriendRoomSettings(claims.roomSettings, { strict: true })
  if (!room) {
    if (claims.purpose === 'rejoin' || claims.roomExpiresAt <= now) throw new Error('可恢复的复式房间不存在')
    room = { roomId: String(claims.roomId), matchId: claims.matchId, settings, hostUserId: claims.hostUserId,
      expiresAt: claims.roomExpiresAt, version: 0, sequence: 0, phase: 'lobby', members: [], tables: null,
      scores: { red: 0, blue: 0 }, completedRounds: 0, history: [], events: [], usedTickets: [] }
  }
  if (room.matchId !== claims.matchId || room.hostUserId !== claims.hostUserId || room.expiresAt !== claims.roomExpiresAt
    || JSON.stringify(room.settings) !== JSON.stringify(settings) || room.phase === 'closed') throw new Error('票据与复式房间不匹配')
  let m = room.members.find(m => m.userId === claims.sub && !m.left)
  if (room.events.some(e => e.type === 'seat-left' && e.userId === claims.sub)) throw new Error('席位释放确认中，请稍后重试')
  if (m?.connectionId && m.connectionId !== connection.id) throw new Error('该账号已在另一连接中')
  if (room.usedTickets.includes(claims.jti) && (!m || m.jti !== claims.jti)) throw new Error('票据已撤销')
  if (!m) {
    if (room.usedTickets.includes(claims.jti) || room.pendingStart || room.phase === 'ended') throw new Error('不能重复加入已结束或正在开局的房间')
    if (room.members.filter(m => !m.left && !m.bot).length >= 12) throw new Error('观战人数已满')
    if (room.phase !== 'lobby' && claims.seat !== 'observer') throw new Error('对局已开始，只能恢复原身份')
    const seat = claims.seat === 'observer' ? null : claims.seat
    if (seat && !DUPLICATE_SEATS.includes(seat)) throw new Error('复式席位无效')
    // Tickets reserve admission, while the coordinator owns live rearrangement.
    const free = seat && (occupant(room, seat) ? DUPLICATE_SEATS.find(s => !occupant(room, s)) : seat)
    if (seat && !free) throw new Error('八个座位已满，请房主移除一个机器人后重试')
    if (!seat && room.settings.spectator === 'off') throw new Error('本房间未允许观战')
    m = { userId: claims.sub, seat: free || null, entrySeat: claims.seat, token: newDuplicateToken(), ready: false, bot: false,
      name: typeof p.hostName === 'string' && p.hostName.trim() ? p.hostName.trim().slice(0, 16) : '牌友', receipts: {} }
    room.members.push(m)
  }
  if (m.jti && m.jti !== claims.jti) { m.token = newDuplicateToken(); m.receipts = {} }
  m.jti = claims.jti; m.connectionId = connection.id
  if (!room.usedTickets.includes(claims.jti)) room.usedTickets.push(claims.jti)
  if (room.usedTickets.length > 4096) throw new Error('本房间凭证数量已达上限')
  return { room, member: m, recovery: claims.purpose === 'rejoin' }
}
