const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')
const root = path.resolve(__dirname, '..')
const read = file => fs.readFileSync(path.join(root, file), 'utf8')
// Historical source identities: observed before the September 2 redesign.
// September 6 follow-up is approved. Keep the frozen source exact while testing
// candidate runtime behavior separately, so historical hashes do not prohibit polish.
const baseline = {
  'LobbyPageDomain.ts': '22a2971a52e07598c6d3e72207f0e1e9830a52cf',
  'LobbyPlayerProfilePresenter.ts': '19edb54d7c5aa136fa450d9a49a29eef26ae7cc2',
  'LobbyPageCatalog.ts': '2b634bcb6b019b02d5f7d35a95042ba606b0787d',
}
for (const [file, expected] of Object.entries(baseline)) {
  const source = read('art-source/ui-recovery/aug30-baseline/' + file + '.txt')
  const hash = crypto.createHash('sha1').update('blob ' + Buffer.byteLength(source) + '\0').update(source).digest('hex')
  assert.equal(hash, expected, file + ' must match the requested historical design source exactly')
}
const lobby = read('assets/scripts/scenes/front-pages/LobbyPageDomain.ts')
const layout = read('assets/scripts/ui/LobbyLayoutPolicy.ts')
assert.match(lobby, /resolveLobbyLayout\(/)
assert.match(layout, /width: 874, height: 402/)
assert.match(layout, /left: 4, top: 6, width: 180, height: 58/)
const view = read('assets/scripts/ui/LobbyMenuView.ts')
assert.match(lobby, /renderLobbyShop\(ui, layout, LOBBY_ART.shopChick/)
assert.doesNotMatch(lobby, /LobbySceneryScrim|LobbyBottomBand|renderLobbyLanding|coastalIcon/)
assert.equal(fs.existsSync(path.join(root, 'assets/scripts/scenes/front-pages/LobbyLandingView.ts')), false)
for (const file of ['entry-classic.jpg', 'entry-friend.jpg', 'entry-tournament.jpg', 'shop-float-chick.png']) {
  assert.ok(fs.existsSync(path.join(root, 'assets/game-assets/ui/lobby', file)), file)
}
// Restore appearance, not the old mock commerce/network implementation.
const front = read('assets/scripts/scenes/FrontPageController.ts')
assert.match(front, /showCompetition: \(\) => this\.tournamentPage\.open\(\)/)
assert.match(front, /showShop: \(\) => this\.shopPage\.showPreview\(\)/)
assert.match(lobby, /recoverActiveMatch\(\)/)
assert.match(view, /筹备中/)
assert.doesNotMatch(lobby, /商品预览/, 'shop shortcut must not restore the removed subtitle')
assert.match(view, /'商城'/, 'keep the shop title')
assert.match(view, /makeInteractive\(root, action, .95\)/, 'keep the original shop click target and action')
console.log('August 30 lobby source, original artwork and current service boundaries verified')
