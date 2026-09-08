const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const projectRoot = path.resolve(__dirname, '..')
const read = relativePath => fs.readFileSync(path.join(projectRoot, relativePath), 'utf8')

const frontPage = read('assets/scripts/scenes/FrontPageController.ts')
const resize = frontPage.slice(frontPage.indexOf('public resize'), frontPage.indexOf('private readonly handleApplicationHide'))
const routeOwners = new Map([
  ['lobbyPage', ['menu', 'online', 'classic-rooms', 'friend-room-settings', 'lobby']],
  ['shopPage', ['shop', 'product']],
  ['playerCenterPage', ['player-center', 'season-tasks']],
  ['replayPage', ['replay-list', 'replay-detail']],
  ['matchmakingPage', ['matching']],
])

for (const [owner, routes] of routeOwners) {
  assert.match(resize, new RegExp(`this\\.${owner}\\.reflow\\(\\)`), `${owner} must own a resize-only render path`)
  for (const route of routes) assert.match(resize, new RegExp(`['"]${route}['"]`), `${route} must be routed during viewport reflow`)
}

const domains = [
  'LobbyPageDomain', 'ShopPageDomain', 'PlayerCenterPageDomain',
  'ReplayPageDomain', 'MatchmakingPageDomain',
]
for (const domain of domains) {
  const source = read(`assets/scripts/scenes/front-pages/${domain}.ts`)
  assert.match(source, /public reflow \(\): void/, `${domain} must expose an explicit presentation-only reflow`)
  const body = source.slice(source.indexOf('public reflow (): void'), source.indexOf('\n  }', source.indexOf('public reflow (): void')) + 4)
  assert.doesNotMatch(body, /issuePageRequest|\.gateways\.|createOrder|joinQueue|listProducts|listTournaments|getDashboard|listTasks/, `${domain}.reflow must not start remote work or a write`)
}

process.stdout.write('front-page viewport reflow regression checks passed\n')
