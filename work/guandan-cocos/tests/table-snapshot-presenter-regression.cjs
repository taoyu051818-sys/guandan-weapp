const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { loadTypeScript } = require('./support/typescript.cjs')

const projectRoot = path.resolve(__dirname, '..')
const sourcePath = path.join(projectRoot, 'assets/scripts/scenes/TableSnapshotPresenter.ts')
const coordinatorPath = path.join(projectRoot, 'assets/scripts/scenes/TableMatchCoordinator.ts')
const legacySeatPath = path.join(projectRoot, 'assets/scripts/ui/PlayerSeatController.ts')
const ts = loadTypeScript()
const source = fs.readFileSync(sourcePath, 'utf8')
const result = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2019 },
  fileName: sourcePath,
  reportDiagnostics: true,
})
const errors = (result.diagnostics ?? []).filter(diagnostic => diagnostic.category === ts.DiagnosticCategory.Error)
assert.deepEqual(errors, [], 'TableSnapshotPresenter must transpile')
const moduleRecord = { exports: {} }
new Function('exports', 'module', 'require', result.outputText)(moduleRecord.exports, moduleRecord, require)
const { projectTableSeatStatus, projectTableViewer } = moduleRecord.exports

for (const count of [27, 18, 11, 10, 9, 1, 0]) {
  assert.equal(projectTableSeatStatus(count, false), count > 0 && count <= 10 ? `剩${count}张` : '')
  assert.equal(projectTableSeatStatus(count, true), `剩${count}张`, 'the viewer retains their own count')
}
for (const isSelf of [false, true]) {
  for (const [index, rank] of ['头游', '二游', '三游', '末游'].entries()) {
    assert.equal(projectTableSeatStatus(0, isSelf, index + 1), rank, 'finish rank takes precedence over count')
  }
}
assert.deepEqual([11, 10, 9, 1, 0, 27].map(count => projectTableSeatStatus(count, false)),
  ['', '剩10张', '剩9张', '剩1张', '', ''], 'new-round and recovered snapshots must not retain the last count')
assert.equal(projectTableSeatStatus(NaN, false), '')

const players = {
  p1: { team: 'teamA' },
  p2: { team: 'teamB' },
  p3: { team: 'teamA' },
  p4: { team: 'teamB' },
}
const levels = { teamA: 'K', teamB: 'A' }

for (const viewerId of ['p1', 'p3']) {
  const projection = projectTableViewer(players, viewerId, levels, 'teamA')
  assert.equal(projection.viewerTeam, 'teamA')
  assert.equal(projection.viewerLevel, 'K')
  assert.equal(projection.opponentLevel, 'A')
  assert.equal(projection.settlementWon, true)
  assert.equal(projection.settlementTitle, '本局胜利')
}

for (const viewerId of ['p2', 'p4']) {
  const projection = projectTableViewer(players, viewerId, levels, 'teamB')
  assert.equal(projection.viewerTeam, 'teamB')
  assert.equal(projection.viewerLevel, 'A')
  assert.equal(projection.opponentLevel, 'K')
  assert.equal(projection.levelLabel, '我方 A 级    对方 K 级')
  assert.equal(projection.settlementWon, true)
  assert.equal(projection.settlementTitle, '本局胜利')
  assert.equal(projectTableViewer(players, viewerId, levels, 'teamA').settlementTitle, '本局失利')
}

assert.equal(projectTableViewer(players, 'p2', levels).settlementTitle, null)

const coordinatorSource = fs.readFileSync(coordinatorPath, 'utf8')
const hudPresenterSource = fs.readFileSync(path.join(projectRoot, 'assets/scripts/scenes/TableHudPresenter.ts'), 'utf8')
assert.match(hudPresenterSource, /status: projectTableSeatStatus\(player\.hand\.length, id === humanId, finishPlace\)/,
  'every viewer-relative HUD seat must use the same remaining-count policy')
assert.match(coordinatorSource, /projectTableViewer\(snapshot\.state\.players, humanId, teamLevels/)
assert.doesNotMatch(coordinatorSource, /renderTributeEffects|resetTribute/, 'retired flow bookkeeping is absent')
const progressSource = fs.readFileSync(path.join(projectRoot, 'assets/scripts/scenes/TableProgressPresentation.ts'), 'utf8')
assert.doesNotMatch(coordinatorSource, /collectTributeEffectTokens/, 'the match coordinator must not own tribute effect identity derivation')
assert.doesNotMatch(coordinatorSource, /settlement\.winnerTeam === 'teamA' \? '本局胜利'/, 'settlement copy must never assume teamA is the viewer')
assert.match(coordinatorSource, /seat\.render\([\s\S]*?snapshot\.state\.players\[humanId\]\.team,/, 'the live legacy seat layer must receive the viewer team')

const legacySeatSource = fs.readFileSync(legacySeatPath, 'utf8')
assert.match(legacySeatSource, /player\.team === viewerTeam \? '我方' : '对方'/, 'legacy seat labels must be viewer-relative')
assert.doesNotMatch(legacySeatSource, /player\.team === 'teamA' \? '我方' : '对方'/, 'legacy seats must not equate teamA with the viewer')

process.stdout.write('table snapshot presenter regression checks passed for all four viewer seats\n')
