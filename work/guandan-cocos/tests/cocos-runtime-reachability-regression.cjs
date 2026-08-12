const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { loadTypeScript } = require('./support/typescript.cjs')

const projectRoot = path.resolve(__dirname, '..')
const scriptsRoot = path.join(projectRoot, 'assets/scripts')
const scenePath = path.join(projectRoot, 'assets/scenes/Game.scene')
const gameScenePath = path.join(scriptsRoot, 'scenes/GameScene.ts')
const ts = loadTypeScript()
const base64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'

const compressUuid = uuid => {
  const hex = uuid.replace(/-/g, '')
  assert.equal(hex.length, 32, `invalid Cocos uuid: ${uuid}`)
  let compressed = hex.slice(0, 5)
  for (let index = 5; index < 32; index += 3) {
    const value = Number.parseInt(hex.slice(index, index + 3), 16)
    compressed += base64[value >> 6] + base64[value & 63]
  }
  return compressed
}

const resolveLocalModule = (owner, specifier) => {
  if (!specifier.startsWith('.')) return null
  const base = path.resolve(path.dirname(owner), specifier)
  return [`${base}.ts`, path.join(base, 'index.ts')].find(candidate => fs.existsSync(candidate)) ?? null
}

const runtimeImports = filePath => {
  const source = fs.readFileSync(filePath, 'utf8')
  const sourceFile = ts.createSourceFile(filePath, source, ts.ScriptTarget.Latest, false, ts.ScriptKind.TS)
  const imports = []
  const visit = node => {
    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
      const clause = node.importClause
      const bindings = clause?.namedBindings
      const hasRuntimeBinding = !clause || (!clause.isTypeOnly && Boolean(
        clause.name ||
        (bindings && ts.isNamespaceImport(bindings)) ||
        (bindings && ts.isNamedImports(bindings) && bindings.elements.some(element => !element.isTypeOnly)),
      ))
      if (hasRuntimeBinding) {
        const resolved = resolveLocalModule(filePath, node.moduleSpecifier.text)
        if (resolved) imports.push(resolved)
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(sourceFile)
  return imports
}

const reachable = new Set()
const visit = filePath => {
  if (reachable.has(filePath)) return
  reachable.add(filePath)
  runtimeImports(filePath).forEach(visit)
}
visit(gameScenePath)

const expectedRuntimeModules = [
  'game/GameManager.ts',
  'game/LocalAITurnController.ts',
  'game/LocalHandSelectionController.ts',
  'game/LocalMatchController.ts',
  'game/LocalMatchEventController.ts',
  'game/LocalTurnScheduler.ts',
  'game/NetworkActionController.ts',
  'game/SynchronousLocalAIEngine.ts',
  'session/GameSession.ts',
  'network/LobbyController.ts',
  'audio/CocosAudioController.ts',
  'scenes/TableOverlayController.ts',
  'scenes/TableTurnClockController.ts',
  'scenes/TableHandInteractionController.ts',
  'scenes/TableSnapshotPresenter.ts',
  'ui/HandController.ts',
  'ui/PlayAreaController.ts',
  'ui/PlayerSeatController.ts',
  'ui/TableGameHud.ts',
  'ui/TableHudSeatViewGroup.ts',
]

for (const relativePath of expectedRuntimeModules) {
  const filePath = path.join(scriptsRoot, relativePath)
  assert.equal(reachable.has(filePath), true, `${relativePath} must stay runtime-reachable from the serialized GameScene component`)
  const metadata = JSON.parse(fs.readFileSync(`${filePath}.meta`, 'utf8'))
  assert.match(metadata.uuid, /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/)
}

const scene = fs.readFileSync(scenePath, 'utf8')
const gameSceneMetadata = JSON.parse(fs.readFileSync(`${gameScenePath}.meta`, 'utf8'))
assert.match(scene, new RegExp(`"__type__": "${compressUuid(gameSceneMetadata.uuid)}"`), 'Game.scene must serialize the GameScene script UUID')

process.stdout.write(`Cocos runtime reachability verified (${expectedRuntimeModules.length} live modules)\n`)
