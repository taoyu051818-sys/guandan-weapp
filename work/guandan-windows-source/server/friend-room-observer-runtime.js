import { createHash } from 'node:crypto'
import { FRIEND_SEATS, supportsRoomObservers, roomMember, memberForToken, moveRoomMember, friendMemberMetadata } from './friend-room-members.js'
import { FriendRoomObserverBuffer } from './friend-room-observer-buffer.js'

export const FRIEND_VIEW_COMMANDS = ['standUp', 'sitDown', 'watchPlayer']

/** In-room observer transport and membership commands; gameplay still authorizes exclusively through playerIn. */
export const createFriendRoomObserverRuntime = d => {
  const buffer = new FriendRoomObserverBuffer()
  const lastSent = new WeakMap()
  let revision = 0
  const project = (room, member) => {
    const view = member.seat || member.viewPlayerId || 'p1'
    const snapshot = member.seat ? d.entryPayloadFor(room, member.seat) : buffer.project(room, view)
    // Never merge live turn/result metadata into a delayed snapshot.
    return {
      ...(snapshot || { state: null, phase: room.state ? 'observing' : 'lobby', version: 0, gameVersion: 0 }),
      roomId: room.roomId, myPlayerId: view, resumeToken: member.resumeToken,
      ...friendMemberMetadata(room, member),
      roomSettings: room.roomSettings,
      memberPlayerIds: FRIEND_SEATS.filter(id => room.resumeTokens[id] || room.botPlayerIds?.includes(id)),
      lobbyReadyPlayerIds: room.state ? [] : FRIEND_SEATS.filter(id => room.lobbyReady[id]),
      lobbyReadyRequired: true, entryKind: 'friend', gameStartPending: Boolean(room.pendingGameStartEvent),
      capabilities: { canUseBots: !room.ticketBound, canKickMembers: true, requiresLobbyReady: true },
      observerWaiting: !member.seat && Boolean(room.state) && !snapshot,
      viewRevision: ++revision,
    }
  }
  const publishMember = (room, member, force = false) => {
    const connection = d.connections.get(member.connectionId)
    if (!connection) return
    const payload = project(room, member)
    const signature = `${room.version}:${payload.version}:${payload.myPlayerId}:${payload.roomRole}:${payload.observerWaiting}`
    if (!force && lastSent.get(member) === signature) return
    lastSent.set(member, signature)
    d.send(connection, 'roomView', payload)
  }
  const publish = room => {
    if (!supportsRoomObservers(room)) return
    for (const member of room.friendMembers || []) if (!room.state || !member.seat) publishMember(room, member, true)
  }
  const capture = (room, payload) => {
    if (!supportsRoomObservers(room)) return
    buffer.capture(room, { ...payload, state: room.state })
    for (const member of room.friendMembers || []) if (!member.seat) publishMember(room, member)
  }
  const tick = setInterval(() => {
    for (const room of d.rooms.values()) {
      if (!supportsRoomObservers(room)) continue
      if ([...d.acceptedActions.values()].some(action => action.pendingDurability && action.response?.roomId === room.roomId)) continue
      for (const member of room.friendMembers || []) if (!member.seat) publishMember(room, member)
    }
  }, 500)
  tick.unref?.()

  const handle = async context => {
    const { type, payload, connection, reply, acceptAction } = context
    const room = d.rooms.get(String(payload.roomId || connection.roomId || ''))
    const member = roomMember(room, connection.id)
    if (!supportsRoomObservers(room) || !member) return reply('error', { message: '当前不在允许观战的好友房中' })
    try {
      if (type === 'watchPlayer') {
        if (member.seat) throw new Error('请先进入观战位')
        if (!FRIEND_SEATS.includes(payload.playerId)) throw new Error('观看座位无效')
        member.viewPlayerId = payload.playerId
      } else moveRoomMember(room, member, type === 'standUp' ? null : payload.playerId)
    } catch (error) { return reply('error', { message: error.message }) }
    await acceptAction(room)
    d.publishRoomMembers(room)
    publish(room)
  }

  const enter = async context => {
    const { type, payload, connection, requestId, reply } = context
    const room = d.rooms.get(String(payload.roomId || ''))
    if (!supportsRoomObservers(room)) return false
    const tokenKey = typeof payload.resumeToken === 'string' ? `friend-entry:${createHash('sha256').update(payload.resumeToken).digest('hex')}:${requestId}` : null
    const priorResume = tokenKey && d.acceptedActions.get(tokenKey)
    let member
    let claims
    let consumed = false
    try {
      if (type === 'rejoinRoom') member = memberForToken(room, payload.resumeToken, d.sameToken) || (priorResume && memberForToken(room, priorResume.response.resumeToken, d.sameToken))
      else {
        const inspected = d.inspectEntryTicket(payload, { roomId: room.roomId })
        claims = inspected.claims
        consumed = inspected.consumed
        if (!claims) return false // Preserve unsigned local room admission.
        if (d.ticketBlockedByClosedRoom(claims)) throw new Error('该房间已经关闭')
        if (!d.ticketMatchesRoom(room, claims) || payload.entryAttemptId !== claims.entryAttemptId) throw new Error('好友房入桌凭证与房间不匹配')
        if (room.revokedFriendUserIds?.includes(claims.sub)) throw Object.assign(new Error('已被房主移出房间'), { code: 'FRIEND_ROOM_PARTICIPANT_REVOKED' })
        if (room.revokedTicketJtis?.some(item => item.jti === claims.jti)) throw Object.assign(new Error('入桌凭证已撤销'), { code: 'FRIEND_ROOM_TICKET_REVOKED' })
        if (room.pendingSpectatorEvents?.some(event => event.type === 'seat-left' && (event.userId === claims.sub || event.playerId === claims.seat))) throw Object.assign(new Error('席位退出正在同步，请稍后重试'), { code: 'FRIEND_SEAT_RELEASE_PENDING' })
        member = room.friendMembers?.find(item => item.userId === claims.sub)
        if (claims.purpose === 'rejoin' && ((!member && claims.seat !== 'observer') || (member && (room.state || room.pendingGameStartEvent) && claims.seat !== (member.seat || 'observer')))) throw Object.assign(new Error('恢复票据与当前席位用户绑定不一致'), { code: 'RECOVERY_BINDING_MISMATCH' })
      }
      if (d.entryConflictFor(connection, room.roomId)) throw new Error('请先离开当前房间')
      if (member?.connectionId !== connection.id && d.connections.has(member?.connectionId)) throw new Error('该成员已在另一个连接中，请先断开旧连接')
      if (!member && type === 'rejoinRoom') throw new Error('重连凭证无效')
      if (!member && (room.friendMembers || []).length >= 12) throw new Error('房间成员已满（最多12人）')
    } catch (error) { reply('error', { code: error.code, message: error.message }); return true }
    const credential = claims?.jti || payload.resumeToken
    const key = `friend-entry:${createHash('sha256').update(credential).digest('hex')}:${requestId}`
    const fingerprint = d.actionFingerprint(type, payload)
    const previous = d.acceptedActions.get(key)
    if (previous && previous.fingerprint !== fingerprint) { reply('error', { code: 'IDEMPOTENCY_CONFLICT', message: '入桌请求标识不能复用' }); return true }
    if (!previous && (consumed || claims && member?.jti === claims.jti)) { reply('error', { code: claims?.purpose === 'rejoin' ? 'RECOVERY_TICKET_USED' : 'GAME_TICKET_USED', message: '入桌票据已使用，请恢复牌局' }); return true }
    if (!d.reserveAccepted(key)) { reply('error', { code: 'PERSISTENCE_PENDING', message: '请稍后重试' }); return true }
    try {
      if (!previous && claims) d.gameTicketVerifier.consume(claims)
      if (!member) {
        room.friendMembers ||= []
        member = { userId: claims.sub, name: String(payload.hostName || '牌友').slice(0, 24), seat: null, entrySeat: claims.seat, viewPlayerId: 'p1', resumeToken: d.createResumeToken() }
        room.friendMembers.push(member)
        if (!room.state && claims.seat !== 'observer') {
          const free = FRIEND_SEATS.find(id => !room.resumeTokens[id] && !room.botPlayerIds?.includes(id))
          if (free) member.seat = free
        }
      }
      member.connectionId = connection.id
      if (!previous) {
        const token = d.createResumeToken()
        d.rotateAcceptedActionIdentity(member.resumeToken, token, room)
        member.resumeToken = token
      }
      if (claims) {
        if (member.jti && member.jti !== claims.jti) room.revokedTicketJtis.push({ jti: member.jti, exp: member.exp })
        member.jti = claims.jti; member.exp = claims.exp
      }
      room.friendHostUserId ||= claims?.hostUserId || (claims?.seat === 'p1' ? claims.sub : null)
      if (member.seat) {
        const seat = member.seat
        room.seats[seat] = connection.id
        room.resumeTokens[seat] = member.resumeToken
        room.userIdsBySeat[seat] = member.userId
        room.ticketJtisBySeat[seat] = member.jti
        room.ticketExpiresAtBySeat[seat] = member.exp
      }
      connection.roomId = room.roomId
      d.clearEmptyRoomExpiry(room.roomId)
      d.clearHostExpiry(room.roomId)
      if (!previous) room.version += 1
      const responseType = type === 'rejoinRoom' || claims?.purpose === 'rejoin' ? 'roomRejoined' : type === 'createRoom' ? 'roomCreated' : 'roomJoined'
      const response = { requestId, ...project(room, member) }
      d.rememberAccepted(key, fingerprint, response, responseType)
      connection.acceptedCacheKeys.set(requestId, key)
      await d.commitRuntimeState()
      d.send(connection, responseType, response)
      d.publishRoomMembers(room)
      publish(room)
      return true
    } finally { d.releaseAccepted(key) }
  }
  return { handle, enter, publish, project, capture, dispose: () => clearInterval(tick) }
}
