import http from 'node:http'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'

const directory = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(directory, '../..')
const require = createRequire(import.meta.url)
const ts = require('../../tests/support/typescript.cjs').loadTypeScript()
const assets = {
  background: 'backgrounds/lobby-lingshui-coast-v1.jpg',
  classic: 'ui/lobby/entry-classic.jpg', friend: 'ui/lobby/entry-friend.jpg',
  tournament: 'ui/lobby/entry-tournament.jpg', shop: 'ui/lobby/shop-float-chick.png',
  coin: 'ui/lobby/coin.png', avatar: 'ui/common/default-avatar.jpg',
}
const shared = ['LobbyLayoutPolicy', 'SafeAreaLayout', 'TableLayoutOverlapAudit']
const routes = new Map([
  ['/', ['index.html', 'text/html']], ['/app.js', ['app.js', 'text/javascript']],
  ['/style.css', ['style.css', 'text/css']],
  ['/candidate02.js', ['candidate02.js', 'text/javascript']], ['/flows.js', ['flows.js', 'text/javascript']],
])
const port = Number(process.env.LOBBY_LAB_PORT || 18742)
const server = http.createServer(async (req, res) => {
  // Explicit allowlist: never expose the repository, credentials or game services.
  res.setHeader('Cache-Control', 'no-store')
  res.setHeader('X-Content-Type-Options', 'nosniff')
  res.setHeader('Content-Security-Policy', "default-src 'self'; connect-src 'none'; img-src 'self' blob:; script-src 'self'; style-src 'self' 'unsafe-inline'; object-src 'none'; frame-ancestors 'none'")
  if (!['GET', 'HEAD'].includes(req.method)) { res.writeHead(405); res.end(); return }
  try {
    const pathname = new URL(req.url, 'http://localhost').pathname
    let body, mime
    if (routes.has(pathname)) {
      const [file, type] = routes.get(pathname)
      body = await readFile(path.join(directory, file)); mime = type
    } else if (pathname.startsWith('/assets/') && Object.hasOwn(assets, pathname.slice(8))) {
      const file = assets[pathname.slice(8)]
      body = await readFile(path.join(root, 'assets/game-assets', file))
      mime = file.endsWith('.png') ? 'image/png' : 'image/jpeg'
    } else {
      const name = shared.find(name => pathname === `/shared/${name}.js`)
      if (!name) { res.writeHead(404); res.end('Not found'); return }
      const source = await readFile(name === 'LobbyLayoutPolicy' ? path.join(directory, 'baseline-layout.ts') : path.join(root, 'assets/scripts/ui', name + '.ts'), 'utf8')
      body = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ES2020, target: ts.ScriptTarget.ES2020 } }).outputText
      mime = 'text/javascript'
    }
    res.setHeader('Content-Type', mime + (mime.startsWith('text/') ? '; charset=utf-8' : ''))
    res.writeHead(200); res.end(req.method === 'HEAD' ? undefined : body)
  } catch (error) { console.error(error.message); res.writeHead(500); res.end('Local preview file unavailable') }
})
server.listen(port, '127.0.0.1', () => console.log(`Lobby layout lab: http://localhost:${port}/`))
