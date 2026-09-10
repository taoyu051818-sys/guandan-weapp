import { randomBytes } from 'node:crypto'
import { generatedPlayerNickname, generatedPlayerAvatar } from './player-nicknames.js'
import { DUPLICATE_SEATS, occupant, tableOf, localSeat, redSeat, dealDuplicateRound, playDuplicate } from './duplicate-room-model.js'

export const duplicateEvent = (room, detail, now) => ({ eventId: `spectate:${room.matchId}:${++room.sequence}`, matchId: room.matchId,
  roomId: room.roomId, sequence: room.sequence, at: now, roundSequence: Math.max(1, room.completedRounds), ...detail })

export const canStartDuplicate = room => DUPLICATE_SEATS.every(seat => {
  const m = occupant(room, seat); return m && m.ready && (m.bot || m.connectionId)
})

/** Commands mutate only the transaction's isolated draft, never live sockets or platform state. */
export const duplicateAction = (room, member, type, p, { now, random }) => {
  if (member.left) throw new Error('已离开房间')
  const host = member.userId === room.hostUserId
  const waiting = room.phase === 'lobby'
  const slot = p.duplicateSeat
  if (['safeExit', 'leaveRoom'].includes(type)) {
    if (room.pendingStart) throw new Error('平台确认开局中，请稍后再退出')
    if (host && waiting) {
      room.phase = 'closed'; room.endedAt = now
      room.events.push(duplicateEvent(room, { type: 'room-closed', reason: 'host-left' }, now))
    } else if (waiting) {
      room.events.push(duplicateEvent(room, { type: 'seat-left', playerId: member.entrySeat, userId: member.userId, reason: 'left' }, now))
      member.left = true; member.seat = null
    } else if (!waiting && member.seat && room.phase !== 'ended') throw new Error('复式进行中请使用托管，不能释放参赛席位')
    else member.left = true
    member.connectionId = null
    return 'roomLeft'
  }
  if (room.phase === 'closed' || room.phase === 'ended') throw new Error('本场已结束')
  if (room.pendingStart) throw new Error('平台确认开局中')
  if (['setLobbyReady', 'cancelLobbyReady'].includes(type)) {
    if (!waiting || !member.seat) throw new Error('当前不能准备')
    member.ready = type === 'setLobbyReady'; return
  }
  if (['sitDown', 'standUp'].includes(type)) {
    if (!waiting) throw new Error('开始后不能换座')
    if (type === 'sitDown' && (!DUPLICATE_SEATS.includes(slot) || occupant(room, slot))) throw new Error('请选择空座位')
    member.seat = type === 'sitDown' ? slot : null
    member.ready = false; member.watch = null; return
  }
  if (['addBot', 'removeBot', 'fillBots'].includes(type)) {
    if (!waiting || !host) throw new Error('只有房主可在开始前调整机器人')
    const slots = type === 'fillBots' ? DUPLICATE_SEATS.filter(s => !occupant(room, s)) : [slot]
    if (slots.some(s => !DUPLICATE_SEATS.includes(s))) throw new Error('座位无效')
    for (const seat of slots) {
      const old = occupant(room, seat)
      if (type === 'removeBot') { if (!old?.bot) throw new Error('只能移除机器人'); room.members.splice(room.members.indexOf(old), 1) }
      else {
        if (old) throw new Error('该座位已有玩家')
        const userId = `dupbot_${randomBytes(12).toString('hex')}`
        let attempt = 0, name = generatedPlayerNickname(userId)
        while (room.members.some(m => m.name === name)) name = generatedPlayerNickname(userId, ++attempt)
        room.members.push({ userId, name, avatarUrl: generatedPlayerAvatar(name), seat,
          bot: true, ready: true, trustee: true, connectionId: null })
      }
    }
    return
  }
  if (type === 'watchTable') {
    if (waiting || !['A', 'B', null].includes(p.table)) throw new Error('观战牌桌无效')
    if (member.seat && p.table && p.table !== tableOf(member.seat) && room.tables[tableOf(member.seat)].state.phase !== 'settled') throw new Error('须等本桌结束后才能查看另一桌')
    member.watch = p.table; return
  }
  if (['readyNextRound', 'roundReady', 'nextRound', 'ready', 'cancelRoundReady', 'cancelReady'].includes(type)) {
    if (!member.seat || waiting || room.tables[tableOf(member.seat)].state.phase !== 'settled') throw new Error('本桌尚未结束')
    member.ready = !['cancelReady', 'cancelRoundReady'].includes(type)
    if (room.roundTallied && canStartDuplicate(room)) dealDuplicateRound(room, random, now)
    return
  }
  if (['setTrustee', 'cancelTrustee'].includes(type)) {
    if (waiting || !member.seat || member.watch) throw new Error('当前不能设置托管')
    member.trustee = type === 'setTrustee'; return
  }
  if (['play', 'pass'].includes(type)) return playDuplicate(room, member, type, p, now)
  throw new Error('复式当前不支持此操作')
}

export const duplicateEndEvent = (room, now) => {
  if (room.phase !== 'ended' || room.endReported) return
  room.endReported = true
  const scores = { teamA: room.scores.red, teamB: room.scores.blue }
  room.events.push(duplicateEvent(room, { type: 'match-ended', reason: room.endReason || 'round-limit', scores,
    roundsPlayed: room.completedRounds, endedAt: room.endedAt || now,
    winnerTeam: room.endReason === 'time-limit' || scores.teamA === scores.teamB ? null : scores.teamA > scores.teamB ? 'teamA' : 'teamB' }, now))
}
