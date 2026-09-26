import http from 'node:http'
import { readFile, realpath, stat } from 'node:fs/promises'
import { dirname, extname, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { injectWebRuntimeConfig } from './runtime-client-config.mjs'

// Local operations smoke only: fixed loopback endpoints, never a deployment server.
if (process.env.NODE_ENV === 'production') throw new Error('Operations preview is disabled in production.')
const host = '127.0.0.1', port = 18744, authority = `${host}:${port}`
const origin = `http://${authority}`
const build = await realpath(resolve(dirname(fileURLToPath(import.meta.url)), '../build/web-desktop'))
const config = { version: 1, platformEndpoint: origin, lobbyEndpoint: '',
  platformAllowDevelopmentLogin: true, platformAllowInsecureEndpoint: true, platformAllowInsecureGameEndpoint: false }
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.css': 'text/css; charset=utf-8', '.wasm': 'application/wasm',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon', '.ttf': 'font/ttf', '.woff': 'font/woff', '.woff2': 'font/woff2',
  '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg', '.wav': 'audio/wav', '.mp4': 'video/mp4' }
const headers = { 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', 'referrer-policy': 'same-origin' }
const fail = (response, status, message) => {
  if (response.headersSent) { response.destroy(); return }
  response.writeHead(status, { ...headers, 'content-type': 'application/json; charset=utf-8' })
  response.end(JSON.stringify({ ok: false, data: null, error: { code: 'LOCAL_PREVIEW', message } }))
}

function requestPath (url) {
  if (!url.startsWith('/') || url.startsWith('//') || /[\\\u0000-\u0020\u007f]/.test(url)) throw Error('Invalid request target')
  const path = decodeURIComponent(url.split('?')[0])
  if (/[\\%#\u0000-\u001f\u007f]/.test(path) || path.split('/').some(part => part === '.' || part === '..')) throw Error('Invalid path')
  return path
}

function proxyPlayer (request, response) {
  // Never forward cookies, arbitrary Host headers, or caller-selected destinations.
  const forwarded = {}
  for (const name of ['accept', 'content-type', 'authorization', 'idempotency-key']) {
    if (typeof request.headers[name] === 'string') forwarded[name] = request.headers[name]
  }
  const upstream = http.request({ hostname: host, port: 18743, path: request.url, method: request.method,
    headers: forwarded, timeout: 10000 }, incoming => {
    response.writeHead(incoming.statusCode || 502, { ...headers,
      'content-type': incoming.headers['content-type'] || 'application/json; charset=utf-8' })
    incoming.on('error', () => response.destroy())
    incoming.pipe(response)
  })
  upstream.on('timeout', () => upstream.destroy(Error('timeout')))
  upstream.on('error', () => fail(response, 502, 'Isolated operations API unavailable on 127.0.0.1:18743'))
  request.on('aborted', () => upstream.destroy())
  response.on('close', () => { if (!response.writableEnded) upstream.destroy() })
  request.pipe(upstream)
}

async function serveBuild (request, response, path) {
  if (!['GET', 'HEAD'].includes(request.method)) { fail(response, 405, 'Static files accept GET/HEAD only'); return }
  let target
  try { target = await realpath(resolve(build, '.' + (path === '/' ? '/index.html' : path))) }
  catch { fail(response, 404, 'Build asset not found'); return }
  const within = relative(build, target)
  if (!within || within === '..' || within.startsWith('..' + sep) || resolve(build, within) !== target) {
    fail(response, 403, 'Path outside build denied'); return
  }
  if (!(await stat(target)).isFile()) { fail(response, 404, 'Build asset not found'); return }
  let body = await readFile(target)
  if (within === 'index.html') body = Buffer.from(injectWebRuntimeConfig(body.toString('utf8'), config))
  response.writeHead(200, { ...headers, 'content-type': types[extname(target).toLowerCase()] || 'application/octet-stream', 'content-length': body.length })
  response.end(request.method === 'HEAD' ? undefined : body)
}

// Fail early for an incomplete/non-Cocos build; HTML is never written back to disk.
injectWebRuntimeConfig(await readFile(resolve(build, 'index.html'), 'utf8'), config)
const server = http.createServer(async (request, response) => {
  if (request.headers.host !== authority) { fail(response, 403, 'Use the fixed loopback preview address'); return }
  if (request.headers.origin && request.headers.origin !== origin) { fail(response, 403, 'Cross-origin requests denied'); return }
  let path
  try { path = requestPath(request.url || '') } catch { fail(response, 400, 'Unsafe request path'); return }
  if (/^\/api\/v1\/admin(?:\/|$)/i.test(path) || /^\/admin(?:\/|$)/i.test(path)) { fail(response, 403, 'Admin access is not proxied'); return }
  if (path.startsWith('/api/v1/')) {
    if (!['GET', 'HEAD', 'POST', 'PATCH', 'DELETE', 'OPTIONS'].includes(request.method)) { fail(response, 405, 'Method denied'); return }
    proxyPlayer(request, response); return
  }
  if (path.startsWith('/api/')) { fail(response, 404, 'Only player /api/v1/ requests are proxied'); return }
  try { await serveBuild(request, response, path) } catch { fail(response, 500, 'Unable to read build asset') }
})
server.on('upgrade', (_request, socket) => socket.destroy())
server.on('connect', (_request, socket) => socket.destroy())
server.on('error', error => { console.error(`Operations preview failed: ${error.code || error.message}`); process.exitCode = 1 })
server.listen(port, host, () => console.log(`Operations game preview: ${origin} (player API only -> http://127.0.0.1:18743; no game sockets)`))
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => server.close(() => process.exit(0)))
