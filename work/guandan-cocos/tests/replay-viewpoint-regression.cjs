const assert = require('node:assert/strict')
const fs = require('node:fs')
const Module = require('node:module')
const path = require('node:path')
const { loadTypeScript } = require('./support/typescript.cjs')

const root = path.resolve(__dirname, '..')
const sourcePath = path.join(root, 'assets/scripts/ui/ReplayViewpoint.ts')
const boardPath = path.join(root, 'assets/scripts/ui/ReplayBoardView.ts')
const pagePath = path.join(root, 'assets/scripts/scenes/front-pages/ReplaySpectatorPageDomain.ts')
const ts = loadTypeScript()
const output = ts.transpileModule(fs.readFileSync(sourcePath, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  fileName: sourcePath,
}).outputText
const runtime = new Module(sourcePath, module)
runtime.filename = sourcePath
runtime.paths = Module._nodeModulePaths(path.dirname(sourcePath))
runtime._compile(output, sourcePath)

const { neutralReplayViewpoint, playerReplayViewpoint, projectReplaySeats, replayWinnerLabel } = runtime.exports
for (const seat of ['p1', 'p2', 'p3', 'p4']) {
  const viewpoint = playerReplayViewpoint(seat)
  const placements = projectReplaySeats(viewpoint)
  assert.deepEqual(placements.map(item => item.seat), [seat, `p${Number(seat[1]) % 4 + 1}`, `p${(Number(seat[1]) + 1) % 4 + 1}`, `p${(Number(seat[1]) + 2) % 4 + 1}`])
  assert.equal(placements[0].lane, 'bottom')
  assert.equal(placements[0].side, '本人')
  const viewerTeam = seat === 'p1' || seat === 'p3' ? 'teamA' : 'teamB'
  assert.equal(replayWinnerLabel(viewerTeam, viewpoint), '我方队胜')
  assert.equal(replayWinnerLabel(viewerTeam === 'teamA' ? 'teamB' : 'teamA', viewpoint), '对方队胜')
}

const neutral = neutralReplayViewpoint()
const neutralSeats = projectReplaySeats(neutral)
assert.deepEqual(neutralSeats.map(item => item.seat), ['p1', 'p2', 'p3', 'p4'])
assert.deepEqual(neutralSeats.map(item => item.side), ['一号位', '二号位', '三号位', '四号位'])
assert.equal(replayWinnerLabel('teamA', neutral), 'A队胜')
assert.equal(replayWinnerLabel('teamB', neutral), 'B队胜')

const boardSource = fs.readFileSync(boardPath, 'utf8')
assert.doesNotMatch(boardSource, /p1:\s*\{[^}]*side:\s*['"]我方['"]/, 'the board must not identify p1 as the viewer')
const pageSource = fs.readFileSync(pagePath, 'utf8')
assert.match(pageSource, /replay\.viewerSeat\s*\?\s*playerReplayViewpoint\(replay\.viewerSeat\)\s*:\s*neutralReplayViewpoint\(\)/, 'replays must use an explicit viewer seat or neutral fallback')
assert.match(pageSource, /renderReplayBoard\([^\n]+neutralReplayViewpoint\(\)\)/, 'anonymous spectator boards must request a neutral viewpoint explicitly')

process.stdout.write('replay viewpoint regression checks passed\n')
