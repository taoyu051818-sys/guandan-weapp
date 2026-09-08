import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { dirname, resolve, relative, basename, extname } from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'

// Read-only inventory. Reachability is evidence, never permission to delete.
const appRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const repoRoot = resolve(appRoot, '../..')
const roots = [
  ['client', resolve(appRoot, 'assets/scripts')],
  ['core', resolve(repoRoot, 'shared-core/src')],
  ['server', resolve(repoRoot, 'work/guandan-windows-source/server')],
]
const walk = dir => readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
  const file = resolve(dir, entry.name)
  return entry.isDirectory() ? walk(file) : [file]
})
const modules = new Map()
// Explicit non-game entries: adding a test must not silently justify shipping an orphan.
const retained = new Map([
  ['shared-core/src/lib/ai.ts', 'compatibility API for legacy native/worker integrations'],
  ['work/guandan-windows-source/server/index.js', 'fail-fast retired entry; guards accidental legacy server launch'],
  ['work/guandan-windows-source/server/hk-bare-ip-profile.js', 'used by the standalone hk-bare-ip-test-preflight.mjs CLI'],
])
for (const [scope, root] of roots) for (const file of walk(root)) {
  if (!(scope === 'server' ? file.endsWith('.js') : file.endsWith('.ts'))) continue
  const source = readFileSync(file, 'utf8')
  modules.set(file, { scope, file: relative(repoRoot, file), source,
    lines: source.split(/\r?\n/).length - Number(source.endsWith('\n')), imports: [], runtimeImports: [],
    dependents: [], testMentions: [], entry: false, component: /@ccclass\(/.test(source) })
}
const resolveImport = (file, specifier) => {
  if (!specifier.startsWith('.')) return null
  let base = resolve(dirname(file), specifier)
  const coreDist = resolve(repoRoot, 'shared-core/dist')
  if (base.startsWith(`${coreDist}/`)) base = resolve(repoRoot, 'shared-core/src', relative(coreDist, base)).replace(/\.js$/, '.ts')
  return [base, `${base}.ts`, `${base}.js`, resolve(base, 'index.ts'), resolve(base, 'index.js')]
    .find(candidate => modules.has(candidate)) ?? null
}
for (const [file, info] of modules) {
  const ast = ts.createSourceFile(file, info.source, ts.ScriptTarget.Latest, true)
  const add = (specifier, runtime) => {
    const target = resolveImport(file, specifier)
    if (!target) return
    if (!info.imports.includes(target)) info.imports.push(target)
    if (runtime && !info.runtimeImports.includes(target)) info.runtimeImports.push(target)
  }
  const visit = node => {
    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
      const clause = node.importClause
      const bindings = clause?.namedBindings
      add(node.moduleSpecifier.text, !clause || (!clause.isTypeOnly && Boolean(clause.name ||
        (bindings && (ts.isNamespaceImport(bindings) || bindings.elements.some(item => !item.isTypeOnly))))))
    } else if (ts.isExportDeclaration(node) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
      add(node.moduleSpecifier.text, !node.isTypeOnly && (!node.exportClause || !ts.isNamedExports(node.exportClause) || node.exportClause.elements.some(item => !item.isTypeOnly)))
    } else if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument) && ts.isStringLiteral(node.argument.literal)) {
      add(node.argument.literal.text, false)
    } else if (ts.isCallExpression(node) && node.arguments.length && ts.isStringLiteral(node.arguments[0]) &&
      (node.expression.kind === ts.SyntaxKind.ImportKeyword || (ts.isIdentifier(node.expression) && node.expression.text === 'require'))) {
      add(node.arguments[0].text, true)
    }
    ts.forEachChild(node, visit)
  }
  visit(ast)
  for (const target of info.imports) modules.get(target).dependents.push(file)
}

const entryReasons = new Map()
const entry = (file, reason) => { if (modules.has(file)) entryReasons.set(file, reason) }
entry(resolve(appRoot, 'assets/scripts/scenes/GameScene.ts'), 'Cocos composition root')
entry(resolve(repoRoot, 'shared-core/src/index.ts'), 'public shared rule API')
for (const name of ['weapp-ws.js', 'platform-server.js']) entry(resolve(roots[2][1], name), 'server process entry')
const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'
const compressedUuid = uuid => {
  const hex = uuid.replace(/-/g, '')
  if (!/^[\da-f]{32}$/i.test(hex)) return uuid
  let out = hex.slice(0, 5)
  for (let i = 5; i < 32; i += 3) { const n = parseInt(hex.slice(i, i + 3), 16); out += alphabet[n >> 6] + alphabet[n & 63] }
  return out
}
const serialized = walk(resolve(appRoot, 'assets')).filter(file => /\.(scene|prefab)$/.test(file)).map(file => readFileSync(file, 'utf8')).join('\n')
for (const [file, info] of modules) {
  if (info.scope !== 'client' || !existsSync(`${file}.meta`)) continue
  const { uuid } = JSON.parse(readFileSync(`${file}.meta`, 'utf8'))
  if (uuid && (serialized.includes(uuid) || serialized.includes(compressedUuid(uuid)))) entry(file, 'serialized Cocos UUID')
}
const reachable = kind => {
  const seen = new Set()
  const visit = file => { if (seen.has(file)) return; seen.add(file); modules.get(file)[kind].forEach(visit) }
  for (const file of entryReasons.keys()) visit(file)
  return seen
}
const runtime = reachable('runtimeImports')
const all = reachable('imports')
const testFiles = [resolve(appRoot, 'tests'), resolve(repoRoot, 'shared-core/tests'), roots[2][1]]
  .filter(existsSync).flatMap(walk).filter(file => /(?:\.cjs|\.(?:test|smoke)\.[cm]?[jt]s)$/.test(file))
const testSources = testFiles.map(file => [relative(repoRoot, file), readFileSync(file, 'utf8')])
for (const info of modules.values()) {
  const name = basename(info.file, extname(info.file))
  info.testMentions = testSources.filter(([, source]) => source.includes(basename(info.file)) ||
    ["'", '"', '`'].some(quote => source.includes(`/${name}${quote}`))).map(([file]) => file)
}
const records = [...modules].map(([file, info]) => {
  const status = runtime.has(file) ? 'runtime' : all.has(file) ? 'type-only' : retained.has(info.file) ? 'retained-entry' : info.component ? 'component-review' : 'unreached-review'
  const risks = []
  if (info.lines > 600) risks.push('large-file')
  if (info.dependents.length >= 18) risks.push('high-fan-in')
  if (info.runtimeImports.length >= 18) risks.push('high-fan-out')
  if (!info.testMentions.length) risks.push('no-direct-test-mention')
  return { file: info.file, scope: info.scope, lines: info.lines, status, entry: entryReasons.get(file) ?? retained.get(info.file) ?? null,
    generated: info.file.includes('/core/generated/'), imports: info.imports.map(p => relative(repoRoot, p)),
    dependents: info.dependents.map(p => relative(repoRoot, p)), testMentions: info.testMentions, risks }
}).sort((a, b) => a.file.localeCompare(b.file))
const summary = Object.fromEntries(roots.map(([scope]) => {
  const selected = records.filter(info => info.scope === scope)
  return [scope, { files: selected.length, lines: selected.reduce((sum, info) => sum + info.lines, 0),
    runtime: selected.filter(info => info.status === 'runtime').length,
    review: selected.filter(info => /review$/.test(info.status)).map(info => info.file) }]
}))
if (process.argv.includes('--check')) {
  const unreviewed = records.filter(info => /review$/.test(info.status))
  const stale = [...retained.keys()].filter(file => !records.some(info => info.file === file && info.status === 'retained-entry'))
  if (unreviewed.length || stale.length) {
    console.error('Code health inventory requires review:', unreviewed.map(info => info.file), 'stale retention entries:', stale)
    process.exitCode = 1
  } else console.log(`Code health inventory passed (${records.length} files; ${retained.size} documented non-game entries)`)
} else if (process.argv.includes('--json')) console.log(JSON.stringify({ summary, records }, null, 2))
else {
  console.log('# 逐文件代码健康清单\n\n由 `node scripts/audit-code-health.mjs` 只读生成。')
  console.log('\n范围：Cocos 运行源码、共享规则源码、权威服务端 JS；不含构建产物、第三方素材和归档工程。')
  console.log('\nruntime=语法级保守入口可达（不等同于打包器最终保留）；type-only=仅类型可达；retained-entry=明确保留的兼容/工具入口；review=需人工核对，不能据此直接删除。')
  console.log('\n测试提及数是静态文本关联，**不是测试覆盖率**。large-file >600 行；高入度/出度 ≥18。生成规则只改 shared-core，不能直接改 generated。')
  console.log('\n| 范围 | 文件 | 行数 | 运行入口可达 | 待核对 |\n| --- | ---: | ---: | ---: | ---: |')
  for (const [scope, info] of Object.entries(summary)) console.log(`| ${scope} | ${info.files} | ${info.lines} | ${info.runtime} | ${info.review.length} |`)
  console.log('\n| 文件 | 行数 | 状态 | 入/出依赖 | 测试提及 | 维护提醒 | 开发建议 |\n| --- | ---: | --- | --- | ---: | --- | --- |')
  for (const info of records) {
    const advice = info.generated ? '只读，改共享源' : info.status === 'retained-entry' ? '保留兼容/工具边界' :
      info.status === 'type-only' ? '稳定契约，检查调用方' : info.risks.some(risk => ['large-file', 'high-fan-out'].includes(risk)) ? '限制新增职责，优先拆分' :
      info.risks.includes('high-fan-in') ? '公共基础，兼容性优先' : !info.testMentions.length ? '扩展前核对间接测试' : '可按现有职责扩展'
    console.log(`| ${info.file} | ${info.lines} | ${info.status}${info.generated ? ' · generated' : ''} | ${info.dependents.length}/${info.imports.length} | ${info.testMentions.length} | ${info.risks.join(', ') || '—'} | ${advice} |`)
  }
}
