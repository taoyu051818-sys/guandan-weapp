const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('./support/typescript.cjs').loadTypeScript()
const root = path.resolve(__dirname, '..')
const moduleUnderTest = { exports: {} }
const code = ts.transpileModule(fs.readFileSync(path.join(root, 'assets/scripts/ui/LobbyLayoutPolicy.ts'), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText
new Function('module', 'exports', code)(moduleUnderTest, moduleUnderTest.exports)
const { resolveLobbyLayout, LOBBY_DESIGN } = moduleUnderTest.exports
for (const width of [960, 1280, 1600]) for (const height of [589, 720]) for (const inset of [0, 44]) {
  const w = width - 2 * inset, left = -width / 2 + inset, right = width / 2 - inset
  const frame = { width: w, height, left, right, top: height / 2, bottom: -height / 2 }
  const before = JSON.stringify(frame)
  const got = resolveLobbyLayout(frame)
  const scale = Math.min(w / 874, height / 402)
  assert.equal(got.scale, scale)
  for (const key of ['classic', 'friend', 'tournament', 'quick', 'account', 'shop']) {
    const design = LOBBY_DESIGN[key], rect = got[key]
    assert.equal(rect.width, design.width * scale)
    assert.equal(rect.height, design.height * scale)
    assert.ok(rect.x - rect.width / 2 >= left - .00001)
    assert.ok(rect.x + rect.width / 2 <= right + .00001)
    assert.ok(rect.y + rect.height / 2 <= frame.top + .00001)
    assert.ok(rect.y - rect.height / 2 >= frame.bottom - .00001)
    assert.deepEqual(got.point(design.left + design.width / 2, design.top + design.height / 2), { x: rect.x, y: rect.y })
  }
  assert.equal(JSON.stringify(frame), before)
  assert.equal(JSON.stringify(resolveLobbyLayout(frame)), JSON.stringify(got))
  assert.ok(got.classic.height > got.friend.height && got.friend.height > got.tournament.height)
  assert.ok(got.classic.x + got.classic.width / 2 < got.friend.x - got.friend.width / 2)
  assert.equal(got.account.width, 180 * scale)
  assert.equal(got.shop.width, 70 * scale)
}
assert.ok(Object.isFrozen(LOBBY_DESIGN))
const server = fs.readFileSync(path.join(root, 'tools/lobby-layout-lab/server.mjs'), 'utf8')
assert.match(server, /connect-src 'none'/)
assert.match(server, /server\.listen\(port, '127\.0\.0\.1'/)
console.log('Lobby shared geometry: approved 874×402 geometry, uniform scaling and local-only boundary passed')
