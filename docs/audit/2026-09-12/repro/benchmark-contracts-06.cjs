// Audit-only module tree / report file system. Actual harness and benchmark code
// run with import.meta lowering and an ESM-local require binding rename needed
// for the CJS audit wrapper; all copies/writes are maps.
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const { createRequire, builtinModules } = require('node:module')
const { pathToFileURL } = require('node:url')
const root = path.resolve(__dirname, '../../../..')
const nativeRequire = createRequire(path.join(root, 'work/guandan-cocos/package.json'))
const ts = nativeRequire('typescript')
const aliases = new Map(), outputs = new Map(), cache = Object.create(null), logs = []
let trees = 0
const processPort = { argv: ['node', 'audit'], version: process.version }
const mapPath = filename => {
  for (const [virtual, actual] of aliases) if (filename === virtual || filename.startsWith(virtual + '/')) return actual + filename.slice(virtual.length)
  return filename
}
const exists = filename => { try { return fs.statSync(mapPath(filename)).isFile() } catch { return false } }
const resolveModule = (request, parent) => {
  if (request.startsWith('node:') || builtinModules.includes(request)) return request
  const filename = request.startsWith('/') ? request : path.resolve(path.dirname(parent), request)
  for (const candidate of [filename, filename + '.js', path.join(filename, 'index.js')]) if (outputs.has(candidate) || exists(candidate)) return candidate
  throw Error('Unmodelled module: ' + request + ' from ' + parent)
}
const read = (filename, encoding) => outputs.has(filename) ? outputs.get(filename) : fs.readFileSync(mapPath(filename), encoding)
const fsPort = {
  ...fs,
  mkdtempSync: prefix => prefix + 'audit-' + (++trees),
  cpSync: (source, target, options) => { assert.equal(options.recursive, true); assert.equal(source, path.join(root, 'shared-core/dist')); aliases.set(target, source) },
  readFileSync: read,
  writeFileSync: (filename, text) => { assert.ok(filename.startsWith('/audit-benchmark-output/')); outputs.set(filename, text) },
}
const ports = {
  'node:fs': fsPort,
  'node:os': { ...require('node:os'), tmpdir: () => '/audit-benchmark-trees' },
  'node:module': { ...require('node:module'), createRequire: origin => makeRequire(origin instanceof URL || String(origin).startsWith('file:') ? require('node:url').fileURLToPath(origin) : origin) },
}
function makeRequire (parent) {
  const requirePort = request => load(resolveModule(request, parent))
  requirePort.resolve = request => resolveModule(request, parent)
  requirePort.cache = cache
  return requirePort
}
function load (filename) {
  if (ports[filename]) return ports[filename]
  if (filename.startsWith('node:') || builtinModules.includes(filename)) return require(filename)
  if (cache[filename]) return cache[filename].exports
  const module = { exports: {} }
  cache[filename] = module
  let source = read(filename, 'utf8')
  if (filename.endsWith('.mjs')) source = ts.transpileModule(source.replaceAll('import.meta.url', JSON.stringify(pathToFileURL(filename).href)), {
    fileName: filename, compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, esModuleInterop: true },
    transformers: { before: [context => node => ts.visitNode(node, function visit (child) {
      if (ts.isIdentifier(child) && child.text === 'require') return context.factory.createIdentifier('scriptRequire')
      return ts.visitEachChild(child, visit, context)
    })] },
  }).outputText
  const execute = vm.runInThisContext('(function(require,module,exports,__filename,__dirname,process,console){\n' + source + '\n})', { filename })
  execute(makeRequire(filename), module, module.exports, filename, path.dirname(filename), processPort,
    { log: (...args) => logs.push(args.join(' ')), error: (...args) => logs.push(args.join(' ')) })
  return module.exports
}
function run (relative, args = []) {
  const filename = path.join(root, relative)
  processPort.argv = ['node', filename, ...args]
  delete cache[filename]
  return load(filename)
}

run('scripts/verify-team-parameter-harness.mjs')
assert.ok(logs.some(text => text.startsWith('Team parameter harness:')))
run('scripts/benchmark-team-ai.mjs', [path.join(root, 'shared-core/dist'), '2', '0'])
const baseline = JSON.parse(logs.at(-1))
assert.equal(baseline.invalid, 0)
assert.equal(baseline.wins, 2)
assert.deepEqual(baseline.pairResults, [1, 1])
run('scripts/benchmark-team-parameters.mjs', ['screen', '2', '2700000', 'reference,control', 'reference', '/audit-benchmark-output/small.json'])
const small = JSON.parse(outputs.get('/audit-benchmark-output/small.json'))
assert.equal(small.results.length, 2)
for (const result of small.results) {
  assert.equal(result.games.length, 4)
  assert.equal(result.invalidActions, 0)
  assert.equal(result.turns, result.timing.decisions + result.opponentTiming.decisions)
}
assert.deepEqual(small.results[0].pairWins, [1, 1])
const { acceptance, experiments } = load(path.join(root, 'scripts/support/team-policy-experiments.mjs'))
const { hash } = load(path.join(root, 'scripts/support/team-policy-benchmark.mjs'))
function stage (name, pairs, seedStart, names) {
  return { stage: name, pairs, seedStart, codeHash: 'synthetic-consistent', caveat: 'synthetic validation only', results: names.map(id => {
    const games = Array.from({ length: pairs }, (_, i) => ['teamA', 'teamB'].map(team => ({ seed: seedStart + i, team, won: team === 'teamA' }))).flat()
    return { name: id, parameters: experiments[id], opponent: 'reference', parameterHash: hash(experiments[id]), games,
      pairWins: Array(pairs).fill(1), wins: pairs, winRate: 0.5, turns: pairs * 2, invalidActions: 0,
      openingBombs: [0, 0], timing: { decisions: pairs, p95Ms: 1 }, opponentTiming: { decisions: pairs, p95Ms: 1 }, paired95: { lower: 0.5, upper: 0.5 } }
  }) }
}
const stages = [stage('screen', acceptance.trainPairs, acceptance.trainSeed, ['reference', 'exit']),
  stage('finalist', acceptance.finalistPairs, acceptance.finalistSeed, ['reference', 'exit']),
  stage('holdout', acceptance.holdoutPairs, acceptance.holdoutSeed, ['reference'])]
const paths = ['screen', 'finalist', 'holdout', 'summary'].map(name => '/audit-benchmark-output/' + name + '.json')
function saveStages () { stages.forEach((stage, i) => outputs.set(paths[i], JSON.stringify(stage))) }
saveStages()
run('scripts/report-team-parameters.mjs', paths)
const report = JSON.parse(outputs.get(paths[3]))
assert.equal(report.summary.chosen, 'reference')
assert.equal(report.summary.verdict.accepted, false)
stages[0].stage = 'holdout'
saveStages()
assert.throws(() => run('scripts/report-team-parameters.mjs', paths), assert.AssertionError)
stages[0].stage = 'screen'
stages[0].results[0].games[0].seed += 1
saveStages()
assert.throws(() => run('scripts/report-team-parameters.mjs', paths), assert.AssertionError)
stages[0].results[0].games[0].seed -= 1
stages[0].results[0].parameterHash = 'synthetic-wrong'
saveStages()
assert.throws(() => run('scripts/report-team-parameters.mjs', paths), assert.AssertionError)
const archived = JSON.parse(fs.readFileSync(path.join(root, 'docs/TEAM_POLICY_BENCHMARK_20260910.json'), 'utf8'))
Object.values(archived.stages).forEach((stage, i) => outputs.set(paths[i], JSON.stringify(stage)))
run('scripts/report-team-parameters.mjs', paths)
assert.deepEqual(JSON.parse(outputs.get(paths[3])).summary, archived.summary)
const { pairedConfidence } = load(path.join(root, 'scripts/support/team-policy-benchmark.mjs'))
const { createSeededRandom } = load(path.join(root, 'shared-core/dist/ai/random.js'))
for (const stage of Object.values(archived.stages)) for (const result of stage.results) {
  assert.deepEqual(pairedConfidence(result.pairWins, createSeededRandom(55190)), result.paired95)
}
console.log(JSON.stringify({ virtualModuleTrees: trees, realFilesystemWrites: 0,
  harness: 'passed with real compiled engines and isolated in-memory module copies',
  baselineGames: baseline.games, baselinePairWins: baseline.pairResults,
  parameterGames: small.results.reduce((sum, r) => sum + r.games.length, 0),
  syntheticReport: 'edge confidence retains reference; incorrect stage, paired seeds and parameter hash rejected',
  archivedReport: { gameRecordsRevalidated: archived.summary.games, selection: archived.summary.chosen, allPairedIntervalsRecomputed: true, gamesRerun: 0 },
  limitation: 'Small existing-dist samples, not a new parameter selection or full tuning run; report fixture is synthetic.' }, null, 2))
