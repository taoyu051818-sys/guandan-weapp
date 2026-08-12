import { readFile, readdir } from 'node:fs/promises'
import { dirname, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'

const here = dirname(fileURLToPath(import.meta.url))
const projectRoot = resolve(here, '..')
const scriptsRoot = resolve(projectRoot, 'assets/scripts')
const testsRoot = resolve(projectRoot, 'tests')
const failures = []

const listTypescript = async (directory = scriptsRoot) => {
  const entries = await readdir(directory, { withFileTypes: true })
  const nested = await Promise.all(entries.map(async entry => {
    const path = resolve(directory, entry.name)
    if (entry.isDirectory()) return await listTypescript(path)
    return entry.isFile() && entry.name.endsWith('.ts') ? [path] : []
  }))
  return nested.flat().sort()
}

const files = await listTypescript()
const fileSet = new Set(files)
const lowerLayers = new Set(['audio', 'core', 'effects', 'game', 'network', 'replay', 'services', 'session', 'ui'])
const runtimeDependencies = new Map()
const typeDependencies = new Map()
const directCocosDependencies = new Set()
const metaUuidOwners = new Map()

const resolveLocalModule = (file, specifier) => {
  if (!specifier.startsWith('.')) return null
  const base = resolve(dirname(file), specifier)
  for (const candidate of [`${base}.ts`, resolve(base, 'index.ts')]) {
    if (fileSet.has(candidate)) return candidate
  }
  return null
}

const runtimeModuleSpecifiers = (file, source) => {
  const sourceFile = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, false, ts.ScriptKind.TS)
  const specifiers = []
  const visit = node => {
    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
      const clause = node.importClause
      const bindings = clause?.namedBindings
      const hasRuntimeBinding = !clause || (!clause.isTypeOnly && Boolean(
        clause.name ||
        (bindings && ts.isNamespaceImport(bindings)) ||
        (bindings && ts.isNamedImports(bindings) && bindings.elements.some(element => !element.isTypeOnly)),
      ))
      if (hasRuntimeBinding) specifiers.push(node.moduleSpecifier.text)
    }
    if (ts.isExportDeclaration(node) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
      const exports = node.exportClause
      const hasRuntimeBinding = !node.isTypeOnly && (!exports || !ts.isNamedExports(exports) || exports.elements.some(element => !element.isTypeOnly))
      if (hasRuntimeBinding) specifiers.push(node.moduleSpecifier.text)
    }
    if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword && node.arguments.length === 1 && ts.isStringLiteral(node.arguments[0])) {
      specifiers.push(node.arguments[0].text)
    }
    ts.forEachChild(node, visit)
  }
  visit(sourceFile)
  return specifiers
}

const allModuleSpecifiers = (file, source) => {
  const sourceFile = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, false, ts.ScriptKind.TS)
  const specifiers = []
  const visit = node => {
    if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
      specifiers.push(node.moduleSpecifier.text)
    } else if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument) && ts.isStringLiteral(node.argument.literal)) {
      specifiers.push(node.argument.literal.text)
    } else if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword && node.arguments.length === 1 && ts.isStringLiteral(node.arguments[0])) {
      specifiers.push(node.arguments[0].text)
    }
    ts.forEachChild(node, visit)
  }
  visit(sourceFile)
  return specifiers
}

for (const file of files) {
  const localPath = relative(scriptsRoot, file)
  try {
    const metadata = JSON.parse(await readFile(`${file}.meta`, 'utf8'))
    const uuid = typeof metadata.uuid === 'string' ? metadata.uuid.trim() : ''
    if (!uuid) failures.push(`${localPath}: Cocos metadata has no uuid (${localPath}.meta)`)
    else {
      const previousOwner = metaUuidOwners.get(uuid)
      if (previousOwner) failures.push(`${localPath}: duplicate Cocos metadata uuid ${uuid} (already used by ${previousOwner})`)
      else metaUuidOwners.set(uuid, localPath)
    }
  } catch (error) {
    const detail = error instanceof SyntaxError ? 'invalid' : 'missing'
    failures.push(`${localPath}: ${detail} Cocos metadata (${localPath}.meta)`)
  }
  const source = await readFile(file, 'utf8')
  const importedModules = allModuleSpecifiers(file, source)
  for (const specifier of importedModules.filter(item => item.startsWith('.'))) {
    const targetFromProject = relative(projectRoot, resolve(dirname(file), specifier))
    if (targetFromProject === 'migration' || targetFromProject.startsWith('migration/')) {
      failures.push(`${localPath}: runtime assets must not import migration-only source (${specifier})`)
    }
  }
  if (importedModules.some(specifier => specifier === 'cc' || specifier.startsWith('cc/'))) {
    directCocosDependencies.add(file)
  }
  typeDependencies.set(file, importedModules
    .map(specifier => resolveLocalModule(file, specifier))
    .filter(Boolean))
  runtimeDependencies.set(file, runtimeModuleSpecifiers(file, source)
    .map(specifier => resolveLocalModule(file, specifier))
    .filter(Boolean))
  const topDirectory = localPath.split('/')[0]
  if (!lowerLayers.has(topDirectory)) continue
  for (const dependency of runtimeDependencies.get(file) ?? []) {
    const target = relative(scriptsRoot, dependency)
    if (target === 'scenes' || target.startsWith('scenes/')) {
      failures.push(`${localPath}: lower layer imports scene layer (${target})`)
    }
    if (localPath.startsWith('services/platform/') && target === 'services/DevelopmentApis.ts') {
      failures.push(`${localPath}: production platform module imports development adapters (${target})`)
    }
  }
}

const visited = new Set()
const active = new Set()
const stack = []
const reportedCycles = new Set()
const visit = file => {
  if (active.has(file)) {
    const start = stack.indexOf(file)
    const cycle = [...stack.slice(start), file].map(path => relative(scriptsRoot, path))
    const key = cycle.join(' -> ')
    if (!reportedCycles.has(key)) {
      reportedCycles.add(key)
      failures.push(`runtime dependency cycle: ${key}`)
    }
    return
  }
  if (visited.has(file)) return
  visited.add(file)
  active.add(file)
  stack.push(file)
  for (const dependency of runtimeDependencies.get(file) ?? []) visit(dependency)
  stack.pop()
  active.delete(file)
}
files.forEach(visit)

const cocosDependencies = new Set(directCocosDependencies)
let foundCocosDependency = true
while (foundCocosDependency) {
  foundCocosDependency = false
  for (const [file, dependencies] of typeDependencies) {
    if (cocosDependencies.has(file) || !dependencies.some(dependency => cocosDependencies.has(dependency))) continue
    cocosDependencies.add(file)
    foundCocosDependency = true
  }
}

const ciTypecheckConfigPath = resolve(projectRoot, 'tsconfig.ci-core.json')
const ciTypecheckConfig = ts.readConfigFile(ciTypecheckConfigPath, ts.sys.readFile)
if (ciTypecheckConfig.error) {
  failures.push(`tsconfig.ci-core.json: ${ts.flattenDiagnosticMessageText(ciTypecheckConfig.error.messageText, '\n')}`)
} else {
  const parsed = ts.parseJsonConfigFileContent(ciTypecheckConfig.config, ts.sys, projectRoot, undefined, ciTypecheckConfigPath)
  for (const diagnostic of parsed.errors) {
    failures.push(`tsconfig.ci-core.json: ${ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n')}`)
  }
  if (!parsed.options.strict || !parsed.options.noEmit) {
    failures.push('tsconfig.ci-core.json: CI core typecheck must keep strict and noEmit enabled')
  }
  const ciTypecheckRoots = new Set(parsed.fileNames.map(path => resolve(path)))
  for (const file of files) {
    const localPath = relative(scriptsRoot, file)
    if (!cocosDependencies.has(file) && !ciTypecheckRoots.has(file)) {
      failures.push(`${localPath}: Cocos-independent module is missing from tsconfig.ci-core.json`)
    }
    if (cocosDependencies.has(file) && ciTypecheckRoots.has(file)) {
      failures.push(`${localPath}: Cocos-dependent module must not be a tsconfig.ci-core.json root`)
    }
  }
}

const packageJson = JSON.parse(await readFile(resolve(projectRoot, 'package.json'), 'utf8'))
const defaultTestCommand = String(packageJson.scripts?.test ?? '')
const rootTests = (await readdir(testsRoot, { withFileTypes: true }))
  .filter(entry => entry.isFile() && entry.name.endsWith('.cjs'))
  .map(entry => entry.name)
  .sort()
for (const testFile of rootTests) {
  if (!defaultTestCommand.includes(`tests/${testFile}`)) {
    failures.push(`tests/${testFile}: not registered in the default package test command`)
  }
}

// Budgets are architectural guardrails, not style rules. Lower them after a
// responsibility is extracted; never raise one to make a new feature fit.
const lineBudgets = {
  'core/generated/ai/engine.ts': 280,
  'core/generated/ai/decisionRunner.ts': 370,
  'core/generated/ai/policyOverrides.ts': 210,
  'core/generated/ai/fallbackDecision.ts': 220,
  'core/generated/ai/decisionSupport.ts': 480,
  'core/generated/ai/search.ts': 550,
  'core/generated/ai/strategies/master.ts': 600,
  'game/GameManager.ts': 500,
  'game/HandArrangement.ts': 50,
  'game/HandArrangementModel.ts': 240,
  'game/HandDisplayOrdering.ts': 190,
  'game/HandGroupSuggestions.ts': 340,
  'game/HandGrouping.ts': 650,
  'game/HandGroupingState.ts': 290,
  'game/NetworkMatchSnapshotController.ts': 180,
  'scenes/GameScene.ts': 700,
  'scenes/TableMatchCoordinator.ts': 520,
  'scenes/TableNetworkEventBridge.ts': 105,
  'scenes/TableHudPresenter.ts': 230,
  'ui/TableGameHud.ts': 560,
  'ui/TableHudTurnTimerView.ts': 105,
  'ui/TableHudDynamicRenderer.ts': 150,
  'ui/TableHudSeatViewGroup.ts': 210,
  'services/PlatformApi.ts': 30,
  'network/LobbyController.ts': 500,
  'network/LobbyCommandSender.ts': 55,
  'network/LobbyConnectionEventCoordinator.ts': 80,
  'network/LobbyMessageRouter.ts': 210,
  'scenes/front-pages/MatchmakingPageDomain.ts': 390,
  'scenes/front-pages/LobbyPageDomain.ts': 630,
  'scenes/front-pages/LobbyPlayerProfilePresenter.ts': 135,
  'scenes/front-pages/FriendRoomSettingsPresenter.ts': 270,
  'development/EffectLabSceneHost.ts': 215,
  'development/EffectLabPreviewRunner.ts': 165,
  'effects/EffectController.ts': 500,
  'effects/EffectActionPresentationCoordinator.ts': 120,
  'effects/EffectPlaybackCoordinator.ts': 240,
  'scenes/SceneBackdropController.ts': 180,
  'scenes/StartupCoordinator.ts': 160,
  'scenes/TableOverlayController.ts': 460,
  'scenes/TableTurnClockController.ts': 210,
  'scenes/TableHandInteractionController.ts': 310,
}

for (const [path, maximum] of Object.entries(lineBudgets)) {
  const source = await readFile(resolve(scriptsRoot, path), 'utf8')
  const lines = source.split(/\r?\n/).length - 1
  if (lines > maximum) failures.push(`${path}: ${lines} lines exceeds budget ${maximum}`)
}

if (failures.length) {
  console.error(`Architecture checks failed:\n${failures.map(item => `- ${item}`).join('\n')}`)
  process.exitCode = 1
} else {
  console.log(`Architecture checks passed (${files.length} modules, ${Object.keys(lineBudgets).length} size budgets)`)
}
