import { PlatformError, badRequest, notFound } from './errors.js'
import { OperationsService } from './operations-service.js'
import { adminSecurityHeaders, serveAdminStatic } from './admin-static.js'

const writeJson = (response, status, payload, headers) => {
  response.writeHead(status, { 'content-type': 'application/json; charset=utf-8', ...adminSecurityHeaders, ...headers })
  response.end(JSON.stringify(payload))
}
const readJson = async request => {
  if (!/^application\/json(?:\s*;|$)/i.test(request.headers['content-type'] || '')) throw new PlatformError(415, 'JSON_REQUIRED', '请求正文必须使用 application/json')
  const chunks = await new Promise((resolve, reject) => {
    const parts = []; let size = 0; let tooLarge = false
    request.on('data', chunk => {
      size += chunk.length
      if (!tooLarge && size > 16 * 1024) { tooLarge = true; parts.length = 0; reject(new PlatformError(413, 'BODY_TOO_LARGE', '请求正文过大')) }
      if (!tooLarge) parts.push(chunk)
    })
    request.on('end', () => { if (!tooLarge) resolve(parts) })
    request.on('error', reject)
  })
  let body
  try { body = JSON.parse(Buffer.concat(chunks).toString('utf8')) } catch { throw badRequest('INVALID_JSON', '请求正文必须是有效 JSON') }
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw badRequest('INVALID_JSON', '请求正文必须是 JSON 对象')
  return body
}
const idFrom = value => {
  let decoded
  try { decoded = decodeURIComponent(value) } catch { throw badRequest('INVALID_ID', '标识无效') }
  if (!decoded || decoded.length > 128 || /[\/\\\u0000-\u001f]/.test(decoded)) throw badRequest('INVALID_ID', '标识无效')
  return decoded
}

export function createOperationsHttpHandler ({ service, operations, adminAuth = null, corsOrigin = '*', logger = console }) {
  let domain = operations
  return async (request, response) => {
    const rawPath = String(request.url || '').split('?')[0]
    const isAdmin = rawPath === '/admin' || rawPath.startsWith('/admin/') || rawPath.startsWith('/api/v1/admin/')
    const isPlayer = /^\/api\/v1\/(messages|feedback)(?:\/|$)/.test(rawPath) || rawPath.startsWith('/api/v1/lobby/services/')
    if (!isAdmin && !isPlayer) return false
    const headers = isAdmin ? {} : { 'access-control-allow-origin': corsOrigin, vary: 'Origin' }
    const send = (data, status = 200, extra = {}) => writeJson(response, status, { ok: true, data, error: null }, { ...headers, ...extra })
    try {
      const url = new URL(request.url, 'http://platform.local')
      const route = url.pathname; const method = request.method || 'GET'
      if (isAdmin && !adminAuth) throw notFound('ADMIN_DISABLED', '管理后台未启用')
      // Reject dot-normalized/encoded paths before static routing or API dispatch.
      if (rawPath !== route || /%(?:2e|2f|5c)/i.test(rawPath)) throw notFound('ROUTE_NOT_FOUND', '接口不存在')
      if (isAdmin && (route === '/admin' || route.startsWith('/admin/'))) {
        await serveAdminStatic(request, response, route); return true
      }
      if (method === 'OPTIONS') {
        if (isAdmin) adminAuth.assertOrigin(request)
        response.writeHead(204, { ...adminSecurityHeaders, ...headers,
          'access-control-allow-methods': 'GET,POST,PATCH,OPTIONS',
          'access-control-allow-headers': isAdmin ? 'Content-Type,X-CSRF-Token' : 'Authorization,Content-Type,Idempotency-Key',
        }); response.end(); return true
      }
      domain ||= new OperationsService({ store: service.store, now: () => service.now(), createId: () => service.createId() })
      const query = Object.fromEntries(url.searchParams)
      const write = ['POST', 'PATCH', 'PUT', 'DELETE'].includes(method)
      if (isAdmin) {
        if (method === 'GET' && route === '/api/v1/admin/login-options') {
          send(adminAuth.loginOptions()); return true
        }
        if (method === 'POST' && route === '/api/v1/admin/session') {
          adminAuth.assertOrigin(request)
          const { token, session } = await adminAuth.login(request, await readJson(request))
          send({ admin: session.admin, csrfToken: session.csrfToken }, 200, { 'set-cookie': adminAuth.cookie(token) }); return true
        }
        if (method === 'GET' && route === '/api/v1/admin/session') {
          const session = adminAuth.session(request)
          send({ admin: session.admin, csrfToken: session.csrfToken }); return true
        }
        if (method === 'POST' && route === '/api/v1/admin/logout') {
          adminAuth.logout(request)
          send({ loggedOut: true }, 200, { 'set-cookie': adminAuth.cookie('', 0) }); return true
        }
        const roles = route === '/api/v1/admin/audit' ? ['admin'] : route.startsWith('/api/v1/admin/feedback') ? ['admin', 'operator', 'support'] : ['admin', 'operator']
        const actor = adminAuth.session(request, { write, roles }).admin
        if (route === '/api/v1/admin/announcements') {
          if (method === 'GET') { send(await domain.listAnnouncements(query)); return true }
          if (method === 'POST') { send({ announcement: await domain.createAnnouncement(actor, await readJson(request)) }); return true }
        }
        const announcement = route.match(/^\/api\/v1\/admin\/announcements\/([^/]+)$/)
        if (announcement && method === 'PATCH') { send({ announcement: await domain.updateAnnouncement(actor, idFrom(announcement[1]), await readJson(request)) }); return true }
        if (route === '/api/v1/admin/feedback' && method === 'GET') { send(await domain.listFeedback(actor, query)); return true }
        const reply = route.match(/^\/api\/v1\/admin\/feedback\/([^/]+)\/replies$/)
        if (reply && method === 'POST') { send({ feedback: await domain.replyFeedback(actor, idFrom(reply[1]), await readJson(request)) }); return true }
        const feedback = route.match(/^\/api\/v1\/admin\/feedback\/([^/]+)$/)
        if (feedback && method === 'PATCH') { send({ feedback: await domain.updateFeedback(actor, idFrom(feedback[1]), await readJson(request)) }); return true }
        if (route === '/api/v1/admin/features' && method === 'GET') { send({ items: await domain.listFeatures() }); return true }
        const feature = route.match(/^\/api\/v1\/admin\/features\/([^/]+)$/)
        if (feature && method === 'PATCH') { send({ feature: await domain.updateFeature(actor, idFrom(feature[1]), await readJson(request)) }); return true }
        if (route === '/api/v1/admin/audit' && method === 'GET') { send(await domain.listAudit(actor, query)); return true }
      } else {
        const feature = route.match(/^\/api\/v1\/lobby\/services\/([^/]+)$/)
        if (feature && method === 'GET') { send(await domain.getFeature(idFrom(feature[1]))); return true }
        const authorization = request.headers.authorization || ''
        const user = await service.authenticate(authorization.startsWith('Bearer ') ? authorization.slice(7).trim() : '')
        if (route === '/api/v1/messages' && method === 'GET') { send(await domain.listPlayerMessages(user.id, query)); return true }
        const message = route.match(/^\/api\/v1\/messages\/([^/]+)\/read$/)
        if (message && method === 'POST') { await domain.readPlayerMessage(user.id, idFrom(message[1])); send({ read: true }); return true }
        if (route === '/api/v1/feedback' && method === 'GET') { send(await domain.listPlayerFeedback(user.id, query)); return true }
        if (route === '/api/v1/feedback' && method === 'POST') { send({ feedback: await domain.submitFeedback(user.id, await readJson(request), request.headers['idempotency-key']) }); return true }
      }
      throw notFound('ROUTE_NOT_FOUND', '接口不存在')
    } catch (error) {
      const known = error instanceof PlatformError
      if (!known) logger.error?.('Operations API error', { name: error?.name, code: error?.code })
      if (!response.headersSent) writeJson(response, known ? error.status : 500, { ok: false, data: null, error: { code: known ? error.code : 'INTERNAL_ERROR', message: known ? error.message : '服务暂时不可用', ...(known && error.details !== undefined ? { details: error.details } : {}) } }, headers)
    }
    return true
  }
}
