const assert = require('node:assert/strict')
const path = require('node:path')
const { loadTs } = require('./support/load-typescript-module.cjs')
const source = path.resolve(__dirname, '../assets/scripts/scenes/front-pages')
const model = loadTs(path.join(source, 'TournamentCenterModel.ts'), {})
const summary = { id: 'cup', name: '陵水16人积分赛', entryPoints: 0, enrolled: false, queueId: 'lingshui_16_cup', status: 'open', format: 'fixed16-latin-3', capacity: 16, roundsTotal: 3 }
const initial = { tournament: summary, phase: 'check-in', capacity: 16, checkedInCount: 0, roundNumber: 0, roundsTotal: 3, tablesTotal: 4, tablesSettled: 0, cutoffRank: 8, viewerEntry: { enrolled: false, checkedIn: false, rosterLocked: false }, assignment: null }
const view = state => ({ tournament: summary, state, standings: null, busy: false, error: '', tab: 'status', rankingPage: 0 })
assert.equal(model.tournamentAction(view(initial)).kind, 'enroll')
assert.equal(model.tournamentAction(view({ ...initial, viewerEntry: { enrolled: true, checkedIn: false, rosterLocked: false } })).kind, 'check-in')
assert.equal(model.tournamentAction(view({ ...initial, phase: 'blocked' })).kind, 'none')
assert.equal(model.tournamentAction(view({ ...initial, phase: 'finished' })).kind, 'rank')
assert.equal(model.tournamentAction({ ...view(initial), error: '失去连接' }).kind, 'none')
const active = { ...initial, phase: 'round-active', roundNumber: 1, checkedInCount: 16, viewerEntry: { enrolled: true, checkedIn: true, rosterLocked: true }, assignment: { assignmentId: 'assignment-1', roundNumber: 1, tableNumber: 2, status: 'matched' } }
assert.equal(model.tournamentAction(view(active)).kind, 'enter')
assert.equal(model.canWithdrawTournament(view(initial)), false)
assert.equal(model.canWithdrawTournament(view({ ...initial, viewerEntry: { enrolled: true, checkedIn: true, rosterLocked: false } })), true)
assert.equal(model.canWithdrawTournament(view(active)), false)
assert.equal(model.tournamentAction(view({ ...active, assignment: { ...active.assignment, status: 'completed' } })).kind, 'none')

let lastView, actions, renderCount = 0
const { TournamentCenterController } = loadTs(path.join(source, 'TournamentCenterController.ts'), {
  './TournamentCenterModel': model,
  './TournamentCenterView': { renderTournamentCenter: (_ui, _viewport, state, callbacks) => { lastView = { ...state }; actions = callbacks; renderCount++ } },
})
const flush = async () => { for (let i = 0; i < 12; i++) await Promise.resolve() }
async function run () {
  let current = structuredClone(initial), enrollCalls = 0, checkCalls = 0, withdrawCalls = 0, entered = 0, pendingList = null, failList = false
  const timers = [], router = { current: null, open (id) { this.current = id; return {} } }
  const api = {
    async listTournaments () { if (failList) throw new Error('断网'); if (pendingList) return pendingList; return [summary] },
    async getState () { return structuredClone(current) },
    async getStandings () { return { tournament: summary, standings: [], provisional: true, cutoffRank: 8, viewerStanding: null } },
    async enroll (_id, points) { assert.equal(points, 0); enrollCalls++; current.viewerEntry.enrolled = true; return summary },
    async checkIn () { checkCalls++; current.viewerEntry.checkedIn = true; current.checkedInCount = 1; return current },
    async withdraw () { withdrawCalls++; current.viewerEntry.enrolled = false; current.viewerEntry.checkedIn = false; current.checkedInCount = 0; return current },
  }
  const controller = new TournamentCenterController({
    router, gateways: { configured: true, tournaments: api }, screen: { viewport: { width: 1280, height: 589 } },
    isDisposed: () => false, scheduleOnce: (cb, seconds) => { assert.equal(seconds, 1); timers.push(cb) }, setTableVisible () {},
    showMenu () { router.current = 'menu' }, enter (t, s) { entered++; assert.equal(t.id, 'cup'); assert.equal(s.assignment.assignmentId, 'assignment-1'); router.current = 'matching' },
  })
  controller.open(); await flush()
  assert.equal(router.current, 'tournament-center')
  assert.equal(model.tournamentAction(lastView).kind, 'enroll')
  actions.action(); actions.action(); await flush()
  assert.equal(enrollCalls, 1, 'double taps cannot enroll twice')
  assert.equal(model.tournamentAction(lastView).kind, 'check-in')
  actions.action(); await flush(); assert.equal(checkCalls, 1)
  actions.withdraw(); actions.withdraw(); await flush()
  assert.equal(withdrawCalls, 1, 'withdrawal cannot double-submit')
  assert.equal(lastView.state.checkedInCount, 0)
  assert.equal(model.tournamentAction(lastView).kind, 'enroll')
  actions.action(); await flush(); actions.action(); await flush()
  failList = true; timers.shift()(); await flush()
  assert.equal(lastView.error, '断网')
  failList = false; timers.shift()(); await flush()
  assert.equal(lastView.error, '', 'one-second polling automatically recovers without a refresh button')
  const before = renderCount
  timers.shift()(); await flush()
  assert.equal(renderCount, before, 'unchanged polling must not recreate buttons or restart animations')
  assert.equal(entered, 0, 'polling never automatically enters a table')
  current = structuredClone(active)
  timers.shift()(); await flush()
  assert.equal(model.tournamentAction(lastView).kind, 'enter')
  actions.action(); actions.action()
  assert.equal(entered, 1, 'explicit entry is only dispatched once')
  const staleTimers = timers.splice(0)
  staleTimers.forEach(cb => cb()); await flush()
  assert.equal(router.current, 'matching', 'old polling cannot steal the table route')
  controller.open(); await flush()
  current = { ...current, phase: 'blocked' }
  timers.shift()(); await flush()
  assert.equal(model.tournamentAction(lastView).kind, 'none')
  assert.match(model.tournamentStatusCopy(lastView.state).detail, /不会自动补赛/)
  let resolveList
  pendingList = new Promise(resolve => { resolveList = resolve })
  timers.shift()(); await flush()
  actions.withdraw()
  actions.back()
  resolveList([summary]); await flush()
  assert.equal(router.current, 'menu', 'late response cannot reopen the center')
  assert.equal(withdrawCalls, 1, 'tap queued behind a poll must be discarded after leaving')
  pendingList = null
  controller.resume(); assert.equal(router.current, 'menu', 'foreground does not open a page the user left')
  controller.open(); await flush(); controller.suspend()
  controller.resume(); await flush()
  assert.equal(router.current, 'tournament-center')
  controller.destroy()
  timers.splice(0).forEach(cb => cb()); await flush()
}
run().then(() => console.log('Tournament center: state actions, free-only registration, duplicate taps, polling, background and navigation isolation passed')).catch(error => { console.error(error); process.exitCode = 1 })
