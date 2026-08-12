const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { loadTypeScript } = require('./support/typescript.cjs')

const root = path.resolve(__dirname, '..')
const sourcePath = path.join(root, 'assets/scripts/scenes/MatchEndedPresentation.ts')
const coordinatorPath = path.join(root, 'assets/scripts/scenes/TableMatchCoordinator.ts')
const networkBridgePath = path.join(root, 'assets/scripts/scenes/TableNetworkEventBridge.ts')
const clockPath = path.join(root, 'assets/scripts/scenes/TableTurnClockController.ts')
const ts = loadTypeScript()

assert.equal(fs.existsSync(`${sourcePath}.meta`), true, 'the match-ended presenter must be imported by Cocos')
const output = ts.transpileModule(fs.readFileSync(sourcePath, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText
const loaded = { exports: {} }
new Function('exports', 'module', 'require', output)(loaded.exports, loaded, request => { throw new Error(`unexpected ${request}`) })
const { projectMatchEndedPresentation } = loaded.exports

const timeLimit = {
  reason: 'time-limit', endedAt: 1000, roundsPlayed: 3, configuredRounds: 8,
  scores: { teamA: 6, teamB: 8 }, winnerTeam: 'teamB',
}
assert.deepEqual(projectMatchEndedPresentation(timeLimit, 'p2'), {
  title: '本场结束 · 胜利', detail: '房间时限已到 · 已完成 3 局\n我方 8 · 对方 6',
})
assert.deepEqual(projectMatchEndedPresentation(timeLimit, 'p3'), {
  title: '本场结束 · 失利', detail: '房间时限已到 · 已完成 3 局\n我方 6 · 对方 8',
})

const draw = {
  reason: 'round-limit', endedAt: 2000, roundsPlayed: 4, configuredRounds: 4,
  scores: { teamA: 12, teamB: 12 }, winnerTeam: null,
}
assert.deepEqual(projectMatchEndedPresentation(draw, 'p4'), {
  title: '本场结束 · 平局', detail: '已完成 4 局\n我方 12 · 对方 12',
})

const passedA = {
  reason: 'passed-a', endedAt: 3000, roundsPlayed: 7, configuredRounds: 8,
  scores: { teamA: 18, teamB: 12 }, winnerTeam: 'teamA',
}
assert.deepEqual(projectMatchEndedPresentation(passedA, 'p1'), {
  title: '本场结束 · 通过 A 关', detail: '我方通过 A 关 · 已完成 7 局\n我方 18 · 对方 12',
})
assert.deepEqual(projectMatchEndedPresentation(passedA, 'p2'), {
  title: '本场结束 · A 关失败', detail: '对方通过 A 关 · 已完成 7 局\n我方 12 · 对方 18',
})
assert.deepEqual(projectMatchEndedPresentation({ ...passedA, winnerTeam: null }, 'p2'), {
  title: '本场结束 · A 关结算', detail: 'A 关终局 · 已完成 7 局\n我方 12 · 对方 18',
})

const coordinator = fs.readFileSync(coordinatorPath, 'utf8')
const networkBridge = fs.readFileSync(networkBridgePath, 'utf8')
const clock = fs.readFileSync(clockPath, 'utf8')
assert.match(networkBridge, /guandan:match-ended[\s\S]*onMatchEnded/, 'the table network bridge must consume the typed terminal event')
assert.match(coordinator, /onMatchEnded: ended => this\.applyNetworkMatchEnded\(ended\)/, 'the match coordinator must map terminal events onto table presentation')
assert.match(coordinator, /matchEnded[\s\S]*本场结束 · 返回大厅/, 'terminal metadata must replace next-round controls with an explicit exit')
assert.match(coordinator, /projectMatchEndedPresentation\(matchEnded, humanId\)/, 'terminal scores must be viewer-relative')
assert.match(clock, /!lobby\?\.matchEnded/, 'the authoritative turn clock must stop at match end even if engine phase is still playing')

process.stdout.write('match-ended presentation regression checks passed\n')
