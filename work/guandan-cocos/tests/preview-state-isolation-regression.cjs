'use strict'
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('./support/typescript.cjs').loadTypeScript()
const root = path.resolve(__dirname, '../assets/scripts')
require.extensions['.ts'] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText, filename)
const { createFrontPagePreviewData } = require(path.join(root, 'development/FrontPagePreviewData.ts'))
const { createDevelopmentGateways, SAMPLE_DASHBOARD, SAMPLE_PRODUCTS } = require(path.join(root, 'services/DevelopmentApis.ts'))
const { DevelopmentTournamentGateway } = require('../migration/platform/RetiredDevelopmentApis.ts')
const { FrontPagePlayerState } = require(path.join(root, 'scenes/front-pages/FrontPagePlayerState.ts'))

async function test () {
  const first = createFrontPagePreviewData()
  const second = createFrontPagePreviewData()
  assert.notEqual(first.dashboard, second.dashboard)
  assert.notEqual(first.products[0], second.products[0])
  assert.throws(() => { first.dashboard.user.displayName = 'polluted' }, TypeError)
  assert.throws(() => first.dashboard.recentMatches.push({}), TypeError)
  assert.throws(() => { first.products[0].stock = 0 }, TypeError)
  assert.throws(() => { SAMPLE_DASHBOARD.user.displayName = 'polluted' }, TypeError)
  assert.throws(() => SAMPLE_PRODUCTS.pop(), TypeError)
  const player = new FrontPagePlayerState(false, first.dashboard)
  const old = player.dashboard
  const profile = { ...first.dashboard.user, displayName: 'new-name' }
  player.updateProfile(profile)
  profile.displayName = 'mutated-caller'
  assert.equal(player.profile.displayName, 'new-name')
  assert.equal(player.dashboard.user.displayName, 'new-name')
  assert.equal(old.user.displayName, second.dashboard.user.displayName, 'published snapshots cannot change later')
  assert.throws(() => { player.dashboard.user.displayName = 'bypass' }, TypeError)
  assert.throws(() => { player.dashboard = null }, TypeError)
  player.invalidate()
  assert.equal(player.profile, null)
  assert.equal(player.dashboard, null)
  assert.equal(new FrontPagePlayerState(true, first.dashboard).dashboard, null, 'production has no sample fallback')
  const a = createDevelopmentGateways()
  const b = createDevelopmentGateways()
  await a.auth.updateProfile({ displayName: 'session-a' })
  assert.equal((await a.playerCenter.getDashboard()).user.displayName, 'session-a')
  assert.equal((await b.auth.getProfile()).displayName, second.dashboard.user.displayName)
  const leaked = await a.playerCenter.getDashboard()
  leaked.user.displayName = 'outside-write'
  leaked.recentMatches.push({})
  assert.equal((await a.auth.getProfile()).displayName, 'session-a')
  assert.equal((await a.playerCenter.getDashboard()).recentMatches.length, 0)
  assert.equal('shop' in a, false, 'player previews have no ordering gateway')
  assert.equal('tournaments' in a, false, 'player previews must not construct retired tournament services')
  const tournaments = new DevelopmentTournamentGateway()
  const state = await tournaments.getState('rookie-cup')
  state.tournament.name = 'outside-write'
  assert.notEqual((await tournaments.getState('rookie-cup')).tournament.name, 'outside-write')
  console.log('Preview/state isolation passed: immutable snapshots, defensive copies and independent sessions')
}
test().catch(error => { console.error(error); process.exitCode = 1 })
