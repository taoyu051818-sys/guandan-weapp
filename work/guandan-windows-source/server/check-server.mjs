import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { dirname, extname, join, relative, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const serverDir = dirname(fileURLToPath(import.meta.url))

const productionJavaScriptFiles = (directory) =>
  readdirSync(directory, { withFileTypes: true })
    .flatMap((entry) => {
      const path = join(directory, entry.name)
      return entry.isDirectory() ? productionJavaScriptFiles(path) : [path]
    })
    .filter((path) => extname(path) === '.js')
    .sort()

const files = productionJavaScriptFiles(serverDir)
if (files.length === 0) {
  throw new Error(`No production JavaScript files found under ${serverDir}`)
}

const fileSet = new Set(files.map(file => resolve(file)))
const localDependencies = new Map()
const staticModulePattern = /\b(?:import|export)\s+(?:[^'";]*?\sfrom\s*)?['"]([^'"]+)['"]/g
const dynamicImportPattern = /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g
const requirePattern = /\brequire\s*\(\s*['"]([^'"]+)['"]\s*\)/g
const resolveLocalModule = (file, specifier) => {
  if (!specifier.startsWith('.')) return null
  const base = resolve(dirname(file), specifier)
  return [base, `${base}.js`, join(base, 'index.js')].find(candidate => fileSet.has(candidate)) || null
}

for (const file of files) {
  const source = readFileSync(file, 'utf8')
  const result = spawnSync(process.execPath, ['--check', file], {
    encoding: 'utf8',
  })

  if (result.status !== 0) {
    process.stderr.write(result.stdout)
    process.stderr.write(result.stderr)
    process.exit(result.status ?? 1)
  }

  const specifiers = [
    ...source.matchAll(staticModulePattern),
    ...source.matchAll(dynamicImportPattern),
    ...source.matchAll(requirePattern),
  ].map(match => match[1])
  for (const specifier of specifiers.filter(value => value.startsWith('.'))) {
    const base = resolve(dirname(file), specifier)
    if (![base, `${base}.js`, `${base}.json`, join(base, 'index.js')].some(existsSync)) {
      throw new Error(`${relative(serverDir, file)} imports missing local module: ${specifier}`)
    }
  }
  localDependencies.set(file, specifiers.map(specifier => resolveLocalModule(file, specifier)).filter(Boolean))
}

const visited = new Set()
const active = new Set()
const stack = []
const visit = file => {
  if (active.has(file)) {
    const start = stack.indexOf(file)
    const cycle = [...stack.slice(start), file].map(path => relative(serverDir, path)).join(' -> ')
    throw new Error(`Server runtime dependency cycle: ${cycle}`)
  }
  if (visited.has(file)) return
  visited.add(file)
  active.add(file)
  stack.push(file)
  for (const dependency of localDependencies.get(file) || []) visit(dependency)
  stack.pop()
  active.delete(file)
}
files.forEach(visit)

const packageJson = JSON.parse(readFileSync(resolve(serverDir, '..', 'package.json'), 'utf8'))
const defaultTestCommands = ['test:static', 'test:platform', 'test:weapp-server']
  .map(name => String(packageJson.scripts?.[name] || ''))
  .join(' ')
const directlyRegisteredTests = new Set(
  [...defaultTestCommands.matchAll(/\bserver\/[^\s&]+\.(?:test|smoke)\.mjs\b/g)].map(match => match[0]),
)
const coveredTests = new Set()
const collectCoveredTests = testPath => {
  if (coveredTests.has(testPath)) return
  coveredTests.add(testPath)
  const source = readFileSync(resolve(serverDir, '..', testPath), 'utf8')
  const directory = dirname(testPath)
  for (const match of source.matchAll(/\bimport\s+(?:[^'";]*?\sfrom\s*)?['"]([^'"]+\.(?:test|smoke)\.mjs)['"]/g)) {
    const imported = relative(resolve(serverDir, '..'), resolve(resolve(serverDir, '..', directory), match[1]))
    collectCoveredTests(imported)
  }
}
directlyRegisteredTests.forEach(collectCoveredTests)
const serverTestFiles = readdirSync(serverDir, { withFileTypes: true })
  .flatMap(entry => entry.isDirectory()
    ? readdirSync(join(serverDir, entry.name), { withFileTypes: true })
      .filter(child => child.isFile())
      .map(child => `${entry.name}/${child.name}`)
    : [entry.name])
  .filter(path => /\.(?:test|smoke)\.mjs$/.test(path))
for (const testFile of serverTestFiles) {
  if (!coveredTests.has(`server/${testFile}`)) {
    throw new Error(`${testFile} is not registered in the default server test chain`)
  }
}

// Architectural budgets guard extracted responsibilities from flowing back
// into the two server composition roots. Lower after each extraction; never
// raise merely to fit a new feature.
const lineBudgets = {
  'platform/storage.js': 180,
  'platform/state-migrations.js': 270,
  'platform/report-event-contract.js': 30,
  'platform/report-delivery-lifetime.js': 90,
  'platform/result-reporter.js': 200,
  'platform/spectator-event-reporter.js': 180,
  'platform/service.js': 460,
  'platform/spectator-event-service.js': 375,
  'platform/state-collections.js': 25,
  'platform/account-service.js': 240,
  'platform/commerce-service.js': 140,
  'platform/tournament-service.js': 245,
  'platform/tournament-standings.js': 55,
  'platform/friend-room-service.js': 460,
  'platform/spectator-domain.js': 300,
  'platform/merchant-service.js': 220,
  'platform/matchmaking-service.js': 350,
  'platform/game-result-service.js': 320,
  'weapp-ws.js': 825,
  'weapp-runtime-persistence.js': 65,
  'weapp-room-metadata.js': 145,
  'weapp-room-expiry.js': 75,
  'weapp-room-expiry-jobs.js': 50,
  'weapp-match-lifecycle.js': 480,
  'weapp-room-action-executor.js': 100,
  'weapp-game-start-coordinator.js': 320,
  'weapp-runtime-recovery.js': 130,
  'weapp-operation-scheduler.js': 70,
  'weapp-accepted-action-store.js': 60,
  'weapp-websocket-transport.js': 160,
  'weapp-room-publisher.js': 200,
  'weapp-command-gateway.js': 150,
  'weapp-command-publication.js': 35,
  'weapp-room-exit.js': 125,
  'weapp-entry-command-handler.js': 350,
  'weapp-lobby-command-handler.js': 180,
  'weapp-game-command-handler.js': 190,
}
for (const [localPath, budget] of Object.entries(lineBudgets)) {
  const file = join(serverDir, localPath)
  const lines = readFileSync(file, 'utf8').split(/\r?\n/).length
  if (lines > budget) {
    throw new Error(`${relative(serverDir, file)} exceeds architecture budget: ${lines} > ${budget}`)
  }
}

console.log(`Server checks passed (${files.length} production JavaScript files, ${Object.keys(lineBudgets).length} size budgets)`)
