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
const { projectTableViewer, projectTributeEffectTokens } = moduleRecord.exports

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

const tributeCard = { id: 'tribute-ace' }
const returnCard = { id: 'return-three' }
assert.deepEqual(Array.from(projectTributeEffectTokens({
  isAntiTribute: false,
  actions: [{ from: 'p2', to: 'p1', card: tributeCard, returnCard }],
})), ['give:p2:p1:tribute-ace', 'return:p1:p2:return-three'])
assert.deepEqual(Array.from(projectTributeEffectTokens({ isAntiTribute: true, actions: [] })), ['anti-tribute'])
assert.deepEqual(Array.from(projectTributeEffectTokens(null)), [])

const coordinatorSource = fs.readFileSync(coordinatorPath, 'utf8')
assert.match(coordinatorSource, /projectTableViewer\(snapshot\.state\.players, humanId, teamLevels/)
assert.match(coordinatorSource, /projectTributeEffectTokens\(packet\.tribute\)/, 'recovery and live tribute effects must share the presenter token projection')
assert.doesNotMatch(coordinatorSource, /collectTributeEffectTokens/, 'the match coordinator must not own tribute effect identity derivation')
assert.doesNotMatch(coordinatorSource, /settlement\.winnerTeam === 'teamA' \? '本局胜利'/, 'settlement copy must never assume teamA is the viewer')
assert.match(coordinatorSource, /seat\.render\([\s\S]*?snapshot\.state\.players\[humanId\]\.team,/, 'the live legacy seat layer must receive the viewer team')

const legacySeatSource = fs.readFileSync(legacySeatPath, 'utf8')
assert.match(legacySeatSource, /player\.team === viewerTeam \? '我方' : '对方'/, 'legacy seat labels must be viewer-relative')
assert.doesNotMatch(legacySeatSource, /player\.team === 'teamA' \? '我方' : '对方'/, 'legacy seats must not equate teamA with the viewer')

process.stdout.write('table snapshot presenter regression checks passed for all four viewer seats\n')
