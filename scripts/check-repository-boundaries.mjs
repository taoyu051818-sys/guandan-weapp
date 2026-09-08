import assert from 'node:assert/strict'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const serverRoot = join(root, 'work/guandan-windows-source')
const retiredPaths = [
  'work/guandan-weapp',
  'work/guandan-windows-source/src',
  'work/guandan-windows-source/public',
  'work/guandan-windows-source/.trae',
  'work/guandan-windows-source/scripts/ai-auto-tune.ts',
  'work/guandan-windows-source/main.js',
  'work/guandan-windows-source/index.html',
  'work/guandan-windows-source/capacitor.config.ts',
  'work/guandan-windows-source/vite.config.ts',
  'work/guandan-windows-source/postcss.config.js',
  'work/guandan-windows-source/tailwind.config.js',
  'work/guandan-cocos/tools/lobby-motion-lab',
]
for (const path of retiredPaths) assert.equal(existsSync(join(root, path)), false, 'Retired project returned: ' + path)
for (const path of ['shared-core/src/index.ts', 'work/guandan-cocos/assets/scenes/Game.scene', 'work/guandan-windows-source/server/weapp-ws.js', 'work/guandan-windows-source/server/platform-server.js']) {
  assert.ok(existsSync(join(root, path)), 'Active entry missing: ' + path)
}
const manifest = JSON.parse(readFileSync(join(serverRoot, 'package.json'), 'utf8'))
for (const key of ['dependencies', 'devDependencies', 'optionalDependencies']) {
  assert.equal(Object.keys(manifest[key] ?? {}).length, 0, 'Server must not regain unrelated packages in ' + key)
}
for (const key of ['dev', 'build', 'preview', 'electron', 'android']) {
  assert.equal(manifest.scripts[key], undefined, 'Legacy frontend script returned: ' + key)
}

// Production server imports are local/shared-core or Node built-ins. If a new
// external runtime is genuinely required, review this boundary with its owner.
function scripts (directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const path = join(directory, entry.name)
    return entry.isDirectory() ? scripts(path) : entry.name.endsWith('.js') ? [path] : []
  })
}
for (const file of scripts(join(serverRoot, 'server'))) {
  const source = readFileSync(file, 'utf8')
  const patterns = [
    /\b(?:import|export)\s+(?:[^'";]*?\sfrom\s*)?['"]([^'"]+)['"]/g,
    /\b(?:require|import)\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
  ]
  for (const pattern of patterns) for (const match of source.matchAll(pattern)) {
    const specifier = match[1]
    assert.ok(specifier.startsWith('.') || specifier.startsWith('node:'), 'Unexpected external server dependency: ' + specifier)
  }
}
console.log('Repository isolation passed: retired apps absent; server has no external runtime packages; current entries preserved.')
