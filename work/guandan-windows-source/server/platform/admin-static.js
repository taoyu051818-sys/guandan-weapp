import { constants } from 'node:fs'
import { open, realpath } from 'node:fs/promises'
import { resolve, sep } from 'node:path'
import { notFound } from './errors.js'
import { adminStaticRoot as root } from './admin-config.js'

const assets = new Map([
  ['index.html', 'text/html; charset=utf-8'], ['styles.css', 'text/css; charset=utf-8'],
  ...['app', 'api', 'model', 'dom', 'dialog', 'login', 'announcements', 'feedback', 'features', 'audit'].map(name => [`src/${name}.js`, 'text/javascript; charset=utf-8']),
])
export const adminSecurityHeaders = Object.freeze({
  'cache-control': 'no-store',
  'x-content-type-options': 'nosniff',
  'x-frame-options': 'DENY',
  'referrer-policy': 'no-referrer',
  'cross-origin-resource-policy': 'same-origin',
  'permissions-policy': 'camera=(), microphone=(), geolocation=()',
  'content-security-policy': "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self'; font-src 'self'; base-uri 'none'; object-src 'none'; frame-ancestors 'none'; form-action 'self'",
})

export async function serveAdminStatic (request, response, pathname) {
  if (!['GET', 'HEAD'].includes(request.method)) throw notFound('ROUTE_NOT_FOUND', '页面不存在')
  if (pathname === '/admin') {
    response.writeHead(308, { ...adminSecurityHeaders, location: '/admin/' }); response.end(); return
  }
  const asset = pathname === '/admin/' ? 'index.html' : pathname.slice('/admin/'.length)
  if (!assets.has(asset)) throw notFound('ROUTE_NOT_FOUND', '页面不存在')
  const file = resolve(root, asset)
  let handle
  try {
    const resolvedRoot = await realpath(root)
    const resolvedFile = await realpath(file)
    if (!resolvedFile.startsWith(`${resolvedRoot}${sep}`)) throw notFound('ROUTE_NOT_FOUND', '页面不存在')
    handle = await open(file, constants.O_RDONLY | (constants.O_NOFOLLOW || 0))
    const stats = await handle.stat()
    if (!stats.isFile() || stats.size > 512 * 1024) throw notFound('ROUTE_NOT_FOUND', '页面不存在')
    const content = await handle.readFile()
    response.writeHead(200, { ...adminSecurityHeaders, 'content-type': assets.get(asset), 'content-length': content.length })
    response.end(request.method === 'HEAD' ? undefined : content)
  } catch (error) {
    if (['ENOENT', 'ELOOP', 'ENOTDIR'].includes(error?.code)) throw notFound('ROUTE_NOT_FOUND', '页面不存在')
    throw error
  } finally { await handle?.close() }
}
