const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { loadTypeScript } = require('./support/typescript.cjs')
const ts = loadTypeScript()
const root = path.resolve(__dirname, '../assets/scripts/scenes')
const load = name => {
  const source = fs.readFileSync(path.join(root, `${name}.ts`), 'utf8')
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText
  const result = { exports: {} }
  new Function('exports', 'require', code)(result.exports, id => {
    if (id === 'cc') return { Vec3: { ZERO: { x: 0, y: 0, z: 0 } } }
    if (id === './TableSnapshotPresenter') return load('TableSnapshotPresenter')
    throw new Error(`Presentation must not acquire application dependencies: ${id}`)
  })
  return result.exports
}
const { TableProgressPresentation } = load('TableProgressPresentation')
const notices = []
const presenter = new TableProgressPresentation({
  showToast: text => notices.push(text),
})
const create = () => ({ phase: 'playing', tribute: null, state: { finishedPlayers: [], players: Object.fromEntries(['p1','p2','p3','p4'].map(id => [id, { name: id, hand: Array(27).fill({}) }])) } })
const snapshot = create()
presenter.renderProgressNotifications(snapshot, 'p1')
assert.deepEqual(notices, [])
snapshot.state.players.p2.hand.length = 10
presenter.renderProgressNotifications(snapshot, 'p1')
presenter.renderProgressNotifications(snapshot, 'p1')
assert.deepEqual(notices, ['p2 仅剩 10 张牌'])
snapshot.state.players.p2.hand.length = 9
presenter.renderProgressNotifications(snapshot, 'p1')
assert.equal(notices.length, 1, 'remaining-card threshold only fires once')
snapshot.state.finishedPlayers.push('p1', 'p3')
presenter.renderProgressNotifications(snapshot, 'p1')
assert.deepEqual(notices.slice(1), ['你已出完 · 头游', 'p3 已出完 · 二游'])
presenter.renderProgressNotifications(snapshot, 'p1')
assert.equal(notices.filter(text => text.includes("已出完")).length, 2, 'rerenders do not repeat finish effects')
const before = JSON.stringify(snapshot)
presenter.reset()
presenter.seedRecovery(snapshot.state)
presenter.renderProgressNotifications(snapshot, 'p1')
assert.equal(notices.filter(text => text.includes("已出完")).length, 2, 'recovery suppresses historical finish effects')
assert.equal(JSON.stringify(snapshot), before, 'presentation never mutates authoritative state')
presenter.renderProgressNotifications(create(), 'p1')
presenter.renderProgressNotifications(snapshot, 'p1')
assert.equal(notices.filter(text => text.includes("已出完")).length, 4, 'new round resets progress cursors')

assert.equal(presenter.renderTributeEffects, undefined, 'retired visual pipelines must not keep no-op calls')
console.log('Table progress presentation passed: real notices, threshold, recovery and reset')
