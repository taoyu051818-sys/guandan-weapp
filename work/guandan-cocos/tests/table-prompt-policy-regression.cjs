const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const projectRoot = path.resolve(__dirname, '..')
const sourcePath = path.join(projectRoot, 'assets/scripts/ui/TablePromptPolicy.ts')
const { compilerPath, loadTypeScript } = require('./support/typescript.cjs')
const ts = loadTypeScript()
const source = fs.readFileSync(sourcePath, 'utf8')
const result = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2019 },
  fileName: sourcePath,
  reportDiagnostics: true,
})
const errors = (result.diagnostics ?? []).filter(diagnostic => diagnostic.category === ts.DiagnosticCategory.Error)
assert.deepEqual(errors, [])
const moduleRecord = { exports: {} }
new Function('exports', 'module', 'require', result.outputText)(moduleRecord.exports, moduleRecord, require)
const { tableHintToast } = moduleRecord.exports

for (const hint of [
  '轮到你出牌',
  '玩家二 正在思考…',
  '请等待其他玩家出牌',
  '正在等待服务器确认',
  '请选择手牌',
  '牌型不合法',
  '可出 · 对子',
  '提示：顺子 · 可出',
]) {
  assert.equal(tableHintToast(hint, 'playing'), null, `${hint} is redundant table narration`)
}

assert.equal(tableHintToast('手牌已更新，请重新选择', 'playing'), '手牌已更新，请重新选择')
assert.equal(tableHintToast('没有可用提示，请选择不要', 'playing'), '没有可用提示，请选择不要')
assert.equal(tableHintToast('当前不能不要', 'playing'), '当前不能不要', 'an always-visible pass action needs concise rejection feedback')
assert.equal(tableHintToast('网络未连接，请稍后重试', 'playing'), '网络未连接，请稍后重试')
assert.equal(tableHintToast('进贡或还贡只能选择一张牌', 'tribute'), null, 'blocking phases own their central copy')
assert.equal(tableHintToast('本局结束', 'settlement'), null, 'settlement copy belongs to the settlement layer')

process.stdout.write('table prompt policy regression checks passed\n')
