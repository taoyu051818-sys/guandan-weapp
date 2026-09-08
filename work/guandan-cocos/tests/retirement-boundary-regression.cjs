const assert = require('node:assert/strict')
const path = require('node:path')
const { execFileSync } = require('node:child_process')
const { loadTs } = require('./support/load-typescript-module.cjs')
const root = path.resolve(__dirname, '..')
execFileSync(process.execPath, [path.join(root, 'scripts/verify-retirement.mjs')], { stdio: 'inherit' })

// Run the actual shell with inert domain dependencies. Clicking tournaments must
// only show the toast: no page change, network request or request-token bump.
const domains = new Map()
const mocks = {
  cc: { game: { on () {}, off () {} }, Game: { EVENT_HIDE: 'hide' } },
  '../ui/ProfileAvatar': { profileAvatarFrame () {} },
  './PageRouter': { PageRouter: class { current = 'menu'; constructor () {} } },
}
for (const name of ['FrontPageWalletState', 'FrontPagePlayerState', 'ProfileEditorModal', 'ShopPageDomain', 'ReplayPageDomain', 'PlayerCenterPageDomain', 'MatchmakingPageDomain', 'LobbyPageDomain']) {
  mocks[`./front-pages/${name}`] = { [name]: class { constructor (dependencies) { domains.set(name, dependencies) } } }
}
const { FrontPageController } = loadTs(path.join(root, 'assets/scripts/scenes/FrontPageController.ts'), mocks)
const toasts = []
const shell = new FrontPageController({}, { snapshot: { settings: { effectQuality: 'full' } } }, {}, {}, { showToast: message => toasts.push(message) }, { configured: true }, {})
const token = shell.pageRequestToken
domains.get('LobbyPageDomain').showCompetition()
domains.get('LobbyPageDomain').showCompetition()
assert.equal(domains.get('MatchmakingPageDomain').showCompetition, undefined, 'matching cannot return to a retired tournament route')
assert.deepEqual(toasts, ['筹备中', '筹备中'])
assert.equal(shell.router.current, 'menu')
assert.equal(shell.pageRequestToken, token)
assert.equal(shell.openEffectLabTable, undefined, 'retired laboratory must have no shell entry')
assert.equal(shell.showEffectLab, undefined, 'retired laboratory must have no alternate drawer entry')
console.log('Retirement boundary regression passed: repeated tournament taps remain toast-only')
