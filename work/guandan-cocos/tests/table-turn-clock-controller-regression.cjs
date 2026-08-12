const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { loadTypeScript } = require('./support/typescript.cjs')

const projectRoot = path.resolve(__dirname, '..')
const sourcePath = path.join(projectRoot, 'assets/scripts/scenes/TableTurnClockController.ts')
const scenePath = path.join(projectRoot, 'assets/scripts/scenes/GameScene.ts')
const tableMatchCoordinatorPath = path.join(projectRoot, 'assets/scripts/scenes/TableMatchCoordinator.ts')
const ts = loadTypeScript()

class Color {
  constructor (r, g, b, a = 255) { Object.assign(this, { r, g, b, a }) }
}

class Vec3 {
  constructor (x = 0, y = 0, z = 0) { Object.assign(this, { x, y, z }) }
}

const transpiled = ts.transpileModule(fs.readFileSync(sourcePath, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2019 },
  fileName: sourcePath,
  reportDiagnostics: true,
})
const errors = (transpiled.diagnostics ?? []).filter(diagnostic => diagnostic.category === ts.DiagnosticCategory.Error)
assert.deepEqual(errors, [], 'TableTurnClockController must transpile')
const moduleRecord = { exports: {} }
const localRequire = request => {
  if (request === 'cc') return { Color, Vec3 }
  throw new Error(`unexpected runtime dependency ${request}`)
}
new Function('exports', 'module', 'require', '__filename', '__dirname', transpiled.outputText)(
  moduleRecord.exports,
  moduleRecord,
  localRequire,
  sourcePath,
  path.dirname(sourcePath),
)
const { TableTurnClockController } = moduleRecord.exports

const createSnapshot = ({ phase = 'playing', currentTurn = 'p1', actionPending = false, playCount = 0, finishedPlayers = [] } = {}) => ({
  phase,
  actionPending,
  state: {
    currentTurn,
    playArea: Array.from({ length: playCount }, (_, index) => ({ id: `play-${index}` })),
    finishedPlayers,
    players: {
      p1: { name: '本家' },
      p2: { name: '右家' },
      p3: { name: '对家' },
      p4: { name: '左家' },
    },
  },
})

const createLabel = () => ({
  string: '',
  color: null,
  node: {
    active: false,
    position: null,
    setPosition (position) { this.position = position },
  },
})

const createHarness = ({ network = false, initialLobby = null, initialNow = 0 } = {}) => {
  let multiplayer = network
  let lobby = initialLobby
  let now = initialNow
  const label = createLabel()
  const hudUpdates = []
  const countdownSounds = []
  const scheduled = []
  const unscheduled = []
  let timeoutCount = 0
  const controller = new TableTurnClockController({
    label,
    tableHud: () => ({ update: patch => hudUpdates.push(patch) }),
    isMultiplayer: () => multiplayer,
    lobbySnapshot: () => lobby,
    playCountdown: seconds => countdownSounds.push(seconds),
    actOnLocalTimeout: () => { timeoutCount += 1 },
    schedule: (callback, interval) => scheduled.push({ callback, interval }),
    unschedule: callback => unscheduled.push(callback),
    now: () => now,
  })
  assert.equal(scheduled.length, 1, 'the controller must own one one-second tick')
  assert.equal(scheduled[0].interval, 1)
  return {
    controller,
    label,
    hudUpdates,
    countdownSounds,
    scheduled,
    unscheduled,
    timeoutCount: () => timeoutCount,
    setLobby: value => { lobby = value },
    setNow: value => { now = value },
    setMultiplayer: value => { multiplayer = value },
    tick: () => scheduled[0].callback(),
  }
}

const local = createHarness()
const localTurn = createSnapshot()
local.controller.update({ snapshot: localTurn, humanId: 'p1', humanFinished: false, controlsY: 100 })
assert.equal(local.label.node.active, true)
assert.equal(local.label.string, '20s')
assert.deepEqual(local.label.node.position, new Vec3(0, 147, 0), 'normal hands keep the clock above the action row')
assert.deepEqual(local.controller.project(localTurn, 'p1'), {
  turnVisible: true,
  turnSeconds: 20,
  turnDurationSeconds: 20,
  turnPlace: 'bottom',
})

for (let index = 0; index < 15; index += 1) local.tick()
assert.equal(local.label.string, '5s')
assert.deepEqual(local.countdownSounds, [5], 'the warning sound starts exactly at five seconds')
for (let index = 0; index < 5; index += 1) local.tick()
assert.deepEqual(local.countdownSounds, [5, 4, 3, 2, 1])
assert.equal(local.timeoutCount(), 1, 'only the local controller may invoke the local timeout action')
local.tick()
assert.equal(local.timeoutCount(), 1, 'zero must not submit timeout twice')

local.controller.reset()
assert.equal(local.label.node.active, false)
local.controller.update({ snapshot: localTurn, humanId: 'p1', humanFinished: false, controlsY: 100 })
assert.equal(local.label.string, '20s', 'reset must clear the local turn identity as well as its value')
assert.deepEqual(local.label.node.position, new Vec3(0, 147, 0), 'the clock remains fixed above the action row regardless of hand height')

const otherLocalTurn = createSnapshot({ currentTurn: 'p2' })
local.controller.update({ snapshot: otherLocalTurn, humanId: 'p1', humanFinished: false, controlsY: 100 })
assert.equal(local.label.node.active, false, 'the legacy text label is local-action only')
assert.deepEqual(local.controller.project(otherLocalTurn, 'p1'), {
  turnVisible: true,
  turnSeconds: 20,
  turnDurationSeconds: 20,
  turnPlace: 'right',
}, 'the HUD must retain the equal-size clock at a local opponent operation area')
const pendingLocalTurn = createSnapshot({ actionPending: true })
local.controller.update({ snapshot: pendingLocalTurn, humanId: 'p1', humanFinished: false, controlsY: 100 })
assert.equal(local.controller.project(pendingLocalTurn, 'p1').turnVisible, false)
local.controller.update({ snapshot: localTurn, humanId: 'p1', humanFinished: true, controlsY: 100 })
assert.equal(local.label.node.active, false, 'finished local players must not retain an action deadline')

const networkLobby = {
  roomStatus: 'ready',
  turnDeadlineAt: 21_000,
  deadlinePlayerId: 'p2',
  deadlineAction: 'tribute',
  trustees: { p1: null, p2: { reason: 'manual', since: 1 }, p3: null, p4: null },
  roomSettings: { turnSeconds: 40 },
}
const network = createHarness({ network: true, initialLobby: networkLobby, initialNow: 1_000 })
const tributeTurn = createSnapshot({ phase: 'tribute', currentTurn: 'p1' })
network.controller.update({ snapshot: tributeTurn, humanId: 'p1', humanFinished: false, controlsY: 80 })
assert.equal(network.label.node.active, true, 'an authoritative deadline stays visible even when trustee metadata is present')
assert.equal(network.label.string, '右家 · 进贡 20s', 'non-play deadlines must identify the actor and required action')
assert.deepEqual(network.controller.project(tributeTurn, 'p1'), {
  turnVisible: true,
  turnSeconds: 20,
  turnDurationSeconds: 40,
  turnPlace: 'right',
})

network.setNow(17_000)
network.tick()
assert.equal(network.label.string, '右家 · 进贡 4s')
assert.deepEqual(network.countdownSounds, [4], 'server clock changes in the last five seconds use the same semantic sound')
assert.equal(network.timeoutCount(), 0, 'a server-owned deadline must never execute a local timeout action')
network.setLobby({ ...networkLobby, turnDeadlineAt: null })
network.tick()
assert.equal(network.label.node.active, false, 'a removed authoritative deadline immediately hides the clock')

network.setLobby(networkLobby)
network.controller.update({ snapshot: { ...tributeTurn, actionPending: true }, humanId: 'p1', humanFinished: false, controlsY: 80 })
assert.equal(network.label.node.active, false, 'pending server actions suspend the deadline projection')
network.setLobby({ ...networkLobby, roomStatus: 'rejoining' })
network.controller.update({ snapshot: tributeTurn, humanId: 'p1', humanFinished: false, controlsY: 80 })
assert.equal(network.label.node.active, false, 'room recovery must finish before a deadline becomes actionable')
assert.equal(network.hudUpdates.at(-1).turnVisible, false, 'the HUD must not invent a turn clock while the room is rejoining')
assert.equal(network.hudUpdates.at(-1).turnSeconds, 0, 'hidden recovery clocks must not retain a plausible-but-stale duration')

const tick = network.scheduled[0].callback
network.controller.dispose()
network.controller.dispose()
assert.deepEqual(network.unscheduled, [tick], 'dispose must cancel its exact scheduled callback once')
const hudCountAtDispose = network.hudUpdates.length
tick()
assert.equal(network.hudUpdates.length, hudCountAtDispose, 'late ticks after dispose must be inert')

const sceneSource = fs.readFileSync(scenePath, 'utf8')
const tableMatchCoordinatorSource = fs.readFileSync(tableMatchCoordinatorPath, 'utf8')
assert.match(sceneSource, /new TableTurnClockController\(/, 'GameScene must compose the standalone turn clock')
assert.match(tableMatchCoordinatorSource, /turnClock\.update\(\{ snapshot, humanId, humanFinished, controlsY \}\)/)
assert.doesNotMatch(sceneSource, /handStackRise/, 'the composition root must keep controls and countdown independent from stack height')
assert.match(sceneSource, /this\.tableTurnClock\?\.reset\(\)/, 'leaving the table must reset the clock owner')
assert.match(sceneSource, /this\.tableTurnClock\?\.dispose\(\)/, 'scene destruction must dispose the clock owner')
assert.doesNotMatch(sceneSource, /actionCountdown|tickActionCountdown|refreshCountdownLabel|tableHudTurnSeconds/, 'countdown state and ticking must not leak back into the composition root')
assert.equal(fs.existsSync(`${sourcePath}.meta`), true, 'the Cocos module must include metadata')

process.stdout.write('table turn-clock controller regression checks passed\n')
