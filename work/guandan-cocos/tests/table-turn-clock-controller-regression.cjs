const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { loadTs } = require('./support/load-typescript-module.cjs')

const projectRoot = path.resolve(__dirname, '..')
const sourcePath = path.join(projectRoot, 'assets/scripts/scenes/TableTurnClockController.ts')
const scenePath = path.join(projectRoot, 'assets/scripts/scenes/GameScene.ts')

class Color {
  constructor (r, g, b, a = 255) { Object.assign(this, { r, g, b, a }) }
}

class Vec3 {
  constructor (x = 0, y = 0, z = 0) { Object.assign(this, { x, y, z }) }
}

const projectionModule = loadTs(path.join(projectRoot, 'assets/scripts/scenes/TableTurnClockProjection.ts'))
const { projectTurnClock } = projectionModule
const { TableTurnClockController } = loadTs(sourcePath, { cc: { Color, Vec3 }, './TableTurnClockProjection': projectionModule })

const createSnapshot = ({ phase = 'playing', currentTurn = 'p1', actionPending = false, playCount = 0, finishedPlayers = [] } = {}) => ({
  phase,
  actionPending,
  state: {
    turnOrder: ['p1', 'p2', 'p3', 'p4'],
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
  let lobbyReads = 0
  let nowReads = 0
  const controller = new TableTurnClockController({
    label,
    tableHud: () => ({ update: patch => hudUpdates.push(patch) }),
    isMultiplayer: () => multiplayer,
    lobbySnapshot: () => { lobbyReads += 1; return lobby },
    playCountdown: seconds => countdownSounds.push(seconds),
    schedule: (callback, interval) => scheduled.push({ callback, interval }),
    unschedule: callback => unscheduled.push(callback),
    now: () => { nowReads += 1; return now },
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
    reads: () => ({ lobby: lobbyReads, now: nowReads }),
    setLobby: value => { lobby = value },
    setNow: value => { now = value },
    setMultiplayer: value => { multiplayer = value },
    tick: () => scheduled[0].callback(),
  }
}

const retired = createHarness()
const retiredSnapshot = createSnapshot()
retired.controller.update({ snapshot: retiredSnapshot, humanId: 'p1', humanFinished: false, controlsY: 100 })
assert.equal(retired.label.node.active, false, 'no offline clock without server authority')
for (let i = 0; i < 25; i++) retired.tick()
assert.equal(retired.controller.project(retiredSnapshot, 'p1').turnVisible, false)
retired.controller.dispose()

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
network.tick()
assert.deepEqual(network.countdownSounds, [4], 'repeated ticks in the same second must not replay a warning')
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

// All four viewpoints and a rotated roster are data, not fixed source-code formulas.
for (const order of [['p1', 'p2', 'p3', 'p4'], ['p3', 'p1', 'p4', 'p2']]) {
  for (let viewer = 0; viewer < 4; viewer++) {
    for (let offset = 0; offset < 4; offset++) {
      const snapshot = createSnapshot()
      snapshot.state.turnOrder = order
      const lobby = { ...networkLobby, deadlinePlayerId: order[(viewer + offset) % 4] }
      const actual = projectTurnClock(snapshot, order[viewer], lobby, true, 1000)
      assert.equal(actual.turnVisible, true)
      assert.equal(actual.turnPlace, ['bottom', 'right', 'top', 'left'][offset])
    }
  }
}
for (const deadline of [null, undefined, NaN, Infinity]) {
  const clock = projectTurnClock(tributeTurn, 'p1', { ...networkLobby, turnDeadlineAt: deadline }, true, 1000)
  assert.equal(clock.turnVisible, false)
  assert.equal(clock.turnSeconds, 0)
}
for (const [humanId, lobby, now] of [
  ['p1', { ...networkLobby, deadlinePlayerId: 'missing' }, 1000],
  ['missing', networkLobby, 1000],
  ['p1', networkLobby, NaN],
  ['p1', { ...networkLobby, deadlineAction: null }, 1000],
]) {
  assert.equal(projectTurnClock(tributeTurn, humanId, lobby, true, now).turnVisible, false)
}
for (const [now, seconds] of [[20_001, 1], [21_000, 0], [50_000, 0]]) {
  assert.equal(projectTurnClock(tributeTurn, 'p1', networkLobby, true, now).turnSeconds, seconds)
}
assert.equal(projectTurnClock(tributeTurn, 'p1', { ...networkLobby, roomSettings: {} }, true, 0).turnDurationSeconds, 20)
assert.equal(projectTurnClock(tributeTurn, 'p1', { ...networkLobby, roomSettings: { turnSeconds: 60 } }, true, 0).turnDurationSeconds, 60)

const coherent = createHarness({ network: true, initialLobby: networkLobby, initialNow: 17_000 })
coherent.controller.update({ snapshot: tributeTurn, humanId: 'p1', humanFinished: false, controlsY: 80 })
assert.deepEqual(coherent.reads(), { lobby: 1, now: 1 }, 'each render samples lobby and time exactly once for label and HUD')
assert.equal(coherent.hudUpdates.at(-1).turnSeconds, 4)
coherent.label.node.active = false
coherent.setNow(18_000)
coherent.tick()
assert.deepEqual(coherent.reads(), { lobby: 2, now: 2 })
assert.equal(coherent.label.node.active, true, 'accidental view visibility changes cannot suppress the authoritative clock')
assert.equal(coherent.label.string, '右家 · 进贡 3s')
assert.equal(coherent.hudUpdates.at(-1).turnSeconds, 3)
for (const [action, text] of [['returnTribute', '还贡'], ['finishTribute', '开始本局'], ['play', null]]) {
  coherent.setLobby({ ...networkLobby, deadlineAction: action })
  coherent.tick()
  assert.equal(coherent.label.string, text ? `右家 · ${text} 3s` : '3s')
}
coherent.controller.reset()
assert.equal(coherent.label.node.active, false)
assert.equal(coherent.label.string, '')
assert.deepEqual(coherent.hudUpdates.at(-1), { turnVisible: false, turnSeconds: 0 }, 'leaving immediately clears the HUD, without waiting for another snapshot')
const resetCount = coherent.hudUpdates.length
coherent.tick()
assert.equal(coherent.hudUpdates.length, resetCount, 'reset cancels stale rendering until a new snapshot arrives')
coherent.controller.update({ snapshot: tributeTurn, humanId: 'p1', humanFinished: false, controlsY: 80 })
assert.equal(coherent.label.node.active, true, 'a new room snapshot can reuse the clock after reset')
coherent.controller.dispose()
assert.deepEqual(coherent.hudUpdates.at(-1), { turnVisible: false, turnSeconds: 0 }, 'dispose also clears a visible clock')

const tick = network.scheduled[0].callback
const warnings = createHarness({ network: true, initialLobby: networkLobby, initialNow: 15_000 })
warnings.controller.update({ snapshot: tributeTurn, humanId: 'p1', humanFinished: false, controlsY: 80 })
for (let now = 16_000; now <= 22_000; now += 1000) {
  warnings.setNow(now)
  warnings.tick()
  warnings.tick()
}
assert.deepEqual(warnings.countdownSounds, [5, 4, 3, 2, 1], 'all last-five-second sounds fire once, never at zero or below')
assert.equal(warnings.label.string, '右家 · 进贡 0s')
warnings.controller.dispose()
network.controller.dispose()
network.controller.dispose()
assert.deepEqual(network.unscheduled, [tick], 'dispose must cancel its exact scheduled callback once')
const hudCountAtDispose = network.hudUpdates.length
tick()
assert.equal(network.hudUpdates.length, hudCountAtDispose, 'late ticks after dispose must be inert')

const sceneSource = fs.readFileSync(scenePath, 'utf8')
assert.match(sceneSource, /new TableTurnClockController\(/, 'GameScene must compose the standalone turn clock')
assert.doesNotMatch(sceneSource, /handStackRise/, 'the composition root must keep controls and countdown independent from stack height')
assert.match(sceneSource, /this\.tableTurnClock\?\.reset\(\)/, 'leaving the table must reset the clock owner')
assert.match(sceneSource, /this\.tableTurnClock\?\.dispose\(\)/, 'scene destruction must dispose the clock owner')
assert.doesNotMatch(sceneSource, /actionCountdown|tickActionCountdown|refreshCountdownLabel|tableHudTurnSeconds/, 'countdown state and ticking must not leak back into the composition root')
assert.equal(fs.existsSync(`${sourcePath}.meta`), true, 'the Cocos module must include metadata')

process.stdout.write('table turn-clock controller regression checks passed\n')
