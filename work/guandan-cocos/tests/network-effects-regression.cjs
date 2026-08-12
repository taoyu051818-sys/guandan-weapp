const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const projectRoot = path.resolve(__dirname, '..')
const { compilerPath, loadTypeScript } = require('./support/typescript.cjs')
const policyPath = path.join(projectRoot, 'assets/scripts/effects/NetworkEffectSyncPolicy.ts')
const effectControllerPath = path.join(projectRoot, 'assets/scripts/effects/EffectController.ts')
const actionPresentationPath = path.join(projectRoot, 'assets/scripts/effects/EffectActionPresentationCoordinator.ts')
const lobbyControllerPath = path.join(projectRoot, 'assets/scripts/network/LobbyController.ts')
const lobbyMessageRouterPath = path.join(projectRoot, 'assets/scripts/network/LobbyMessageRouter.ts')
const lobbySyncTrackerPath = path.join(projectRoot, 'assets/scripts/network/LobbySyncTracker.ts')
const tableMatchCoordinatorPath = path.join(projectRoot, 'assets/scripts/scenes/TableMatchCoordinator.ts')

assert.equal(fs.existsSync(compilerPath), true, 'Cocos Creator TypeScript compiler is required')
assert.equal(fs.existsSync(policyPath), true, 'network effect sync policy must exist')
assert.equal(fs.existsSync(`${policyPath}.meta`), true, 'network effect sync policy must be imported by Cocos')
assert.equal(fs.existsSync(lobbySyncTrackerPath), true, 'lobby sync tracker must exist')
assert.equal(fs.existsSync(`${lobbySyncTrackerPath}.meta`), true, 'lobby sync tracker must be imported by Cocos')
const ts = loadTypeScript()

const output = ts.transpileModule(fs.readFileSync(policyPath, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2019 },
  fileName: policyPath,
}).outputText
const loadedModule = { exports: {} }
new Function('exports', 'module', 'require', output)(loadedModule.exports, loadedModule, request => {
  throw new Error(`unexpected dependency ${request}`)
})
const { decideActionEffectSync, decideNetworkEffectSync } = loadedModule.exports

const trackerOutput = ts.transpileModule(fs.readFileSync(lobbySyncTrackerPath, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2019 },
  fileName: lobbySyncTrackerPath,
}).outputText
const trackerModule = { exports: {} }
new Function('exports', 'module', 'require', trackerOutput)(trackerModule.exports, trackerModule, request => {
  if (request === '../effects/NetworkEffectSyncPolicy') return loadedModule.exports
  throw new Error(`unexpected dependency ${request}`)
})
const { LobbySyncTracker } = trackerModule.exports

assert.equal(decideActionEffectSync(null, 4), 'baseline', 'a first snapshot must not replay historical actions')
assert.equal(decideActionEffectSync(4, 5), 'play-next', 'one appended action must play once')
assert.equal(decideActionEffectSync(5, 5), 'duplicate', 'a duplicate render must not replay')
assert.equal(decideActionEffectSync(5, 7), 'recovery', 'an action gap must not replay only its final action')
assert.equal(decideActionEffectSync(7, 0), 'recovery', 'a round reset must replace the action baseline')

const first = decideNetworkEffectSync(null, { roomId: '123456', version: 20, actionCount: 4 })
assert.equal(first.kind, 'apply')
assert.deepEqual(first.sync, { mode: 'recovery', reason: 'initial-snapshot' })
const live = decideNetworkEffectSync(first.cursor, { roomId: '123456', version: 21, actionCount: 5 })
assert.equal(live.kind, 'apply')
assert.deepEqual(live.sync, { mode: 'incremental' })
const duplicate = decideNetworkEffectSync(live.cursor, { roomId: '123456', version: 21, actionCount: 5 })
assert.equal(duplicate.kind, 'drop')
const reconnect = decideNetworkEffectSync(live.cursor, { roomId: '123456', version: 21, actionCount: 5, forceRecovery: 'reconnect' })
assert.deepEqual(reconnect.sync, { mode: 'recovery', reason: 'reconnect' })
const gap = decideNetworkEffectSync(live.cursor, { roomId: '123456', version: 23, actionCount: 6 })
assert.deepEqual(gap.sync, { mode: 'recovery', reason: 'version-gap' })
const nextRound = decideNetworkEffectSync(live.cursor, { roomId: '123456', version: 22, actionCount: 0, forceRecovery: 'round-reset' })
assert.deepEqual(nextRound.sync, { mode: 'recovery', reason: 'round-reset' })
assert.equal(nextRound.cursor.actionCount, 0)
const firstNextRoundAction = decideNetworkEffectSync(nextRound.cursor, { roomId: '123456', version: 23, actionCount: 1 })
assert.deepEqual(firstNextRoundAction.sync, { mode: 'incremental' })

const tracker = new LobbySyncTracker()
assert.equal(tracker.observeVersion(4), 4)
assert.equal(tracker.acceptVersion('game-state', 4), true)
assert.equal(tracker.acceptVersion('game-state', 4), false, 'same-version events must be deduplicated by type')
assert.equal(tracker.acceptVersion('round-ended', 4), true, 'different event types may share a server version')
assert.equal(tracker.observeVersion(3), null, 'stale metadata must be rejected')
assert.deepEqual(tracker.statePacket({ playArea: [{ id: 1 }] }, '123456', 4, 10, 'initial-snapshot').effectSync, { mode: 'recovery', reason: 'initial-snapshot' })
assert.equal(tracker.statePacket({ playArea: [{ id: 1 }] }, '123456', 5, 10), null, 'metadata-only room versions must not replay a duplicate game snapshot')
assert.equal(tracker.observeVersion(8), 8)
assert.deepEqual(
  tracker.statePacket({ playArea: [{ id: 1 }, { id: 2 }] }, '123456', 9, 11).effectSync,
  { mode: 'incremental' },
  'metadata version gaps must not force effect recovery when gameVersion is contiguous',
)

const effectController = fs.readFileSync(effectControllerPath, 'utf8')
const actionPresentation = fs.readFileSync(actionPresentationPath, 'utf8')
const lobbyController = fs.readFileSync(lobbyControllerPath, 'utf8')
const lobbyMessageRouter = fs.readFileSync(lobbyMessageRouterPath, 'utf8')
const lobbySyncTracker = fs.readFileSync(lobbySyncTrackerPath, 'utf8')
const tableMatchCoordinator = fs.readFileSync(tableMatchCoordinatorPath, 'utf8')
assert.match(effectController, /this\.actionPresentation\.syncActions\(/, 'EffectController must delegate action synchronization to its lifecycle owner')
assert.match(actionPresentation, /decideActionEffectSync\(this\.lastActionCount, actions\.length\)/, 'effect playback must use the tested action policy')
assert.match(actionPresentation, /sync !== 'duplicate'[\s\S]*this\.pendingLocalOrigins = \[\]/, 'duplicate pending renders must preserve captured card origins')
assert.match(lobbyController, /new LobbyMessageRouter\(/, 'the controller must delegate server-message projection')
assert.match(lobbyMessageRouter, /this\.sync\.statePacket\(/, 'the message router must delegate packet tracking')
assert.match(lobbySyncTracker, /decideNetworkEffectSync\(this\.effectCursor/, 'the sync tracker must own the tested effect cursor')
assert.match(lobbySyncTracker, /version: normalizedGameVersion/, 'effect playback must use gameVersion rather than room metadata version')
assert.match(lobbyController, /pending\.responseType === 'roomRejoined' \? 'reconnect' : 'initial-snapshot'/, 'entry snapshots must declare recovery intent from the authoritative response kind')
assert.match(tableMatchCoordinator, /if \(packet\.effectSync\.mode === 'recovery'\)[\s\S]*this\.prepareRecoveryVisualBaseline/, 'only recovery packets may reset presentation state')
const applyNetworkState = tableMatchCoordinator.slice(tableMatchCoordinator.indexOf('private applyNetworkState'), tableMatchCoordinator.indexOf('private applyNetworkRoundPrepared'))
assert.doesNotMatch(applyNetworkState, /resetForRecovery/, 'normal gameState handling must not reset effects unconditionally')

process.stdout.write('network effect regression checks passed\n')
