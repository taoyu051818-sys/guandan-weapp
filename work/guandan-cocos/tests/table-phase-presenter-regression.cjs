const assert = require('node:assert/strict')
const path = require('node:path')
const { loadTs } = require('./support/load-typescript-module.cjs')

class Vec3 { constructor (x, y, z) { Object.assign(this, { x, y, z }) } }
let legalActions = ['hint', 'play']
const { TablePhasePresenter } = loadTs(path.resolve(__dirname, '../assets/scripts/scenes/TablePhasePresenter.ts'), {
  cc: { Label: class {}, Vec3 },
  '../ui/TablePlayActionPolicy': { TablePlayActionPolicy: class { resolve () { return legalActions } } },
  '../ui/TableSettlementView': { TableSettlementView: class { clear () {} render () {} } },
  './MatchEndedPresentation': { projectMatchEndedPresentation: () => ({}) },
  './SettlementPresentation': { projectSettlementContent: () => ({}) },
})
const keys = ['hint', 'pass', 'play', 'confirmTribute', 'finishTribute', 'nextRound']
const controls = Object.fromEntries(keys.map(key => [key, {
  active: false, label: { string: '', enableWrapText: true },
  setPosition (value) { this.position = value },
  getComponentInChildren () { return this.label },
}]))
const clockCalls = []
let canInteract = true
let tournamentRoom = false
const dependencies = {
  controls, turnClock: { update: patch => clockCalls.push(patch) },
  lobby: { snapshot: { roomId: '123456', roundReadyPlayerIds: [] } },
  session: { snapshot: { isMultiplayer: true, isObserver: false } },
  handInteraction: { canInteractWithCurrentHand: () => canInteract },
  hud: { mounted: true }, controlsY: () => -160,
  frontPages: { isTournamentRoom: () => tournamentRoom },
}
const presenter = new TablePhasePresenter(dependencies)
const playing = { phase: 'playing', actionPending: false, state: { currentTurn: 'p1' }, tribute: null, settlement: null }
const assertControls = (snapshot, expected, humanId = 'p1', humanFinished = false) => {
  presenter.layoutActionControls(snapshot, humanId, humanFinished)
  assert.deepEqual(keys.filter(key => controls[key].active), expected)
  assert.deepEqual(clockCalls.at(-1), { snapshot, humanId, humanFinished, controlsY: -160 }, 'every phase must update the clock through its public port')
}
assertControls(playing, ['hint', 'play'])
legalActions = ['pass']
assertControls(playing, ['pass'])
legalActions = ['hint', 'pass', 'play']
assertControls(playing, ['hint', 'pass', 'play'])
assertControls({ ...playing, actionPending: true }, [])
assertControls(playing, [], 'p2')
assertControls(playing, [], 'p1', true)
dependencies.lobby.snapshot.trustees = { p1: { reason: 'manual' } }
assertControls(playing, [])
dependencies.lobby.snapshot.trustees = {}

const tribute = { ...playing, phase: 'tribute', tribute: { phase: 'tribute', isAntiTribute: false } }
dependencies.lobby.snapshot.deadlinePlayerId = 'p2'
dependencies.lobby.snapshot.deadlineAction = 'tribute'
assertControls(tribute, [])
dependencies.lobby.snapshot.deadlinePlayerId = 'p1'
assertControls(tribute, ['confirmTribute'])
assert.equal(controls.confirmTribute.position.x, 0)
assert.equal(controls.confirmTribute.position.y, -160)
canInteract = false
assertControls(tribute, [])
const done = { ...tribute, tribute: { phase: 'done' } }
assertControls(done, [])
dependencies.lobby.snapshot.deadlineAction = 'finishTribute'
assertControls(done, ['finishTribute'])
assertControls({ ...tribute, tribute: { isAntiTribute: true } }, ['finishTribute'])
dependencies.lobby.snapshot.trustees = { p1: {} }
assertControls(done, [])
dependencies.lobby.snapshot.trustees = {}

const settlement = { ...playing, phase: 'settlement', settlement: { isGameWon: false } }
for (const id of ['p1', 'p2', 'p3', 'p4']) {
  dependencies.lobby.snapshot.roundReadyPlayerIds = []
  assertControls(settlement, ['nextRound'], id)
  assert.equal(controls.nextRound.label.string, '准备下一局')
  dependencies.lobby.snapshot.roundReadyPlayerIds = [id]
  assertControls(settlement, ['nextRound'], id)
  assert.equal(controls.nextRound.label.string, '取消准备')
}
dependencies.lobby.snapshot.matchEnded = { reason: 'single-round' }
assertControls(settlement, ['nextRound'])
assert.equal(controls.nextRound.label.string, '再来一场')
assert.equal(controls.nextRound.label.enableWrapText, false)
tournamentRoom = true
assertControls(settlement, ['nextRound'])
assert.equal(controls.nextRound.label.string, '返回赛事')
tournamentRoom = false
dependencies.lobby.snapshot.matchEnded = { reason: 'target-reached' }
assertControls(settlement, ['nextRound'])
assert.equal(controls.nextRound.label.string, '本场结束 · 返回大厅')
dependencies.session.snapshot.isObserver = true
for (const snapshot of [playing, tribute, settlement]) assertControls(snapshot, [])
console.log('table phase behavior: legal controls, tribute authority, trustees, observers, four-seat readiness and terminal CTA passed')
