const assert = require('node:assert/strict')
const path = require('node:path')
const { loadTs } = require('./support/load-typescript-module.cjs')
const root = path.resolve(__dirname, '../assets/scripts')
const load = (file, ports) => loadTs(path.join(root, file), ports)
const policy = load('ui/SecondaryPagePolicy.ts')
for (const height of [590, 720, 800]) for (const width of [1280, 1560]) {
  const viewport = { width, height, safeLeft: 35, safeRight: 10, safeTop: 15, safeBottom: 18,
    nativeCapsule: { left: width / 2 - 200, right: width / 2 - 10, top: height / 2 - 10, bottom: height / 2 - 70 } }
  const frame = policy.secondaryPagePlacement(viewport)
  assert.ok(frame.x - 560 * frame.scale > -width / 2 + viewport.safeLeft)
  assert.ok(frame.x + 560 * frame.scale < width / 2 - viewport.safeRight)
  assert.ok(frame.y + 260 * frame.scale < viewport.nativeCapsule.bottom)
  assert.ok(frame.y - 260 * frame.scale > -height / 2 + viewport.safeBottom)
}
assert.equal(policy.secondaryErrorText(Error('连接 http://localhost:3000 失败')), '暂时无法加载，请稍后重试。')
assert.equal(policy.secondaryErrorText(Error('ECONNREFUSED'), '请重试'), '请重试')
assert.equal(policy.secondaryErrorText(Error('昵称过长，请修改')), '昵称过长，请修改')

let current
class Shell {
  constructor(parent, title, back) {
    Object.assign(this, { title, back, labels: [], buttons: [], scrolls: [], panels: [] }); current = this
    this.ui = { parent: {}, panel: (...args) => this.panels.push(args) }
  }
  text(name, value) { const label = { name, value }; this.labels.push(label); return label }
  panel(...args) { this.panels.push(args) }
  button(name, value, x, y, width, action, primary, disabled) { this.buttons.push({ name, value, action, disabled }) }
  scroll(...args) { this.scrolls.push(args); return this }
  empty(title, detail, retry) { this.emptyState = { title, detail, retry } }
}
const ports = { '../../ui/SecondaryPageUi': { SecondaryPageShell: Shell, secondaryColors: {} } }
const player = load('scenes/front-pages/PlayerCenterPageView.ts', {
  ...ports, '../../ui/ProfileAvatar': { mountProfileAvatar() {} },
})
let claims = [], opened
const actions = { back() {}, retry() {}, edit() {}, tasks() {}, records() {}, ranking() {}, claim: id => claims.push(id) }
const dashboard = { user: { accountId: '123', displayName: '很长的玩家昵称' }, rating: { games: 0, wins: 0, comprehensiveScore: 5169 },
  stats: { firstPlaceFinishes: 0 }, season: null }
player.renderPlayerCenter({}, dashboard, '已同步', '--', {}, actions)
assert.equal(current.labels.find(l => l.name === 'MetricValue').value, '--', 'failed wallet sync cannot fabricate a balance')
assert.equal(current.labels.filter(l => l.name === 'StatValue')[1].value, '0%', 'zero games has no NaN rate')
assert.equal(current.buttons.length, 4)
const tasks = Array.from({ length: 8 }, (_, i) => ({ id: String(i), name: '任务' + i, completed: true, claimed: i === 7, target: 2, progress: 3, rewardPoints: 80 }))
player.renderSeasonTasks({}, { tasks }, '已同步', true, null, actions)
assert.equal(current.labels.filter(l => l.name === 'TaskName').length, 8, 'tasks beyond the first screen are retained')
assert.equal(current.buttons.length, 7)
current.buttons[6].action(); assert.deepEqual(claims, ['6'])
assert.ok(current.scrolls[0][5] > 325)
player.renderSeasonTasks({}, { tasks }, '领取中', true, '1', actions)
assert.ok(current.buttons.every(b => b.disabled), 'one pending claim disables all claims')
player.renderSeasonTasks({}, { tasks }, '演示', false, null, actions)
assert.equal(current.buttons.length, 0, 'demo fixtures never expose reward claims')
assert.ok(current.labels.some(l => l.value === '演示完成'))

const { renderReplayList } = load('scenes/front-pages/ReplayListView.ts', ports)
const replays = Array.from({ length: 6 }, (_, i) => ({ id: String(i), roomId: 'room-' + i, finishedAt: 0, winnerTeam: 'teamA' }))
renderReplayList({}, replays, '已同步', { ...actions, select: id => { opened = id } })
assert.equal(current.labels.filter(l => l.name === 'ReplayRoom').length, 6)
current.buttons[5].action(); assert.equal(opened, '5')
assert.equal(current.labels.find(l => l.name === 'ReplayResult').value, 'A 队获胜')
renderReplayList({}, [], '暂无对局记录', actions)
assert.equal(current.emptyState.title, '还没有完成的对局')
renderReplayList({}, [], '网络异常', actions)
assert.equal(current.emptyState.retry, actions.retry)
console.log('Secondary pages: capsule/safe bounds, readable errors, authoritative metrics, full lists, claim gates and replay actions passed')
