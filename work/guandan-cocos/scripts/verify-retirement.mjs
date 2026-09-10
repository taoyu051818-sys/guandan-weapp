import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs'
import { dirname, resolve, relative, basename } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const read = file => readFileSync(resolve(root, file), 'utf8')
const json = file => JSON.parse(read(file))
const manifest = json('asset-library/retired-runtime-20260908/manifest.json')
const walk = dir => readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
  const file = resolve(dir, entry.name)
  return entry.isDirectory() ? walk(file) : [file]
})
const forbidden = [
  'LocalMatchController', 'LocalAITurnController', 'LocalMatchEventController', 'LocalTurnScheduler', 'SynchronousLocalAIEngine',
  'HttpShopGateway', 'DevelopmentShopGateway', '/api/v1/orders/redeem', 'renderFlow',
  'EffectLabPageDomain', 'EffectLabSceneHost', 'EffectLabPreviewRunner', 'DevelopmentEffectLab',
  '__guandanEffectLab', 'applyDevelopmentFixtureState', 'effect-lab',
  'FIXED_MATCH_FIXTURES', 'TABLE_LAYOUT_FIXTURES', '固定测试牌局：',
  'SettingsRulesPageDomain', 'CompetitionPageDomain', 'HttpMerchantGateway',
  'HttpSpectatorGateway', 'HttpTournamentGateway', 'DevelopmentTournamentGateway',
  'DevelopmentSpectatorGateway', 'DevelopmentMerchantGateway', 'SAMPLE_TOURNAMENTS',
  'SAMPLE_SPECTATOR_MATCHES', 'SAMPLE_MERCHANT_CONSOLE', '快速开始·人机测试',
  '/api/v1/merchants', '/api/v1/spectate',
]
const rejectMarkers = (text, context) => {
  for (const marker of forbidden) assert.ok(!text.includes(marker), `${context}: retired runtime marker ${marker}`)
}

for (const file of manifest.removedRuntimeSources) {
  assert.ok(!existsSync(resolve(root, file)), `retired source returned: ${file}`)
  assert.ok(!existsSync(resolve(root, `${file}.meta`)), `orphan retired metadata: ${file}.meta`)
}
const sources = walk(resolve(root, 'assets/scripts')).filter(file => file.endsWith('.ts'))
for (const file of sources) {
  const source = readFileSync(file, 'utf8')
  rejectMarkers(source, relative(root, file))
  assert.doesNotMatch(source, /(?:from\s*|import\s*\(|require\s*\()\s*['"][^'"]*(?:migration|asset-library|tests)\//, `package-only archive imported by ${file}`)
}
const catalog = json('third_party/licenses/gameabc2-audio/catalog.json')
const runtimeClips = catalog.assets.map(asset => asset.key).sort()
assert.deepEqual(runtimeClips, ['licensed/bomb', 'licensed/deal', 'licensed/defeat', 'licensed/single_5_female'])
for (const asset of manifest.retiredAudio) {
  assert.ok(!existsSync(resolve(root, asset.path)), `retired audio returned: ${asset.path}`)
  assert.ok(!existsSync(resolve(root, `${asset.path}.meta`)), `retired audio metadata returned: ${asset.path}`)
  const bytes = readFileSync(resolve(root, asset.archivePath))
  assert.equal(bytes.length, asset.bytes)
  assert.equal(createHash('sha256').update(bytes).digest('hex'), asset.sha256, `archive changed: ${asset.archivePath}`)
  assert.ok(catalog.archived.some(item => item.key === asset.key), `import catalog would restore ${asset.key}`)
}
assert.match(read('assets/scripts/scenes/FrontPageController.ts'), /showCompetition: \(\) => this\.tournamentPage\.open\(\)/)
assert.match(read('assets/scripts/scenes/front-pages/FriendRoomSettingsPolicy.ts'), /实时观战|延迟观战/)
assert.match(read('assets/scripts/services/platform/factory.ts'), /new HttpReplayGateway/)
assert.doesNotMatch(read('assets/scripts/scenes/FrontPageController.ts'), /EffectLab|effectLab/)
assert.doesNotMatch(read('tests/support/local-match/LocalMatchController.ts'), /public static fromEngineState/)
assert.doesNotMatch(read('assets/scripts/game/GameManager.ts'), /developmentFixtureActive|applyDevelopmentFixtureState/)
assert.doesNotMatch(read('assets/scripts/effects/EffectController.ts'), /public (previewAction|previewFlow|diagnostics|auditRuntimeAssets)\s*\(/)

for (const platform of ['wechat', 'web'].filter(platform => process.argv.includes(`--${platform}`))) {
  const build = resolve(root, platform === 'wechat' ? 'build/wechatgame' : 'build/web-desktop')
  const files = walk(build)
  for (const file of files.filter(file => /\.(js|json)$/.test(file))) rejectMarkers(readFileSync(file, 'utf8'), relative(build, file))
  const config = JSON.parse(readFileSync(resolve(build, platform === 'wechat' ? 'subpackages/game-assets/config.json' : 'assets/game-assets/config.json'), 'utf8'))
  const published = Object.values(config.paths ?? {}).map(entry => entry[0])
  for (const asset of manifest.retiredAudio) {
    assert.ok(!published.some(name => name === `audio/voices/${asset.key}` || name.startsWith(`audio/voices/${asset.key}/`)), `retired resource indexed: ${asset.key}`)
    assert.ok(!files.some(file => basename(file).startsWith(asset.uuid)), `retired native payload shipped: ${asset.key}`)
  }
  for (const key of ['niuma/pair_2', 'niuma/straight_flush', 'tts/steel_plate', ...runtimeClips]) {
    assert.ok(published.includes(`audio/voices/${key}`), `active audio missing: ${key}`)
  }
  if (platform === 'web') {
    console.log(`Web retirement verified: ${files.length} built files checked.`)
    continue
  }
  const subRoots = json('build/wechatgame/game.json').subpackages.map(p => resolve(build, p.root) + '/')
  const sum = list => list.reduce((total, file) => total + statSync(file).size, 0)
  const mainBytes = sum(files.filter(file => !subRoots.some(sub => file.startsWith(sub))))
  const subpackageBytes = sum(files) - mainBytes
  const before = json('docs/retirement-package-baseline-20260908.json')
  console.log(JSON.stringify({ mainBytes, subpackageBytes, totalBytes: mainBytes + subpackageBytes,
    savedBytesAgainstPreviousBuild: before.totalBytes - mainBytes - subpackageBytes,
    retiredAudioBytes: manifest.retiredAudio.reduce((sum, asset) => sum + asset.bytes, 0) }, null, 2))
}
console.log(`Retirement verified: ${manifest.removedRuntimeSources.length} removed runtime modules, ${manifest.retiredAudio.length} hash-verified archived clips; active replay/observer retained; laboratory excluded.`)
