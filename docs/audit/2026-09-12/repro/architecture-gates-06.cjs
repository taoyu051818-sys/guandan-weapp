// Audit-only fault injection. Read the actual checker; overlay files in memory.
// No product files, package scripts, metadata or TS configuration are changed.
const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const path = require('node:path')
const { pathToFileURL } = require('node:url')
const { createRequire } = require('node:module')
const root = path.resolve(__dirname, '../../../..')
const project = path.join(root, 'work/guandan-cocos')
const checker = path.join(project, 'scripts/check-architecture.mjs')
const requireProject = createRequire(path.join(project, 'package.json'))
const ts = requireProject('typescript')
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor
const card = path.join(project, 'assets/scripts/ui/CardView.ts')
const scene = path.join(project, 'assets/scripts/scenes/GameScene.ts')
const results = []

async function main () {
  const original = await fs.readFile(checker, 'utf8')
  const code = ts.transpileModule(original.replaceAll('import.meta.url', JSON.stringify(pathToFileURL(checker).href)), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, esModuleInterop: true },
  }).outputText
  const run = new AsyncFunction('require', 'exports', 'process', 'console', code)
  async function probe (name, overlay, expected, { orphan = false } = {}) {
    const output = []
    const processPort = { exitCode: 0 }
    const fsPort = {
      ...fs,
      readFile: async (file, encoding) => {
        const absolute = path.resolve(String(file))
        if (overlay.has(absolute)) {
          const value = overlay.get(absolute)
          if (value instanceof Error) throw value
          return value
        }
        return fs.readFile(file, encoding)
      },
      readdir: async (directory, options) => {
        const entries = await fs.readdir(directory, options)
        if (orphan && path.resolve(directory) === path.dirname(card)) {
          entries.push({ name: 'SyntheticOrphan.ts.meta', isDirectory: () => false, isFile: () => true })
        }
        return entries
      },
    }
    await run(id => id === 'node:fs/promises' ? fsPort : requireProject(id), {}, processPort,
      { log: (...args) => output.push(args.join(' ')), error: (...args) => output.push(args.join(' ')) })
    const text = output.join('\n')
    assert.equal(processPort.exitCode, expected ? 1 : 0, `${name}: ${text}`)
    if (expected) assert.match(text, expected, name)
    results.push({ name, rejected: processPort.exitCode === 1 })
  }
  const cardSource = await fs.readFile(card, 'utf8')
  const appendCard = text => new Map([[card, cardSource + '\n' + text + '\n']])
  await probe('unmodified-current-checker', new Map(), null)
  await probe('missing-script-metadata', new Map([[card + '.meta', Object.assign(new Error('synthetic absent'), { code: 'ENOENT' })]]), /missing Cocos metadata/)
  await probe('invalid-script-metadata', new Map([[card + '.meta', '{']]), /invalid Cocos metadata/)
  await probe('missing-uuid', new Map([[card + '.meta', '{}']]), /metadata has no uuid/)
  await probe('duplicate-uuid', new Map([[card + '.meta', await fs.readFile(scene + '.meta', 'utf8')]]), /duplicate Cocos metadata uuid/)
  await probe('orphan-metadata', new Map(), /orphan script metadata/, { orphan: true })
  await probe('unresolved-local-import', appendCard("import '../SyntheticMissing'"), /unresolved local module/)
  await probe('lower-to-scene-runtime-import', appendCard("import { GameScene as SyntheticScene } from '../scenes/GameScene'"), /lower layer imports scene layer/)
  await probe('runtime-cycle', appendCard("export { GameScene as SyntheticScene } from '../scenes/GameScene'"), /runtime dependency cycle/)
  await probe('literal-dynamic-import', appendCard("const synthetic = import('../scenes/GameScene')"), /lower layer imports scene layer/)
  await probe('type-only-import-not-runtime-cycle', appendCard("import type { GameScene as SyntheticScene } from '../scenes/GameScene'"), null)
  await probe('inline-type-only-import-not-runtime-cycle', appendCard("import { type GameScene as SyntheticScene } from '../scenes/GameScene'"), null)
  await probe('type-only-export-not-runtime-cycle', appendCard("export type { GameScene as SyntheticScene } from '../scenes/GameScene'"), null)
  await probe('migration-runtime-boundary', appendCard("import '../../../migration/rules/RuleHelpProjection'"), /must not import migration-only source/)
  const packagePath = path.join(project, 'package.json')
  const pkg = JSON.parse(await fs.readFile(packagePath, 'utf8'))
  pkg.scripts.test = pkg.scripts.test.replace('tests/architecture-regression.cjs', 'tests/SyntheticMissing.cjs')
  await probe('unregistered-root-test', new Map([[packagePath, JSON.stringify(pkg)]]), /architecture-regression.cjs: not registered/)
  await probe('size-budget', new Map([[scene, await fs.readFile(scene, 'utf8') + '\n'.repeat(1000)]]), /GameScene.ts: \d+ lines exceeds budget/)
  // These are explicitly scanner limitations, not evidence of a current runtime defect.
  // Current production TS search contains no require/import-equals dependencies.
  await probe('boundary-only-commonjs-require-unmodelled', appendCard("const synthetic = require('../scenes/GameScene')"), null)
  await probe('boundary-only-nonliteral-dynamic-import-unmodelled', appendCard("const syntheticPath = '../scenes/GameScene'; const synthetic = import(syntheticPath)"), null)
  console.log(JSON.stringify({ checks: results.length, results }, null, 2))
}
main().catch(error => { console.error(error); process.exitCode = 1 })
