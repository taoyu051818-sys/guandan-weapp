import { createHash } from 'node:crypto'
import { normalizeFriendRoomSettings } from '../friend-room-settings.js'
import { canonicalJsonFingerprint, matchesJsonFingerprint } from './canonical-json.js'
import { PlatformError, badRequest, conflict, notFound } from './errors.js'

const seats = ['p1', 'p2', 'p3', 'p4']
export const friendRoomKind = 'friend-room'
export const friendRoomDefaultTtlMs = 30 * 60_000
const maxActiveFriendTicketsPerSeat = 256
const fingerprint = canonicalJsonFingerprint
const inviteCodeHash = value => createHash('sha256').update(value).digest('hex')

const ensureFriendCollections = (state) => {
  state.friendRoomEntryAttempts ||= {}
  state.spectatorFeeds ||= {}
}

const normalizeEntryAttemptId = (value) => {
  const entryAttemptId = typeof value === 'string' ? value.trim() : ''
  if (entryAttemptId.length < 22 || entryAttemptId.length > 128 || !/^[A-Za-z0-9_-]+$/.test(entryAttemptId)) {
    throw badRequest('INVALID_ENTRY_ATTEMPT_ID', 'entryAttemptId 必须是 22 到 128 位 base64url 字符')
  }
  return entryAttemptId
}

const normalizeRecoveryAttemptId = (value) => {
  const recoveryAttemptId = typeof value === 'string' ? value.trim() : ''
  if (recoveryAttemptId.length < 22 || recoveryAttemptId.length > 128 || !/^[A-Za-z0-9_-]+$/.test(recoveryAttemptId)) {
    throw badRequest('INVALID_RECOVERY_ATTEMPT_ID', 'recoveryAttemptId 必须是 22 到 128 位 base64url 字符')
  }
  return recoveryAttemptId
}

const normalizeInviteCode = (value) => {
  const inviteCode = typeof value === 'string' ? value.trim() : ''
  if (inviteCode.length < 20 || inviteCode.length > 128 || !/^[A-Za-z0-9_-]+$/.test(inviteCode)) {
    throw notFound('FRIEND_ROOM_UNAVAILABLE', '好友房不存在或邀请码无效')
  }
  return inviteCode
}

export class FriendRoomService {
  constructor ({
    store,
    gameTickets,
    now = () => Date.now(),
    createId,
    createInviteCode,
    createEntryAttemptId,
    createRoomId,
    friendRoomTtlMs = friendRoomDefaultTtlMs,
    cancelExpiredUnstartedMatch = () => false,
  } = {}) {
    if (!store || !gameTickets || typeof createId !== 'function' || typeof createRoomId !== 'function') {
      throw new TypeError('FriendRoomService 缺少 store/gameTickets/createId/createRoomId')
    }
    this.store = store
    this.gameTickets = gameTickets
    this.now = now
    this.createId = createId
    this.createInviteCode = createInviteCode
    this.createEntryAttemptId = createEntryAttemptId
    this.createRoomId = createRoomId
    this.friendRoomTtlMs = friendRoomTtlMs
    this.cancelExpiredUnstartedMatch = cancelExpiredUnstartedMatch
  }

  normalizeSettings (value) {
    try {
      return normalizeFriendRoomSettings(value, { strict: true })
    } catch (error) {
      throw badRequest('INVALID_FRIEND_ROOM_SETTINGS', error instanceof Error ? error.message : '好友房设置无效')
    }
  }

  ensureParticipantEntryAttemptId (participant, preferred = '') {
    const current = typeof participant.entryAttemptId === 'string' ? participant.entryAttemptId : ''
    if (/^[A-Za-z0-9_-]{22,128}$/.test(current)) return current
    const candidate = preferred || String(this.createEntryAttemptId() || '')
    if (!/^[A-Za-z0-9_-]{22,128}$/.test(candidate)) throw conflict('ENTRY_ATTEMPT_ID_EXHAUSTED', '暂时无法生成稳定入桌请求标识')
    participant.entryAttemptId = candidate
    return candidate
  }

  trackTicket (participant, claims, now = this.now()) {
    const nowSeconds = Math.floor(now / 1000)
    const current = Array.isArray(participant.issuedTicketBindings) ? participant.issuedTicketBindings : []
    const active = current.filter(item => item && typeof item.jti === 'string' && Number.isFinite(item.exp) && item.exp > nowSeconds)
    if (claims && typeof claims.jti === 'string' && Number.isFinite(claims.exp) && claims.exp > nowSeconds && !active.some(item => item.jti === claims.jti)) {
      active.push({ jti: claims.jti, exp: claims.exp })
    }
    participant.issuedTicketBindings = active
  }

  activeTickets (participant, now = this.now()) {
    const tickets = new Map()
    const add = claims => {
      if (claims && typeof claims.jti === 'string' && Number.isFinite(claims.exp) && claims.exp * 1000 > now) {
        tickets.set(claims.jti, { jti: claims.jti, exp: claims.exp })
      }
    }
    for (const claims of participant.issuedTicketBindings || []) add(claims)
    for (const receipt of Object.values(participant.recoveryAttempts || {})) {
      try { add(this.gameTickets.inspect(receipt?.entry?.gameTicket)) } catch {}
    }
    add(participant.claims)
    return [...tickets.values()]
  }

  assertTicketCapacity (participant, now = this.now()) {
    if (this.activeTickets(participant, now).length >= maxActiveFriendTicketsPerSeat) {
      throw conflict('FRIEND_TICKET_LIMIT_REACHED', '该好友席位的有效恢复票据过多，请等待旧票过期后重试')
    }
  }

  allocateInviteCode (state) {
    for (let attempt = 0; attempt < 32; attempt += 1) {
      const inviteCode = String(this.createInviteCode() || '')
      if (!/^[A-Za-z0-9_-]{20,128}$/.test(inviteCode)) continue
      const digest = inviteCodeHash(inviteCode)
      if (!Object.values(state.matches).some(match => match?.kind === friendRoomKind && match.inviteCodeHash === digest)) {
        return { inviteCode, inviteCodeHash: digest }
      }
    }
    throw conflict('FRIEND_INVITE_EXHAUSTED', '暂时无法生成好友房邀请码，请稍后重试')
  }

  hasExpired (match, now) {
    return Boolean(
      match?.kind === friendRoomKind &&
      ['matching', 'matched'].includes(match.status) &&
      Number.isFinite(Number(match.friendRoomExpiresAt)) &&
      Number(match.friendRoomExpiresAt) <= now
    )
  }

  cancelExpired (state, match, now) {
    if (!this.hasExpired(match, now)) return false
    match.status = 'cancelled'
    match.cancelledAt = now
    match.cancelReason = 'friend-room-expired'
    match.participants.forEach(participant => {
      if (!['matching', 'matched'].includes(participant.status)) return
      participant.status = 'cancelled'
      participant.cancelledAt = now
      if (state.activeMatchByUser[participant.userId] === match.id) delete state.activeMatchByUser[participant.userId]
    })
    const feed = state.spectatorFeeds[match.id]
    if (feed && !feed.finishedAt && !feed.abortedAt) {
      feed.abortedAt = now
      feed.abortReason = 'entry-timeout'
      feed.finalSpectatorSequence = 0
    }
    return true
  }

  cancelByHost (state, match, now) {
    match.status = 'cancelled'
    match.cancelledAt = now
    match.cancelReason = 'host-left'
    match.participants.forEach(participant => {
      if (!['matching', 'matched'].includes(participant.status)) return
      participant.status = 'cancelled'
      participant.cancelledAt = now
      if (state.activeMatchByUser[participant.userId] === match.id) delete state.activeMatchByUser[participant.userId]
    })
    const feed = state.spectatorFeeds[match.id]
    if (feed && !feed.finishedAt && !feed.abortedAt) {
      feed.abortedAt = now
      feed.abortReason = 'host-left'
      feed.finalSpectatorSequence = 0
    }
  }

  activeMatchForEntry (state, userId, now) {
    const activeId = state.activeMatchByUser[userId]
    if (!activeId) return null
    const active = state.matches[activeId]
    if (!active) {
      delete state.activeMatchByUser[userId]
      return null
    }
    if (this.cancelExpired(state, active, now) || this.cancelExpiredUnstartedMatch(state, active, now)) return null
    const participant = active.participants.find(item => item.userId === userId)
    if (!['matching', 'matched', 'playing'].includes(active.status) || !participant || !['matching', 'matched', 'playing'].includes(participant.status)) {
      if (state.activeMatchByUser[userId] === active.id) delete state.activeMatchByUser[userId]
      return null
    }
    return active
  }

  ensureTicket (match, participant, now, { purpose = 'entry' } = {}) {
    const entryAttemptId = this.ensureParticipantEntryAttemptId(participant)
    if (participant.gameTicket && Number(participant.expiresAt) > now && participant.claims?.purpose === purpose && participant.claims?.entryAttemptId === entryAttemptId) {
      this.trackTicket(participant, participant.claims, now)
      return false
    }
    this.assertTicketCapacity(participant, now)
    const issued = this.gameTickets.issue({
      userId: participant.userId,
      matchId: match.id,
      roomId: match.roomId,
      seat: participant.seat,
      roomKind: 'friend',
      purpose,
      entryAttemptId,
      roomExpiresAt: match.friendRoomExpiresAt,
      roomSettings: match.roomSettings,
    })
    Object.assign(participant, issued, { ticketIssuedAt: now })
    this.trackTicket(participant, issued.claims, now)
    return true
  }

  entryView (match, participant, entryAttemptId = '', { includeInvite = false } = {}) {
    return {
      entryAttemptId: entryAttemptId || participant.claims?.entryAttemptId || this.ensureParticipantEntryAttemptId(participant),
      matchId: match.id,
      roomId: match.roomId,
      seat: participant.seat,
      roomKind: 'friend',
      gameEndpoint: participant.gameEndpoint,
      gameTicket: participant.gameTicket,
      joinToken: participant.gameTicket,
      ticketPurpose: participant.claims?.purpose || 'entry',
      expiresAt: participant.expiresAt,
      roomExpiresAt: match.friendRoomExpiresAt,
      roomSettings: structuredClone(match.roomSettings),
      ...(includeInvite ? {
        inviteCode: match.inviteCode,
        invitePayload: { version: 1, roomId: match.roomId, inviteCode: match.inviteCode },
        inviteText: `${match.roomId}.${match.inviteCode}`,
      } : {}),
    }
  }

  async create (userId, { entryAttemptId, roomSettings } = {}) {
    const safeAttemptId = normalizeEntryAttemptId(entryAttemptId)
    const normalizedSettings = this.normalizeSettings(roomSettings)
    const request = { action: 'create', roomSettings: normalizedSettings }
    const requestFingerprint = fingerprint(request)
    const now = this.now()
    const outcome = await this.store.transaction(state => {
      ensureFriendCollections(state)
      const attemptKey = `${userId}:${safeAttemptId}`
      const previous = state.friendRoomEntryAttempts[attemptKey]
      if (previous) {
        if (!matchesJsonFingerprint(previous.fingerprint, request)) throw conflict('IDEMPOTENCY_CONFLICT', '同一个 entryAttemptId 不能用于不同好友房创建请求')
        const match = state.matches[previous.matchId]
        if (!match || match.kind !== friendRoomKind || this.cancelExpired(state, match, now)) return { unavailable: true }
        if (match.status === 'playing') throw conflict('FRIEND_ROOM_ALREADY_STARTED', '好友房已经开始，请使用牌局服重连凭证')
        if (!['matching', 'matched'].includes(match.status)) return { unavailable: true }
        const participant = match.participants.find(item => item.userId === userId && item.seat === 'p1')
        if (!participant) throw conflict('FRIEND_ROOM_STATE_CORRUPT', '好友房房主席位状态不完整')
        if (this.ensureParticipantEntryAttemptId(participant, safeAttemptId) !== safeAttemptId) throw conflict('FRIEND_ENTRY_ATTEMPT_MISMATCH', '该好友房席位已绑定其他 entryAttemptId，请使用恢复接口')
        this.ensureTicket(match, participant, now)
        state.activeMatchByUser[userId] = match.id
        return { entry: this.entryView(match, participant, safeAttemptId, { includeInvite: true }) }
      }
      const active = this.activeMatchForEntry(state, userId, now)
      if (active) throw conflict('ALREADY_MATCHING', '请先结束当前匹配或牌局')
      const roomId = this.createRoomId(state)
      const invite = this.allocateInviteCode(state)
      const match = {
        id: `mat_friend_${this.createId()}`,
        kind: friendRoomKind,
        mode: 'friend',
        status: 'matching',
        hostUserId: userId,
        roomId,
        roomSettings: normalizedSettings,
        inviteCode: invite.inviteCode,
        inviteCodeHash: invite.inviteCodeHash,
        friendRoomExpiresAt: now + this.friendRoomTtlMs,
        participants: [{ userId, status: 'matching', seat: 'p1', entryAttemptId: safeAttemptId, joinedAt: now }],
        createdAt: now,
      }
      this.ensureTicket(match, match.participants[0], now)
      state.matches[match.id] = match
      state.activeMatchByUser[userId] = match.id
      state.friendRoomEntryAttempts[attemptKey] = { userId, entryAttemptId: safeAttemptId, action: 'create', fingerprint: requestFingerprint, matchId: match.id, createdAt: now }
      state.spectatorFeeds[match.id] = { matchId: match.id, mode: match.mode, startedAt: now, finishedAt: null, events: [] }
      return { entry: this.entryView(match, match.participants[0], safeAttemptId, { includeInvite: true }) }
    })
    if (outcome.unavailable) throw notFound('FRIEND_ROOM_UNAVAILABLE', '好友房不存在或邀请码无效')
    return outcome.entry
  }

  async join (userId, { entryAttemptId, roomId, inviteCode } = {}) {
    const safeAttemptId = normalizeEntryAttemptId(entryAttemptId)
    const safeRoomId = /^\d{6}$/.test(String(roomId || '')) ? String(roomId) : ''
    if (!safeRoomId) throw notFound('FRIEND_ROOM_UNAVAILABLE', '好友房不存在或邀请码无效')
    const suppliedInviteHash = inviteCodeHash(normalizeInviteCode(inviteCode))
    const request = { action: 'join', roomId: safeRoomId, inviteCodeHash: suppliedInviteHash }
    const requestFingerprint = fingerprint(request)
    const now = this.now()
    const outcome = await this.store.transaction(state => {
      ensureFriendCollections(state)
      const attemptKey = `${userId}:${safeAttemptId}`
      const previous = state.friendRoomEntryAttempts[attemptKey]
      if (previous && !matchesJsonFingerprint(previous.fingerprint, request)) throw conflict('IDEMPOTENCY_CONFLICT', '同一个 entryAttemptId 不能用于不同好友房加入请求')
      const match = Object.values(state.matches).find(item => item?.kind === friendRoomKind && item.roomId === safeRoomId)
      if (!match || this.cancelExpired(state, match, now)) return { unavailable: true }
      if (match.inviteCodeHash !== suppliedInviteHash) throw notFound('FRIEND_ROOM_UNAVAILABLE', '好友房不存在或邀请码无效')
      if (Array.isArray(match.bannedUserIds) && match.bannedUserIds.includes(userId)) throw new PlatformError(403, 'FRIEND_ROOM_BANNED', '你已被移出该好友房，不能重新加入')
      if (previous && previous.matchId !== match.id) throw conflict('IDEMPOTENCY_CONFLICT', '同一个 entryAttemptId 不能用于不同好友房加入请求')
      if (match.status === 'playing') throw conflict('FRIEND_ROOM_ALREADY_STARTED', '好友房已经开始，请使用牌局服重连凭证')
      if (!['matching', 'matched'].includes(match.status)) return { unavailable: true }
      const active = this.activeMatchForEntry(state, userId, now)
      if (active && active.id !== match.id) throw conflict('ALREADY_MATCHING', '请先结束当前匹配或牌局')
      let participant = match.participants.find(item => item.userId === userId)
      if (!participant) {
        const occupiedSeats = new Set(match.participants.filter(item => ['matching', 'matched'].includes(item.status) || (item.status === 'cancelled' && !item.ticketRevokedAt && Number(item.expiresAt) > now)).map(item => item.seat))
        const seat = seats.slice(1).find(candidate => !occupiedSeats.has(candidate))
        if (!seat) throw conflict('FRIEND_ROOM_FULL', '好友房席位已满')
        participant = { userId, status: 'matching', seat, entryAttemptId: safeAttemptId, joinedAt: now }
        match.participants.push(participant)
      } else {
        const releasePending = Boolean(participant.status === 'cancelled' && participant.cancellationRequestedAt && !participant.seatLifecycleConfirmedAt)
        if (releasePending) throw conflict('FRIEND_SEAT_RELEASE_PENDING', '席位正在等待牌局服确认离席，请稍后重试')
        if (participant.status === 'cancelled' && participant.seatLifecycleConfirmedAt) {
          if (this.ensureParticipantEntryAttemptId(participant) === safeAttemptId) throw conflict('FRIEND_ENTRY_ATTEMPT_REVOKED', '旧 entryAttemptId 已随离席确认撤销，请生成新的入桌请求标识')
          participant.entryAttemptId = safeAttemptId
        } else if (this.ensureParticipantEntryAttemptId(participant, safeAttemptId) !== safeAttemptId) {
          throw conflict('FRIEND_ENTRY_ATTEMPT_MISMATCH', '该好友房席位已绑定其他 entryAttemptId，请使用恢复接口')
        }
      }
      if (participant.status === 'cancelled') {
        const occupiedByOthers = new Set(match.participants.filter(item => item !== participant && (['matching', 'matched'].includes(item.status) || (item.status === 'cancelled' && !item.ticketRevokedAt && Number(item.expiresAt) > now))).map(item => item.seat))
        if (!seats.slice(1).includes(participant.seat) || occupiedByOthers.has(participant.seat)) {
          const nextSeat = seats.slice(1).find(candidate => !occupiedByOthers.has(candidate))
          if (!nextSeat) throw conflict('FRIEND_ROOM_FULL', '好友房席位已满')
          participant.seat = nextSeat
          delete participant.gameTicket
          delete participant.joinToken
          delete participant.expiresAt
          delete participant.claims
        }
        participant.status = 'matching'
        participant.issuedTicketBindings = []
        participant.recoveryAttempts = {}
        participant.joinedAt = now
        for (const key of ['cancelledAt', 'leaveReason', 'ticketRevokedAt', 'revokedTicketJti', 'revokedTicketExpiresAt', 'cancellationRequestedAt', 'seatLifecycleConfirmedAt']) delete participant[key]
      }
      this.ensureTicket(match, participant, now)
      state.activeMatchByUser[userId] = match.id
      state.friendRoomEntryAttempts[attemptKey] ||= { userId, entryAttemptId: safeAttemptId, action: 'join', fingerprint: requestFingerprint, matchId: match.id, createdAt: now }
      if (match.participants.filter(item => ['matching', 'matched'].includes(item.status)).length === 4 && match.status === 'matching') {
        match.status = 'matched'
        match.matchedAt = now
        match.participants.forEach(item => { if (item.status === 'matching') item.status = 'matched' })
      }
      return { entry: this.entryView(match, participant, safeAttemptId) }
    })
    if (outcome.unavailable) throw notFound('FRIEND_ROOM_UNAVAILABLE', '好友房不存在或邀请码无效')
    return outcome.entry
  }

  findRecoveryReceipt (state, userId, recoveryAttemptId) {
    for (const match of Object.values(state.matches)) {
      const participant = match?.participants?.find(item => item.userId === userId)
      const receipt = participant?.recoveryAttempts?.[recoveryAttemptId]
      if (receipt) return { match, participant, receipt }
    }
    return null
  }

  saveRecoveryReceipt (participant, recoveryAttemptId, requestFingerprint, entry, now) {
    participant.recoveryAttempts ||= {}
    for (const [attemptId, receipt] of Object.entries(participant.recoveryAttempts)) {
      if (Number(receipt?.entry?.expiresAt) <= now) delete participant.recoveryAttempts[attemptId]
    }
    participant.recoveryAttempts[recoveryAttemptId] = { recoveryAttemptId, fingerprint: requestFingerprint, entry: structuredClone(entry), createdAt: now }
  }

  pendingSeatRelease (state, userId) {
    return Object.values(state.matches).some(match => match?.kind === friendRoomKind && ['matching', 'matched'].includes(match.status) && match.participants?.some(participant => participant.userId === userId && participant.status === 'cancelled' && participant.cancellationRequestedAt && !participant.seatLifecycleConfirmedAt))
  }

  async recoverFriend (userId, input = {}) {
    return this.recover(userId, input, { friendOnly: true })
  }

  async recover (userId, { recoveryAttemptId } = {}, { friendOnly = false } = {}) {
    const safeRecoveryAttemptId = normalizeRecoveryAttemptId(recoveryAttemptId)
    const now = this.now()
    return this.store.transaction(state => {
      ensureFriendCollections(state)
      const matchId = state.activeMatchByUser[userId]
      const match = matchId ? state.matches[matchId] : null
      if (!match) {
        if (this.pendingSeatRelease(state, userId)) throw conflict('FRIEND_SEAT_RELEASE_PENDING', '席位正在等待牌局服确认离席，请稍后重试')
        return null
      }
      if (friendOnly && match.kind !== friendRoomKind) return null
      if (match.kind === friendRoomKind) {
        if (this.cancelExpired(state, match, now)) return null
        if (!['matching', 'matched', 'playing'].includes(match.status)) return null
        const participant = match.participants.find(item => item.userId === userId && ['matching', 'matched', 'playing'].includes(item.status))
        if (!participant) return null
        const purpose = match.status === 'playing' ? 'rejoin' : 'entry'
        const participantEntryAttemptId = this.ensureParticipantEntryAttemptId(participant)
        const request = { action: 'recover', matchId: match.id, roomId: match.roomId, seat: participant.seat, roomKind: 'friend', purpose, participantEntryAttemptId }
        const requestFingerprint = fingerprint(request)
        const previous = this.findRecoveryReceipt(state, userId, safeRecoveryAttemptId)
        if (previous) {
          if (previous.participant !== participant || !matchesJsonFingerprint(previous.receipt.fingerprint, request)) throw conflict('RECOVERY_ATTEMPT_CONFLICT', '同一个 recoveryAttemptId 不能恢复不同的牌局绑定')
          return structuredClone(previous.receipt.entry)
        }
        this.assertTicketCapacity(participant, now)
        Object.assign(participant, this.gameTickets.issue({ userId, matchId: match.id, roomId: match.roomId, seat: participant.seat, roomKind: 'friend', purpose, entryAttemptId: safeRecoveryAttemptId, roomExpiresAt: match.friendRoomExpiresAt, roomSettings: match.roomSettings }), { recoveryIssuedAt: now })
        this.trackTicket(participant, participant.claims, now)
        const entry = { ...this.entryView(match, participant, safeRecoveryAttemptId, { includeInvite: match.status !== 'playing' && match.hostUserId === userId }), recoveryAttemptId: safeRecoveryAttemptId, roomKind: 'friend' }
        this.saveRecoveryReceipt(participant, safeRecoveryAttemptId, requestFingerprint, entry, now)
        return entry
      }
      if (this.cancelExpiredUnstartedMatch(state, match, now)) return null
      if (!['matched', 'playing'].includes(match.status)) return null
      const participant = match.participants.find(item => item.userId === userId && ['matched', 'playing'].includes(item.status) && item.seat)
      if (!participant) return null
      const purpose = match.status === 'playing' ? 'rejoin' : 'entry'
      const participantEntryAttemptId = this.ensureParticipantEntryAttemptId(participant)
      const request = { action: 'recover', matchId: match.id, roomId: match.roomId, seat: participant.seat, roomKind: 'match', purpose, participantEntryAttemptId }
      const requestFingerprint = fingerprint(request)
      const previous = this.findRecoveryReceipt(state, userId, safeRecoveryAttemptId)
      if (previous) {
        if (previous.participant !== participant || !matchesJsonFingerprint(previous.receipt.fingerprint, request)) throw conflict('RECOVERY_ATTEMPT_CONFLICT', '同一个 recoveryAttemptId 不能恢复不同的牌局绑定')
        return structuredClone(previous.receipt.entry)
      }
      Object.assign(participant, this.gameTickets.issue({ userId, matchId: match.id, roomId: match.roomId, seat: participant.seat, roomKind: 'match', purpose, entryAttemptId: safeRecoveryAttemptId }), { recoveryIssuedAt: now })
      state.activeMatchByUser[userId] = match.id
      const entry = { entryAttemptId: safeRecoveryAttemptId, recoveryAttemptId: safeRecoveryAttemptId, matchId: match.id, roomId: match.roomId, seat: participant.seat, roomKind: 'match', ticketPurpose: participant.claims?.purpose || purpose, gameEndpoint: participant.gameEndpoint, gameTicket: participant.gameTicket, joinToken: participant.gameTicket, expiresAt: participant.expiresAt }
      this.saveRecoveryReceipt(participant, safeRecoveryAttemptId, requestFingerprint, entry, now)
      return entry
    })
  }
}
