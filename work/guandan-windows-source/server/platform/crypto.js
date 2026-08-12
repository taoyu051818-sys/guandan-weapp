import { createHmac, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto'
import { normalizeFriendRoomSettings } from '../friend-room-settings.js'
import { unauthorized } from './errors.js'

const encode = (value) => Buffer.from(typeof value === 'string' ? value : JSON.stringify(value)).toString('base64url')
const decodeJson = (value) => JSON.parse(Buffer.from(value, 'base64url').toString('utf8'))
const hmac = (value, secret) => createHmac('sha256', secret).update(value).digest('base64url')
const safeEqual = (left, right) => {
  const a = Buffer.from(String(left))
  const b = Buffer.from(String(right))
  return a.length === b.length && timingSafeEqual(a, b)
}
const ticketRoomKinds = new Set(['match', 'friend'])
const gameTicketPurposes = new Set(['entry', 'rejoin'])
const validEntryAttemptId = value => typeof value === 'string' && value.length >= 22 && value.length <= 128 && /^[A-Za-z0-9_-]+$/.test(value)
const canonicalFriendRoomSettings = (value) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw unauthorized('好友房票据缺少规范房间设置')
  let normalized
  try { normalized = normalizeFriendRoomSettings(value, { strict: true }) } catch { throw unauthorized('好友房票据房间设置无效') }
  const expectedKeys = Object.keys(normalized)
  const receivedKeys = Object.keys(value)
  if (
    receivedKeys.length !== expectedKeys.length ||
    expectedKeys.some(key => !Object.hasOwn(value, key) || value[key] !== normalized[key])
  ) throw unauthorized('好友房票据房间设置不是规范格式')
  return normalized
}
const roomSettingsFingerprint = value => value === undefined ? '' : JSON.stringify(canonicalFriendRoomSettings(value))

export const signCompactToken = (claims, secret) => {
  const header = encode({ alg: 'HS256', typ: 'GDT' })
  const payload = encode(claims)
  return `${header}.${payload}.${hmac(`${header}.${payload}`, secret)}`
}

export const verifyCompactToken = (token, secret, { now = Date.now(), kind, audience } = {}) => {
  if (typeof token !== 'string') throw unauthorized('凭证缺失')
  const parts = token.split('.')
  if (parts.length !== 3 || !safeEqual(hmac(`${parts[0]}.${parts[1]}`, secret), parts[2])) {
    throw unauthorized('凭证签名无效')
  }
  let claims
  try { claims = decodeJson(parts[1]) } catch { throw unauthorized('凭证内容无效') }
  const nowSeconds = Math.floor(now / 1000)
  if (!Number.isFinite(claims.exp) || claims.exp <= nowSeconds) throw unauthorized('凭证已过期')
  if (Number.isFinite(claims.nbf) && claims.nbf > nowSeconds) throw unauthorized('凭证尚未生效')
  if (kind && claims.kind !== kind) throw unauthorized('凭证类型无效')
  if (audience && claims.aud !== audience) throw unauthorized('凭证受众无效')
  return claims
}

export class AccessTokenService {
  constructor ({ secret, ttlMs = 24 * 60 * 60 * 1000, now = () => Date.now() }) {
    this.secret = secret
    this.ttlMs = ttlMs
    this.now = now
  }

  issue (userId) {
    const issuedAt = this.now()
    const expiresAt = issuedAt + this.ttlMs
    return {
      accessToken: signCompactToken({ kind: 'access', sub: userId, jti: randomUUID(), iat: Math.floor(issuedAt / 1000), exp: Math.floor(expiresAt / 1000), aud: 'guandan-platform' }, this.secret),
      expiresAt,
    }
  }

  verify (token) {
    const claims = verifyCompactToken(token, this.secret, { now: this.now(), kind: 'access', audience: 'guandan-platform' })
    if (typeof claims.sub !== 'string' || !claims.sub) throw unauthorized('登录凭证缺少用户信息')
    return claims
  }
}

export class GameTicketService {
  constructor ({ secret, ttlMs = 90_000, gameEndpoint, now = () => Date.now() }) {
    this.secret = secret
    this.ttlMs = ttlMs
    this.gameEndpoint = gameEndpoint
    this.now = now
  }

  issue ({ userId, matchId, roomId, seat, roomKind = 'match', purpose = 'entry', entryAttemptId = randomBytes(16).toString('base64url'), roomExpiresAt, roomSettings }) {
    if (!validEntryAttemptId(entryAttemptId)) throw new TypeError('entryAttemptId 必须是 22 到 128 位 base64url 字符')
    const issuedAt = this.now()
    const expiresAt = roomKind === 'friend' && purpose === 'entry' && Number.isSafeInteger(roomExpiresAt)
      ? Math.min(issuedAt + this.ttlMs, roomExpiresAt)
      : issuedAt + this.ttlMs
    const claims = {
      kind: 'game-ticket',
      aud: 'guandan-game',
      sub: userId,
      matchId,
      roomId,
      seat,
      roomKind,
      purpose,
      entryAttemptId,
      ...(Number.isSafeInteger(roomExpiresAt) ? { roomExpiresAt } : {}),
      ...(roomSettings ? { roomSettings: structuredClone(roomSettings) } : {}),
      jti: randomUUID(),
      iat: Math.floor(issuedAt / 1000),
      exp: Math.floor(expiresAt / 1000),
    }
    return { gameTicket: signCompactToken(claims, this.secret), expiresAt, gameEndpoint: this.gameEndpoint, claims }
  }

  inspect (gameTicket) {
    return verifyCompactToken(gameTicket, this.secret, {
      now: this.now(),
      kind: 'game-ticket',
      audience: 'guandan-game',
    })
  }
}

export class GameTicketVerifier {
  constructor ({ secret, required = false, now = () => Date.now(), maxRemembered = 20_000 }) {
    this.secret = secret
    this.required = required
    this.now = now
    this.maxRemembered = maxRemembered
    this.consumed = new Map()
  }

  inspectWithConsumptionStatus (token, { roomId, seat } = {}) {
    if (!token) {
      if (this.required) throw unauthorized('本环境要求匹配入桌票据')
      return { claims: null, consumed: false }
    }
    const claims = verifyCompactToken(token, this.secret, { now: this.now(), kind: 'game-ticket', audience: 'guandan-game' })
    if (!claims.jti || !claims.sub || !claims.matchId || !/^\d{6}$/.test(String(claims.roomId)) || !/^p[1-4]$/.test(String(claims.seat))) {
      throw unauthorized('入桌票据字段不完整')
    }
    if (!ticketRoomKinds.has(claims.roomKind)) throw unauthorized('入桌票据房间类型无效')
    if (!gameTicketPurposes.has(claims.purpose)) throw unauthorized('入桌票据用途无效')
    if (!validEntryAttemptId(claims.entryAttemptId)) throw unauthorized('入桌票据 entryAttemptId 无效')
    if (claims.roomKind === 'friend') {
      if (
        !Number.isSafeInteger(claims.roomExpiresAt) ||
        claims.roomExpiresAt < 0 ||
        (claims.purpose === 'entry' && claims.roomExpiresAt < claims.exp * 1000) ||
        claims.roomExpiresAt > this.now() + 30 * 24 * 60 * 60 * 1000
      ) throw unauthorized('好友房票据租约无效')
      canonicalFriendRoomSettings(claims.roomSettings)
    } else if (Object.hasOwn(claims, 'roomExpiresAt') || Object.hasOwn(claims, 'roomSettings')) {
      throw unauthorized('普通匹配票据不能携带好友房字段')
    }
    if (roomId && String(claims.roomId) !== String(roomId)) throw unauthorized('入桌票据房间不匹配')
    if (seat && claims.seat !== seat) throw unauthorized('入桌票据席位不匹配')
    const consumedClaims = this.consumed.get(claims.jti) || null
    if (consumedClaims) {
      const sameBinding = ['jti', 'sub', 'matchId', 'roomId', 'seat', 'roomKind', 'purpose', 'entryAttemptId', 'roomExpiresAt', 'exp'].every(key => consumedClaims[key] === claims[key]) &&
        roomSettingsFingerprint(consumedClaims.roomSettings) === roomSettingsFingerprint(claims.roomSettings)
      if (!sameBinding) throw unauthorized('入桌票据消费记录不一致')
    }
    return { claims, consumed: Boolean(consumedClaims) }
  }

  inspect (token, expected = {}) {
    const status = this.inspectWithConsumptionStatus(token, expected)
    if (status.consumed) throw unauthorized('入桌票据已使用')
    return status.claims
  }

  consume (claims) {
    if (!claims) return null
    if (this.consumed.has(claims.jti)) throw unauthorized('入桌票据已使用')
    this.consumed.set(claims.jti, structuredClone(claims))
    const nowSeconds = Math.floor(this.now() / 1000)
    for (const [jti, consumedClaims] of this.consumed) {
      if (consumedClaims.exp <= nowSeconds || this.consumed.size > this.maxRemembered) this.consumed.delete(jti)
      else if (this.consumed.size <= this.maxRemembered) break
    }
    return claims
  }

  verifyAndConsume (token, expected) {
    return this.consume(this.inspect(token, expected))
  }
}

export const gameResultSignature = (rawBody, secret, timestamp) =>
  createHmac('sha256', secret).update(`${timestamp}.${rawBody}`).digest('hex')

export const verifyGameResultSignature = ({ rawBody, signature, timestamp, secret, now = Date.now(), toleranceMs = 5 * 60_000 }) => {
  const parsedTimestamp = Number(timestamp)
  if (!Number.isFinite(parsedTimestamp) || Math.abs(now - parsedTimestamp) > toleranceMs) throw unauthorized('结算回调时间戳无效或已过期')
  if (!safeEqual(gameResultSignature(rawBody, secret, String(timestamp)), signature)) throw unauthorized('结算回调签名无效')
}

/**
 * 公开观战事件使用独立密钥和请求头。算法刻意与结算回调保持简单一致，
 * 但不能把 GAME_RESULT_SECRET 当作观战密钥使用，否则一个低权限事件写入方
 * 会同时获得结算入账权限。
 */
export const spectatorEventSignature = (rawBody, secret, timestamp) =>
  createHmac('sha256', secret).update(`${timestamp}.${rawBody}`).digest('hex')

export const verifySpectatorEventSignature = ({ rawBody, signature, timestamp, secret, now = Date.now(), toleranceMs = 5 * 60_000 }) => {
  const parsedTimestamp = Number(timestamp)
  if (!Number.isFinite(parsedTimestamp) || Math.abs(now - parsedTimestamp) > toleranceMs) throw unauthorized('观战事件时间戳无效或已过期')
  if (!safeEqual(spectatorEventSignature(rawBody, secret, String(timestamp)), signature)) throw unauthorized('观战事件签名无效')
}
