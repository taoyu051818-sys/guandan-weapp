const assert = require('node:assert/strict')
const path = require('node:path')
const { execFileSync } = require('node:child_process')
const { loadTs } = require('./support/load-typescript-module.cjs')
const root = path.resolve(__dirname, '..')
execFileSync(process.execPath, [path.join(root, 'scripts/verify-retirement.mjs')], { stdio: 'inherit' })

// New tournament entry delegates to the isolated center; retired pages stay absent.
const domains = new Map()
const mocks = {
  cc: { game: { on () {}, off () {} }, Game: { EVENT_HIDE: 'hide' } },
  '../ui/ProfileAvatar': { profileAvatarFrame () {} },
  './PageRouter': { PageRouter: class { current = 'menu'; constructor () {} } },
}
for (const name of ['ProfileSaveCoordinator', 'WechatProfileSync', 'WechatFriendRanking']) {
  const dependencies = name === 'WechatProfileSync' ? {
    './WechatProfileResult': loadTs(path.join(root, 'assets/scripts/services/WechatProfileResult.ts'), {}),
  } : {}
  mocks[`../services/${name}`] = loadTs(path.join(root, `assets/scripts/services/${name}.ts`), dependencies)
}
for (const name of ['FrontPageWalletState', 'FrontPagePlayerState', 'ProfileEditorModal', 'FriendRankingModal', 'ShopPageDomain', 'ReplayPageDomain', 'PlayerCenterPageDomain', 'MatchmakingPageDomain', 'LobbyPageDomain']) {
  mocks[`./front-pages/${name}`] = { [name]: class { constructor (dependencies) { domains.set(name, dependencies) } } }
}
let tournamentOpens = 0
mocks['./front-pages/TournamentCenterController'] = { TournamentCenterController: class {
  constructor (dependencies) { domains.set('TournamentCenterController', dependencies) }
  open () { tournamentOpens++ }
} }
const { FrontPageController } = loadTs(path.join(root, 'assets/scripts/scenes/FrontPageController.ts'), mocks)
const toasts = []
const shell = new FrontPageController({}, { snapshot: { settings: { effectQuality: 'full' } } }, {}, {}, { showToast: message => toasts.push(message) }, { configured: true }, {})
const token = shell.pageRequestToken
domains.get('LobbyPageDomain').showCompetition()
domains.get('LobbyPageDomain').showCompetition()
assert.equal(domains.get('MatchmakingPageDomain').showCompetition, undefined, 'matching cannot return to a retired tournament route')
assert.deepEqual(toasts, [])
assert.equal(tournamentOpens, 2, 'both entry taps route to the new tournament center')
assert.equal(shell.router.current, 'menu')
assert.equal(shell.pageRequestToken, token)
assert.equal(shell.openEffectLabTable, undefined, 'retired laboratory must have no shell entry')
assert.equal(shell.showEffectLab, undefined, 'retired laboratory must have no alternate drawer entry')
console.log('Retirement boundary regression passed: new tournament center delegates correctly; old pages stay retired')
