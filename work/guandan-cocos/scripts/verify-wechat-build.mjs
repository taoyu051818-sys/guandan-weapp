import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'
import { extractRuntimeConfig, verifyWechatRuntimeConfig } from './runtime-client-config.mjs'

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const buildRoot = path.join(projectRoot, 'build/wechatgame')
const packageOnly = process.argv.includes('--package-only')
const gameJsonPath = path.join(buildRoot, 'game.json')
const settingsPath = path.join(buildRoot, 'src/settings.json')
const startupMetaPath = path.join(projectRoot, 'assets/startup/resource-loading-lingshui-v1.jpg.meta')
const mainPackageLimit = 4 * 1024 * 1024
const totalPackageLimit = 30 * 1024 * 1024
const forbiddenBundleMarkers = [
  '53e52062-b47e-43f8-b184-fb566cd720bd',
  '0cedd476-e4cd-4e92-a6d1-b85a9143167c',
  '0bdc3382-5148-4ac5-9e27-7cdbf08c1968',
  '1c24bc85-bf61-42fa-a125-c66267f3ee79',
  'pair_a_phrase',
  'licensed/straight_flush',
  'MerchantPageDomain',
]

const readJson = filePath => JSON.parse(fs.readFileSync(filePath, 'utf8'))
const toPosix = value => value.split(path.sep).join('/')

function walkFiles (root, shouldSkip = () => false) {
  const files = []
  const visit = current => {
    const relative = toPosix(path.relative(root, current))
    if (relative && shouldSkip(relative)) return
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const absolute = path.join(current, entry.name)
      const entryRelative = toPosix(path.relative(root, absolute))
      if (shouldSkip(entryRelative)) continue
      if (entry.isDirectory()) visit(absolute)
      else if (entry.isFile()) files.push(absolute)
    }
  }
  visit(root)
  return files
}

function totalBytes (files) {
  return files.reduce((sum, filePath) => sum + fs.statSync(filePath).size, 0)
}

function formatMiB (bytes) {
  return `${(bytes / 1024 / 1024).toFixed(2)} MiB`
}

assert.equal(fs.existsSync(gameJsonPath), true, 'missing build/wechatgame/game.json; build the WeChat target first')
assert.equal(fs.existsSync(settingsPath), true, 'missing build/wechatgame/src/settings.json')

const gameJson = readJson(gameJsonPath)
const projectConfig = readJson(path.join(buildRoot, 'project.config.json'))
const wechatProfile = readJson(path.join(projectRoot, 'profiles/v2/packages/wechatgame.json'))
const expectedAppId = wechatProfile.builder.options.wechatgame.appid
assert.match(expectedAppId, /^wx[0-9a-f]{16}$/, 'WeChat profile requires a real AppID')
assert.equal(projectConfig.appid, expectedAppId, 'built AppID differs from the configured WeChat account')
assert.equal(projectConfig.compileType, 'game', 'the Cocos client must use the WeChat game project type')
assert.equal(projectConfig.setting?.urlCheck, true, 'the published project must keep domain checks enabled')
const privateConfigPath = path.join(buildRoot, 'project.private.config.json')
if (fs.existsSync(privateConfigPath)) assert.notEqual(readJson(privateConfigPath).setting?.urlCheck, false, 'private project settings must not disable domain checks')
const settings = readJson(settingsPath)
assert.equal(settings.assets?.server, '', 'WeChat assets must remain local/subpackaged until a remote download domain is explicitly approved')
assert.deepEqual(settings.assets?.remoteBundles, [], 'unreviewed remote asset domains must not enter the WeChat package')
const startupMeta = readJson(startupMetaPath)
const subpackages = gameJson.subpackages ?? []
const gameAssetsPackage = subpackages.find(item => item.name === 'game-assets')

assert.ok(gameAssetsPackage, 'game.json must declare game-assets as a WeChat subpackage')
assert.equal(gameAssetsPackage.root, 'subpackages/game-assets/', 'game-assets must use the stable subpackage output path')
assert.deepEqual(settings.assets?.subpackages, ['game-assets'], 'Cocos runtime settings must register only game-assets as a subpackage')
assert.equal(settings.assets?.remoteBundles?.includes('game-assets'), false, 'game-assets is a WeChat subpackage, not a remote bundle')

const gameAssetsRoot = path.join(buildRoot, gameAssetsPackage.root)
assert.equal(fs.existsSync(gameAssetsRoot), true, 'the declared game-assets subpackage directory is missing')
assert.equal(fs.existsSync(path.join(buildRoot, 'assets/game-assets')), false, 'game-assets leaked back into the main package')

const firstScreen = fs.readFileSync(path.join(buildRoot, 'first-screen.js'), 'utf8')
const gameBootstrap = fs.readFileSync(path.join(buildRoot, 'game.js'), 'utf8')
verifyWechatRuntimeConfig(extractRuntimeConfig(gameBootstrap))
assert.match(gameBootstrap, /globalThis\.__GUANDAN_BUILD_TARGET__ = 'wechatgame'/, 'WeChat target marker must precede the engine adapter')
assert.ok(gameBootstrap.indexOf('guandan-runtime-config:start') < gameBootstrap.indexOf("require('./web-adapter')"), 'network config must be available before adapter initialization')
assert.match(firstScreen, /let useCustomBg = true;/, 'the native first screen must use the custom loading artwork')
assert.match(firstScreen, /let bgName = 'background\.jpg';/, 'the native first screen must load background.jpg')
assert.match(firstScreen, /let fitWidth = false;[\s\S]*let fitHeight = false;/, 'the native first screen must use cover sizing')
assert.match(gameBootstrap, /return firstScreen\.end\(\);[\s\S]*return startApplication\(application\);/, 'the first-screen renderer must release WebGL before Cocos starts')
assert.match(firstScreen, /Custom background failed to load; using a solid color[\s\S]*useCustomBg = false/, 'a broken loading picture must fall back without blocking startup')
assert.match(gameBootstrap, /Cocos engine failed to start[\s\S]*firstScreen\.showFailure/, 'engine startup failures must remain visible and retryable')

const nativeBackgroundPath = path.join(buildRoot, 'background.jpg')
assert.equal(fs.existsSync(nativeBackgroundPath), true, 'missing local native loading artwork')
assert.ok(fs.statSync(nativeBackgroundPath).size <= 400 * 1024, 'native loading artwork is too large for the main package')

const startupUuid = startupMeta.uuid
const mainAssetFiles = walkFiles(path.join(buildRoot, 'assets/main'))
const subpackageFiles = walkFiles(gameAssetsRoot)
const mainScript = fs.readFileSync(path.join(buildRoot, 'assets/main/index.js'), 'utf8')
assert.ok(mainScript.includes('NetworkEndpoint.ts'), 'stale build: missing mini-game endpoint compatibility parser')
assert.doesNotMatch(mainScript, /new\s+URL\s*\(/, 'business runtime must not depend on a browser-only URL constructor')
for (const code of ['GD-S01', 'GD-S02', 'GD-S03', 'GD-S04']) {
  assert.ok(mainScript.includes(code), `stale build: missing startup diagnostic ${code}`)
}
assert.ok(mainAssetFiles.some(filePath => path.basename(filePath).startsWith(startupUuid)), 'the in-game loading artwork must stay in the main bundle')
assert.equal(subpackageFiles.some(filePath => path.basename(filePath).startsWith(startupUuid)), false, 'the loading artwork cannot depend on the subpackage it is waiting for')

const gameAssetsConfig = readJson(path.join(gameAssetsRoot, 'config.json'))
const publishedAssetPaths = Object.values(gameAssetsConfig.paths ?? {}).map(entry => entry[0])
const classicTexturePaths = publishedAssetPaths.filter(assetPath => /^cards\/classic\/.+\/texture$/.test(assetPath))
assert.equal(classicTexturePaths.length, 37, 'the WeChat game-assets package must publish all 37 classic card textures')
assert.equal(classicTexturePaths.some(assetPath => assetPath.includes('/role_')), false, 'obsolete face-card portraits leaked into the WeChat package')
assert.equal(subpackageFiles.some(filePath => path.extname(filePath).toLowerCase() === '.webp'), false, 'WeChat Android must not depend on WebP card textures')

for (const filePath of walkFiles(buildRoot)) {
  const contents = fs.readFileSync(filePath)
  const marker = forbiddenBundleMarkers.find(candidate => contents.includes(Buffer.from(candidate)))
  assert.equal(marker, undefined, `archived or migration-only marker leaked into WeChat build: ${marker} (${filePath})`)
}

const subpackageRoots = subpackages.map(item => item.root.replace(/^\.\//, '').replace(/\/$/, ''))
const isSubpackagePath = relative => subpackageRoots.some(root => relative === root || relative.startsWith(`${root}/`))
const mainFiles = walkFiles(buildRoot, isSubpackagePath)
const mainBytes = totalBytes(mainFiles)
const subpackageBytes = totalBytes(subpackageFiles)
const totalBuildBytes = mainBytes + subpackages.reduce((sum, item) => {
  const packageRoot = path.join(buildRoot, item.root)
  return sum + totalBytes(walkFiles(packageRoot))
}, 0)

assert.ok(mainBytes <= mainPackageLimit, `WeChat main package is ${formatMiB(mainBytes)}, above the 4 MiB limit`)
assert.ok(totalBuildBytes <= totalPackageLimit, `WeChat total package is ${formatMiB(totalBuildBytes)}, above the 30 MiB limit`)

const oversizedEngineArtifacts = mainFiles.filter(filePath => /(?:bullet|spine|\.wasm$)/i.test(path.basename(filePath)))
assert.deepEqual(oversizedEngineArtifacts, [], 'unused Bullet, Spine, or WASM artifacts leaked into the main package')
assert.equal(settings.physics?.physicsEngine, '', '3D physics must remain cropped from this 2D client')

execFileSync(process.execPath, [path.join(projectRoot, 'tests/support/wechat-built-startup.cjs')], { cwd: projectRoot, stdio: 'inherit' })
execFileSync(process.execPath, [path.join(projectRoot, 'scripts/verify-retirement.mjs'), '--wechat'], { cwd: projectRoot, stdio: 'inherit' })

console.log(`WeChat ${packageOnly ? 'package only' : 'release build'} verified: AppID ${expectedAppId}, main ${formatMiB(mainBytes)}, game-assets ${formatMiB(subpackageBytes)}, total ${formatMiB(totalBuildBytes)}`)
if (packageOnly) console.log('Package inspection includes strict endpoint configuration, but not live WeChat login, backend health or release authorization.')
