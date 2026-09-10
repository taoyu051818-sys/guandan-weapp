import { PlatformError, badRequest, notFound } from './errors.js'
import { verifyGameResultSignature, verifySpectatorEventSignature } from './crypto.js'
import { readProfileAvatar, validateProfilePatch } from './profile-avatar.js'
import { isUploadedAvatar } from './profile-upload.js'

const jsonHeaders = { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }
const success = (data) => ({ ok: true, data, error: null })
const failure = (error) => ({ ok: false, data: null, error })
const writeJson = (response, status, payload, corsOrigin) => {
  response.writeHead(status, {
    ...jsonHeaders,
    'access-control-allow-origin': corsOrigin,
    vary: 'Origin',
  })
  response.end(JSON.stringify(payload))
}
const readBody = (request, maxBytes = 1_048_576) => new Promise((resolve, reject) => {
  const chunks = []
  let size = 0
  request.on('data', chunk => {
    size += chunk.length
    if (size > maxBytes) {
      reject(badRequest('BODY_TOO_LARGE', '请求正文不能超过1MB'))
      request.destroy()
      return
    }
    chunks.push(chunk)
  })
  request.on('end', () => {
    const rawBody = Buffer.concat(chunks).toString('utf8')
    if (!rawBody) return resolve({ rawBody, body: {} })
    try { resolve({ rawBody, body: JSON.parse(rawBody) }) } catch { reject(badRequest('INVALID_JSON', '请求正文必须是有效JSON')) }
  })
  request.on('error', reject)
})
const bearer = (request) => {
  const authorization = request.headers.authorization || ''
  return authorization.startsWith('Bearer ') ? authorization.slice(7).trim() : ''
}

export const createPlatformHttpHandler = ({ service, gameResultSecret, spectatorEventSecret, wxCodeVerifier, enableDevLogin = false, corsOrigin = '*', now = () => Date.now(), logger = console }) => async (request, response) => {
  if (request.method === 'OPTIONS') {
    response.writeHead(204, {
      'access-control-allow-origin': corsOrigin,
      'access-control-allow-methods': 'GET,POST,PATCH,OPTIONS',
      'access-control-allow-headers': 'Authorization,Content-Type,Idempotency-Key,X-Game-Event-Id,X-Game-Timestamp,X-Game-Signature,X-Spectator-Event-Id,X-Spectator-Timestamp,X-Spectator-Signature',
      'access-control-max-age': '600',
    })
    response.end()
    return
  }

  try {
    const url = new URL(request.url, 'http://platform.local')
    const route = url.pathname
    const method = request.method || 'GET'
    const requireUser = async () => service.authenticate(bearer(request))

    if (method === 'GET' && route === '/api/v1/health') {
      return writeJson(response, 200, success({ status: 'ok', time: now() }), corsOrigin)
    }
    if (method === 'POST' && route === '/api/v1/auth/dev-login') {
      if (!enableDevLogin) throw new PlatformError(403, 'DEV_LOGIN_DISABLED', '开发登录未启用')
      const { body } = await readBody(request)
      return writeJson(response, 200, success(await service.devLogin(body)), corsOrigin)
    }
    if (method === 'POST' && route === '/api/v1/auth/wx-login') {
      const { body } = await readBody(request)
      return writeJson(response, 200, success(await service.wxLogin(body, wxCodeVerifier)), corsOrigin)
    }
    if (method === 'GET' && route === '/api/v1/profile') {
      const user = await requireUser()
      return writeJson(response, 200, success({ user: await service.getProfile(user.id) }), corsOrigin)
    }
    if ((method === 'PATCH' || method === 'POST') && route === '/api/v1/profile') {
      const user = await requireUser()
      const { body } = await readBody(request)
      validateProfilePatch(body)
      return writeJson(response, 200, success({ user: await service.updateProfile(user.id, body) }), corsOrigin)
    }
    if ((method === 'GET' || method === 'POST') && route === '/api/v1/profile/avatar') {
      const user = await requireUser()
      const profile = method === 'POST' ? (await readBody(request)).body : await service.getProfile(user.id)
      if (method === 'POST') validateProfilePatch(profile)
      const dataUri = isUploadedAvatar(profile.avatarUrl) ? await service.getUploadedAvatarImage(profile.avatarUrl) : await readProfileAvatar(profile.avatarUrl)
      return writeJson(response, 200, success({ avatarUrl: profile.avatarUrl || '', dataUri }), corsOrigin)
    }
    if (method === 'GET' && route === '/api/v1/me/dashboard') {
      const user = await requireUser()
      return writeJson(response, 200, success(await service.getPlayerDashboard(user.id)), corsOrigin)
    }
    if (method === 'GET' && route === '/api/v1/season/tasks') {
      const user = await requireUser()
      return writeJson(response, 200, success(await service.listSeasonTasks(user.id)), corsOrigin)
    }
    const taskClaimMatch = method === 'POST' && route.match(/^\/api\/v1\/season\/tasks\/([^/]+)\/claim$/)
    if (taskClaimMatch) {
      const user = await requireUser()
      const claim = await service.claimSeasonTask(user.id, decodeURIComponent(taskClaimMatch[1]), request.headers['idempotency-key'])
      return writeJson(response, 200, success({ claim }), corsOrigin)
    }
    if (method === 'GET' && route === '/api/v1/wallet') {
      const user = await requireUser()
      const limit = Number(url.searchParams.get('limit') || 20)
      return writeJson(response, 200, success(await service.getWallet(user.id, limit)), corsOrigin)
    }
    if (method === 'GET' && route === '/api/v1/products') {
      return writeJson(response, 200, success({ products: await service.listProducts() }), corsOrigin)
    }
    if (method === 'POST' && route === '/api/v1/orders/redeem') {
      const user = await requireUser()
      const { body } = await readBody(request)
      const order = await service.redeem(user.id, body, request.headers['idempotency-key'])
      return writeJson(response, 200, success({ order }), corsOrigin)
    }
    if (method === 'GET' && route === '/api/v1/tournaments') {
      const token = bearer(request)
      const user = token ? await service.authenticate(token) : null
      return writeJson(response, 200, success({ tournaments: await service.listTournaments(user?.id) }), corsOrigin)
    }
    const enrollmentMatch = method === 'POST' && route.match(/^\/api\/v1\/tournaments\/([^/]+)\/enroll$/)
    if (enrollmentMatch) {
      const user = await requireUser()
      const { body } = await readBody(request)
      const enrollment = await service.enrollTournament(user.id, decodeURIComponent(enrollmentMatch[1]), request.headers['idempotency-key'], body)
      return writeJson(response, 200, success({ enrollment }), corsOrigin)
    }
    const withdrawalMatch = method === 'POST' && route.match(/^\/api\/v1\/tournaments\/([^/]+)\/withdraw$/)
    if (withdrawalMatch) {
      const user = await requireUser()
      return writeJson(response, 200, success(await service.withdrawTournament(user.id, decodeURIComponent(withdrawalMatch[1]), request.headers['idempotency-key'])), corsOrigin)
    }
    const checkInMatch = method === 'POST' && route.match(/^\/api\/v1\/tournaments\/([^/]+)\/check-in$/)
    if (checkInMatch) {
      const user = await requireUser()
      return writeJson(response, 200, success(await service.checkInTournament(user.id, decodeURIComponent(checkInMatch[1]))), corsOrigin)
    }
    const tournamentStateMatch = method === 'GET' && route.match(/^\/api\/v1\/tournaments\/([^/]+)\/state$/)
    if (tournamentStateMatch) {
      const user = await requireUser()
      return writeJson(response, 200, success(await service.getTournamentState(user.id, decodeURIComponent(tournamentStateMatch[1]))), corsOrigin)
    }
    const standingsMatch = method === 'GET' && route.match(/^\/api\/v1\/tournaments\/([^/]+)\/standings$/)
    if (standingsMatch) {
      const token = bearer(request)
      const user = token ? await service.authenticate(token) : null
      return writeJson(response, 200, success(await service.listTournamentStandings(decodeURIComponent(standingsMatch[1]), user?.id)), corsOrigin)
    }
    if (method === 'GET' && route === '/api/v1/replays') {
      const user = await requireUser()
      return writeJson(response, 200, success({ replays: await service.listReplays(user.id) }), corsOrigin)
    }
    const replayMatch = method === 'GET' && route.match(/^\/api\/v1\/replays\/([^/]+)$/)
    if (replayMatch) {
      const user = await requireUser()
      return writeJson(response, 200, success({ replay: await service.getReplay(user.id, decodeURIComponent(replayMatch[1])) }), corsOrigin)
    }
    if (method === 'GET' && route === '/api/v1/spectate') {
      return writeJson(response, 200, success(await service.listSpectatorFeeds(url.searchParams.get('delaySeconds'))), corsOrigin)
    }
    const spectatorMatch = method === 'GET' && route.match(/^\/api\/v1\/spectate\/([^/]+)$/)
    if (spectatorMatch) {
      return writeJson(response, 200, success({ feed: await service.getSpectatorFeed(decodeURIComponent(spectatorMatch[1]), url.searchParams.get('delaySeconds')) }), corsOrigin)
    }
    if (method === 'POST' && route === '/api/v1/merchants/apply') {
      const user = await requireUser()
      const { body } = await readBody(request)
      return writeJson(response, 200, success({ merchant: await service.applyMerchant(user.id, body) }), corsOrigin)
    }
    if (method === 'GET' && route === '/api/v1/merchants/me') {
      const user = await requireUser()
      return writeJson(response, 200, success(await service.getMerchantConsole(user.id)), corsOrigin)
    }
    if (method === 'POST' && route === '/api/v1/merchants/stores') {
      const user = await requireUser()
      const { body } = await readBody(request)
      return writeJson(response, 200, success({ store: await service.createMerchantStore(user.id, body, request.headers['idempotency-key']) }), corsOrigin)
    }
    if (method === 'POST' && route === '/api/v1/merchants/employees') {
      const user = await requireUser()
      const { body } = await readBody(request)
      return writeJson(response, 200, success({ employee: await service.addMerchantEmployee(user.id, body) }), corsOrigin)
    }
    if (method === 'POST' && route === '/api/v1/merchants/points/grant') {
      const user = await requireUser()
      const { body } = await readBody(request)
      return writeJson(response, 200, success({ grant: await service.grantMerchantPoints(user.id, body, request.headers['idempotency-key']) }), corsOrigin)
    }
    if (method === 'POST' && route === '/api/v1/friend-rooms/create') {
      const user = await requireUser()
      const { body } = await readBody(request)
      return writeJson(response, 200, success({ entry: await service.createFriendRoom(user.id, body) }), corsOrigin)
    }
    if (method === 'POST' && route === '/api/v1/friend-rooms/active') {
      const user = await requireUser()
      const { body } = await readBody(request)
      return writeJson(response, 200, success({ entry: await service.recoverActiveFriendRoom(user.id, body) }), corsOrigin)
    }
    if (method === 'POST' && route === '/api/v1/matches/recover') {
      const user = await requireUser()
      const { body } = await readBody(request)
      return writeJson(response, 200, success({ entry: await service.recoverActiveMatch(user.id, body) }), corsOrigin)
    }
    if (method === 'POST' && route === '/api/v1/friend-rooms/join') {
      const user = await requireUser()
      const { body } = await readBody(request)
      return writeJson(response, 200, success({ entry: await service.joinFriendRoom(user.id, body) }), corsOrigin)
    }
    if (method === 'POST' && route === '/api/v1/friend-rooms/join-by-number') {
      const user = await requireUser()
      const { body } = await readBody(request)
      return writeJson(response, 200, success({ entry: await service.joinFriendRoomByNumber(user.id, body) }), corsOrigin)
    }
    if (method === 'POST' && route === '/api/v1/match/join') {
      const user = await requireUser()
      const { body } = await readBody(request)
      return writeJson(response, 200, success({ match: await service.joinMatch(user.id, body) }), corsOrigin)
    }
    if (method === 'GET' && route === '/api/v1/match/status') {
      const user = await requireUser()
      const matchId = url.searchParams.get('matchId') || ''
      if (!matchId) throw badRequest('MATCH_ID_REQUIRED', 'matchId 必填')
      return writeJson(response, 200, success({ match: await service.getMatchStatus(user.id, matchId) }), corsOrigin)
    }
    if (method === 'POST' && route === '/api/v1/match/cancel') {
      const user = await requireUser()
      const { body } = await readBody(request)
      if (!body.matchId) throw badRequest('MATCH_ID_REQUIRED', 'matchId 必填')
      return writeJson(response, 200, success({ match: await service.cancelMatch(user.id, body.matchId) }), corsOrigin)
    }
    if (method === 'POST' && route === '/api/v1/game/results') {
      const { rawBody, body } = await readBody(request)
      const eventId = String(request.headers['x-game-event-id'] || '')
      verifyGameResultSignature({
        rawBody,
        signature: request.headers['x-game-signature'],
        timestamp: request.headers['x-game-timestamp'],
        secret: gameResultSecret,
        now: now(),
      })
      return writeJson(response, 200, success({ result: await service.acceptGameResult(eventId, body) }), corsOrigin)
    }
    if (method === 'POST' && route === '/api/v1/game/spectator-events') {
      const { rawBody, body } = await readBody(request, 32 * 1024)
      const eventId = String(request.headers['x-spectator-event-id'] || '')
      verifySpectatorEventSignature({
        rawBody,
        signature: request.headers['x-spectator-signature'],
        timestamp: request.headers['x-spectator-timestamp'],
        secret: spectatorEventSecret,
        now: now(),
      })
      if (body?.type === 'game-start' || body?.type === 'match-ended' || body?.type === 'seat-left' || body?.type === 'room-closed') {
        const lifecycleEventId = String(request.headers['x-game-event-id'] || '')
        verifyGameResultSignature({
          rawBody,
          signature: request.headers['x-game-signature'],
          timestamp: request.headers['x-game-timestamp'],
          secret: gameResultSecret,
          now: now(),
        })
        if (lifecycleEventId !== eventId) throw badRequest('EVENT_ID_MISMATCH', '牌桌生命周期事件的高权限事件ID不一致')
      }
      const accepted = body?.type === 'game-start'
        ? await service.claimGameStart(eventId, body)
        : await service.acceptSpectatorEvent(eventId, body)
      return writeJson(response, 200, success({ event: accepted }), corsOrigin)
    }
    throw notFound('ROUTE_NOT_FOUND', '接口不存在')
  } catch (error) {
    const known = error instanceof PlatformError
    if (!known) logger.error?.('Platform API error', error)
    const status = known ? error.status : 500
    const payload = known
      ? { code: error.code, message: error.message, ...(error.details === undefined ? {} : { details: error.details }) }
      : { code: 'INTERNAL_ERROR', message: '服务暂时不可用' }
    if (!response.headersSent) writeJson(response, status, failure(payload), corsOrigin)
  }
}
