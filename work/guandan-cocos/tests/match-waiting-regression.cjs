const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const projectRoot = path.resolve(__dirname, '..')
const compilerPath = '/Applications/Cocos/Creator/3.8.8/CocosCreator.app/Contents/Resources/resources/3d/engine/node_modules/typescript/lib/typescript.js'
const presentationPath = path.join(projectRoot, 'assets/scripts/services/MatchWaitingPresentation.ts')
const matchmakingPagePath = path.join(projectRoot, 'assets/scripts/scenes/front-pages/MatchmakingPageDomain.ts')
const ts = require(compilerPath)

require.extensions['.ts'] = (module, filePath) => {
  const result = ts.transpileModule(fs.readFileSync(filePath, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2019 },
    fileName: filePath,
    reportDiagnostics: true,
  })
  const errors = (result.diagnostics ?? []).filter(diagnostic => diagnostic.category === ts.DiagnosticCategory.Error)
  assert.deepEqual(errors, [], `failed to transpile ${filePath}`)
  module._compile(result.outputText, filePath)
}

const { formatMatchElapsed, matchWaitingText } = require(presentationPath)
const source = fs.readFileSync(matchmakingPagePath, 'utf8')

assert.equal(formatMatchElapsed(-1), '00:00')
assert.equal(formatMatchElapsed(12_999), '00:12')
assert.equal(formatMatchElapsed(65_000), '01:05')
assert.equal(formatMatchElapsed(Number.NaN), '00:00')
assert.match(matchWaitingText('快速匹配', 'requesting', 2_000), /快速匹配[\s\S]*正在请求匹配服务[\s\S]*已等待 00:02/)
assert.match(matchWaitingText('新手体验赛', 'queued', 61_000), /已进入队列[\s\S]*已等待 01:01 · 可随时取消/)
assert.doesNotMatch(matchWaitingText('快速匹配', 'queued', 1_000), /人|预计|成功率/, 'the client must not invent queue population or ETA')
assert.match(source, /scheduleMatchingWaitTick/, 'the matching page must refresh elapsed time while it remains visible')
assert.match(source, /activeMatchTicketId = ticket\.ticketId[\s\S]*matchingStage = 'queued'/, 'server queue acceptance must advance the visible stage')
assert.match(source, /this\.pageButton\(ui, '取消匹配'/, 'matching must keep an explicit cancel action')
assert.equal(fs.existsSync(`${presentationPath}.meta`), true, 'Cocos metadata is required for the presentation helper')

process.stdout.write('match waiting regression checks passed\n')
