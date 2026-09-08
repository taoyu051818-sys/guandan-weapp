const assert = require('node:assert/strict')
const fs = require('node:fs')
const Module = require('node:module')
const path = require('node:path')
const { loadTypeScript } = require('./support/typescript.cjs')

const root = path.resolve(__dirname, '..')
const sourcePath = path.join(root, 'migration/rules/RuleHelpProjection.ts')
const ts = loadTypeScript()
const output = ts.transpileModule(fs.readFileSync(sourcePath, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  fileName: sourcePath,
}).outputText
const runtime = new Module(sourcePath, module)
runtime.filename = sourcePath
runtime.paths = Module._nodeModulePaths(path.dirname(sourcePath))
runtime._compile(output, sourcePath)

const { projectRuleHelp } = runtime.exports
const classic = projectRuleHelp({ allowA2345Straight: true, straightFlushAsBomb: true, enableTripleWithPair: true })
assert.equal(Object.isFrozen(classic), true)
assert.equal(classic.length, 5)
assert.match(classic.map(page => page.content).join('\n'), /A2345可作为最小顺子/)
assert.match(classic.map(page => page.content).join('\n'), /同花顺按五张半炸弹/)
assert.match(classic.map(page => page.content).join('\n'), /三带二可用/)

const strict = projectRuleHelp({ allowA2345Straight: false, straightFlushAsBomb: false, enableTripleWithPair: false })
const strictText = strict.map(page => page.content).join('\n')
assert.match(strictText, /A2345不能组成顺子/)
assert.match(strictText, /同花顺按普通顺子/)
assert.match(strictText, /三带二关闭/)
assert.doesNotMatch(strictText, /同花顺按五张半炸弹/)

process.stdout.write('rule help projection regression checks passed\n')
