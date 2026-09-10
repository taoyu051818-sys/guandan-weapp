import { prepareDuplicateAutomaticPlay } from './duplicate-auto-policy.js'
import { JsonRoomStateStore } from './room-state-store.js'
import { duplicateEntry } from './duplicate-room-admission.js'
import { duplicateAction, duplicateEvent, duplicateEndEvent, canStartDuplicate } from './duplicate-room-actions.js'
import { duplicateSnapshot, captureDuplicateObservers } from './duplicate-room-projection.js'
import { DUPLICATE_SEATS, occupant, globalSeat, tableOf, localSeat, dealDuplicateRound, playDuplicate } from './duplicate-room-model.js'
const ENTRY = new Set(['createRoom', 'joinRoom', 'rejoinRoom'])

/** Single owner for eight-seat admission and two independent tables, isolated from normal rooms. */
export class DuplicateRoomRuntime {
  constructor ({ connections, send, verifier, reporter, filePath, random, maxRooms = 64, now = Date.now }) {
    Object.assign(this, { connections, send, verifier, reporter, random, now, maxRooms })
    this.store = new JsonRoomStateStore({ filePath }); this.rooms = new Map(this.store.load().rooms.map(r => [r.roomId, r]))
    this.queue = Promise.resolve(); this.delivering = new Set(); this.disposed = false
    for (const r of this.rooms.values()) r.members.forEach(m => { m.connectionId = null })
    this.timer = setInterval(() => { void this.serial(() => this.tick()).catch(e => console.warn('Duplicate tick:', e.message)) }, 100)
    this.timer.unref?.()
  }
  serial (fn) { const task = this.queue.then(fn); this.queue = task.catch(() => {}); return task }
  owns (connection, message) {
    if (connection.duplicateRoomId || this.rooms.has(String(message?.payload?.roomId))) return true
    if (ENTRY.has(message?.type) && message.payload?.roomSettings?.format === 'duplicate') return true
    if (!ENTRY.has(message?.type) || !message?.payload?.gameTicket) return false
    try { return this.verifier.inspectWithConsumptionStatus(message.payload.gameTicket).claims?.roomSettings?.format === 'duplicate' } catch { return false }
  }
  async commit (draft) {
    const rooms = new Map(this.rooms); rooms.set(draft.roomId, draft)
    const stored = [...rooms.values()].map(r => ({ ...r, members: r.members.map(m => ({ ...m, connectionId: null })) }))
    await this.store.save({ rooms: stored, acceptedActions: [] })
    this.rooms.set(draft.roomId, structuredClone(draft))
  }
  async handle (connection, message) {
    return this.serial(async () => {
      const { type, requestId } = message
      const p = message.payload || {}
      const reply = (t, body) => this.send(connection, t, { requestId, ...body })
      try {
        if (!Number.isSafeInteger(requestId) || requestId < 1) throw new Error('请求编号无效')
        const roomId = String(p.roomId || connection.duplicateRoomId || '')
        if (connection.roomId && connection.roomId !== roomId) throw new Error('请先离开当前牌局')
        const original = this.rooms.get(roomId)
        let room = original && structuredClone(original)
        let member, recovery
        if (ENTRY.has(type)) {
          if (!room && this.rooms.size >= this.maxRooms) throw new Error('复式房间已满，请稍后重试')
          ;({ room, member, recovery } = duplicateEntry(room, connection, message, this.verifier, this.now()))
          room.version++; await this.commit(room)
          connection.duplicateRoomId = roomId; connection.roomId = roomId
          reply(recovery || type === 'rejoinRoom' ? 'roomRejoined' : type === 'createRoom' ? 'roomCreated' : 'roomJoined', {
            ...duplicateSnapshot(room, member, this.now()), resumeToken: member.token })
          this.publish(room); return
        }
        member = room?.members.find(m => m.connectionId === connection.id && !m.left)
        if (!member || connection.duplicateRoomId !== roomId) throw new Error('未授权的复式操作')
        if (type === 'ping') { reply('pong', {}); return }
        const fingerprint = JSON.stringify([type, p])
        const receipt = member.receipts?.[requestId]
        if (receipt) {
          if (receipt.fingerprint !== fingerprint) throw new Error('相同请求编号不能提交不同动作')
          reply(receipt.type, receipt.body); this.publish(room); return
        }
        let responseType = 'actionAccepted'
        if (type === 'startGame') {
          if (room.phase !== 'lobby' || member.userId !== room.hostUserId || !canStartDuplicate(room)) throw new Error('需八席到齐并全部准备，由房主开始')
          room.pendingStart ||= duplicateEvent(room, { type: 'game-start', roundSequence: 1,
            friendRoster: Object.fromEntries(DUPLICATE_SEATS.map(s => [s, occupant(room, s).userId])) }, this.now())
          await this.commit(room)
          this.publish(room)
          await this.finishStart(room)
        } else responseType = duplicateAction(room, member, type, p, { now: this.now(), random: this.random }) || responseType
        if (room.phase === 'playing' && room.roundTallied && canStartDuplicate(room)) dealDuplicateRound(room, this.random, this.now())
        room.version++; duplicateEndEvent(room, this.now()); captureDuplicateObservers(room, this.now())
        const body = { roomId, version: room.version, gameVersion: duplicateSnapshot(room, member, this.now()).gameVersion, requestType: type }
        member.receipts ||= {}; member.receipts[requestId] = { fingerprint, type: responseType, body }
        const keys = Object.keys(member.receipts); if (keys.length > 256) delete member.receipts[keys[0]]
        await this.commit(room)
        reply(responseType, body)
        if (responseType === 'roomLeft') { connection.roomId = null; connection.duplicateRoomId = null }
        this.publish(room); this.flush(room)
      } catch (error) { reply('error', { message: error.message || '复式操作失败' }) }
    })
  }
  async finishStart (room) {
    if (this.reporter.configured) await this.reporter.claimStart(room.pendingStart)
    else if (process.env.NODE_ENV !== 'test') throw new Error('复式开局平台回调未配置')
    room.startedAt = room.pendingStart.at; room.pendingStart = null
    room.totalDeadlineAt = room.settings.totalTimeMinutes ? room.startedAt + room.settings.totalTimeMinutes * 60000 : null
    dealDuplicateRound(room, this.random, this.now())
  }
  publish (room) {
    for (const m of room.members) {
      const connection = this.connections.get(m.connectionId)
      if (!connection || m.left) continue
      if (room.phase === 'closed') this.send(connection, 'roomDissolved', { roomId: room.roomId, reason: 'host-left' })
      else {
        const snapshot = duplicateSnapshot(room, m, this.now())
        const key = `${m.seat}/${m.watch}/${snapshot.state?.roundId}/${snapshot.roomRole}/${snapshot.phase}`
        this.send(connection, snapshot.state && connection.duplicateViewKey === key ? 'gameState' : 'roomView', snapshot)
        connection.duplicateViewKey = key
      }
    }
  }
  flush (room) {
    for (const event of room.events) {
      if (this.delivering.has(event.eventId)) continue
      this.delivering.add(event.eventId)
      void this.reporter.enqueue(event).then(accepted => this.serial(async () => {
        const current = structuredClone(this.rooms.get(room.roomId))
        if (!current) return
        if (event.type === 'seat-left') {
          const revoked = accepted?.seatRelease?.revokedTickets || []
          for (const ticket of revoked) if (typeof ticket.jti === 'string' && !current.usedTickets.includes(ticket.jti)) current.usedTickets.push(ticket.jti)
        }
        current.events = current.events.filter(e => e.eventId !== event.eventId)
        await this.commit(current)
      })).catch(e => console.warn('Duplicate event pending:', e.message)).finally(() => this.delivering.delete(event.eventId))
    }
  }
  disconnected (connection) {
    return this.serial(async () => {
      const original = this.rooms.get(connection.duplicateRoomId)
      if (!original) return
      const room = structuredClone(original)
      for (const m of room.members) if (m.connectionId === connection.id) { m.connectionId = null; m.trustee = true }
      room.version++; await this.commit(room); this.publish(room)
    })
  }
  async tick () {
    if (this.disposed) return
    for (const original of [...this.rooms.values()]) {
      this.flush(original)
      const room = structuredClone(original); const now = this.now(); let changed = false
      if (room.tables && room.settings.spectator !== 'live' && room.members.some(m => !m.seat && m.connectionId && !m.left)
        && now - (room.observerPublishedAt || 0) >= 1000) { room.observerPublishedAt = now; changed = true }
      if (room.pendingStart) {
        try { await this.finishStart(room); changed = true } catch { continue }
      }
      if (room.phase === 'lobby' && room.expiresAt <= now) {
        room.phase = 'closed'; room.endedAt = now; changed = true
        room.events.push(duplicateEvent(room, { type: 'room-closed', reason: 'entry-timeout' }, now))
      }
      if (room.phase === 'playing' && room.totalDeadlineAt && now >= room.totalDeadlineAt) {
        room.phase = 'ended'; room.endReason = 'time-limit'; room.endedAt = now; changed = true
      }
      if (room.phase === 'playing') for (const name of ['A', 'B']) {
        const table = room.tables[name]
        if (table.state.phase === 'settled') continue
        const m = occupant(room, globalSeat(name, table.state.currentTurn))
        if (!(m.bot || m.trustee || !m.connectionId || now >= table.deadlineAt)) continue
        const previousPlan = table.pendingBotPlay
        const plan = prepareDuplicateAutomaticPlay(table, Number(room.roomId) + (name === 'A' ? 1 : 2), this.now)
        if (previousPlan !== table.pendingBotPlay) changed = true
        if (plan.waitMs > 0) continue
        const move = plan.cards
        playDuplicate(room, m, move.length ? 'play' : 'pass', { cardIds: move?.map(c => c.id) }, now)
        changed = true
      }
      if (room.phase === 'playing' && room.roundTallied && canStartDuplicate(room)) { dealDuplicateRound(room, this.random, now); changed = true }
      if (changed) { room.version++; duplicateEndEvent(room, now); captureDuplicateObservers(room, now); await this.commit(room); this.publish(room); this.flush(room) }
      // Closed snapshots remain tombstones until all issued entry tickets and the room lease expire.
      if (['closed', 'ended'].includes(room.phase) && now > Math.max(room.expiresAt, room.endedAt || 0) + 86400000 && !room.events.length) {
        const remaining = new Map(this.rooms); remaining.delete(room.roomId)
        await this.store.save({ rooms: [...remaining.values()].map(r => ({ ...r, members: r.members.map(m => ({ ...m, connectionId: null })) })), acceptedActions: [] })
        this.rooms.delete(room.roomId)
      }
    }
  }
  async dispose () {
    this.disposed = true; clearInterval(this.timer); await this.queue
    for (const room of this.rooms.values()) this.reporter.stop?.(room.matchId)
    await this.store.whenIdle()
  }
}
