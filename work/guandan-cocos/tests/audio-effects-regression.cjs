const assert = require('node:assert/strict')
const crypto = require('node:crypto')
const fs = require('node:fs')
const path = require('node:path')

const projectRoot = path.resolve(__dirname, '..')
const requireBuild = process.argv.includes('--require-build')
const { compilerPath, loadTypeScript } = require('./support/typescript.cjs')
const audioProfilesPath = path.join(projectRoot, 'assets/scripts/audio/AudioProfiles.ts')
const playVoiceProfilesPath = path.join(projectRoot, 'assets/scripts/audio/PlayVoiceProfiles.ts')
const audioControllerPath = path.join(projectRoot, 'assets/scripts/audio/CocosAudioController.ts')
const effectPolicyPath = path.join(projectRoot, 'assets/scripts/effects/EffectPolicy.ts')
const effectResolverPath = path.join(projectRoot, 'assets/scripts/effects/EffectProfileResolver.ts')
const effectControllerPath = path.join(projectRoot, 'assets/scripts/effects/EffectController.ts')
const effectPlaybackPath = path.join(projectRoot, 'assets/scripts/effects/EffectPlaybackCoordinator.ts')
const gameManagerPath = path.join(projectRoot, 'assets/scripts/game/GameManager.ts')
const gameScenePath = path.join(projectRoot, 'assets/scripts/scenes/GameScene.ts')
const tableMatchCoordinatorPath = path.join(projectRoot, 'assets/scripts/scenes/TableMatchCoordinator.ts')
const tableTurnClockPath = path.join(projectRoot, 'assets/scripts/scenes/TableTurnClockController.ts')
const settingsRulesPagePath = path.join(projectRoot, 'assets/scripts/scenes/front-pages/SettingsRulesPageDomain.ts')
const gameSessionPath = path.join(projectRoot, 'assets/scripts/session/GameSession.ts')
const gameSessionModelPath = path.join(projectRoot, 'assets/scripts/session/GameSessionModel.ts')
const licensedCatalogPath = path.join(projectRoot, 'third_party/licenses/gameabc2-audio/catalog.json')
const licensedManifestPath = path.join(projectRoot, 'third_party/licenses/gameabc2-audio/manifest.json')
const niumaAudioManifestPath = path.join(projectRoot, 'third_party/licenses/niuma-client-cocos-audio.json')
const niumaMaleAudioManifestPath = path.join(projectRoot, 'third_party/licenses/niuma-client-cocos-male-audio.json')
const niumaBgmManifestPath = path.join(projectRoot, 'third_party/licenses/niuma-client-cocos-bgm.json')
const niumaLicensePath = path.join(projectRoot, 'third_party/licenses/NiuMa-client-cocos-MIT.txt')
const battleBgmPath = path.join(projectRoot, 'assets/game-assets/audio/music/duizhan.mp3')

assert.equal(fs.existsSync(compilerPath), true, 'Cocos Creator TypeScript compiler is required')
const ts = loadTypeScript()

const read = filePath => fs.readFileSync(filePath, 'utf8')
const loadPureTs = (filePath, dependencies = {}) => {
  const result = ts.transpileModule(read(filePath), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2019 },
    fileName: filePath,
    reportDiagnostics: true,
  })
  const errors = (result.diagnostics ?? []).filter(diagnostic => diagnostic.category === ts.DiagnosticCategory.Error)
  assert.deepEqual(errors, [], `failed to transpile ${filePath}`)
  const module = { exports: {} }
  const localRequire = request => {
    if (Object.prototype.hasOwnProperty.call(dependencies, request)) return dependencies[request]
    throw new Error(`unexpected runtime dependency ${request} in ${filePath}`)
  }
  new Function('exports', 'module', 'require', '__filename', '__dirname', result.outputText)(module.exports, module, localRequire, filePath, path.dirname(filePath))
  return module.exports
}

for (const sourcePath of [audioProfilesPath, playVoiceProfilesPath, effectPolicyPath]) {
  assert.equal(fs.existsSync(sourcePath), true, `missing source: ${sourcePath}`)
  assert.equal(fs.existsSync(`${sourcePath}.meta`), true, `missing Cocos metadata: ${sourcePath}.meta`)
}

const audio = loadPureTs(audioProfilesPath)
const expectedEvents = ['game-start', 'deal', 'play', 'pass', 'countdown', 'bomb', 'king-bomb', 'wildcard', 'victory', 'defeat']
assert.deepEqual(audio.AUDIO_EVENTS, expectedEvents, 'the complete semantic audio surface must remain explicit')

const expectedPrimaryAssets = {
  'game-start': 'niuma/game_start',
  deal: 'licensed/deal',
  play: 'card',
  pass: 'niuma/pass_1',
  countdown: 'niuma/countdown_5',
  bomb: 'licensed/bomb',
  'king-bomb': 'king_bomb',
  wildcard: 'wildcard',
  victory: 'niuma/victory',
  defeat: 'licensed/defeat',
}

const supportedRuntimeAudioExtensions = ['.mp3', '.wav', '.m4a', '.ogg']
const resolveRuntimeAudio = assetKey => supportedRuntimeAudioExtensions
  .map(extension => path.join(projectRoot, `assets/game-assets/audio/voices/${assetKey}${extension}`))
  .filter(filePath => fs.existsSync(filePath))

for (const event of expectedEvents) {
  const profile = audio.resolveAudioProfile(event)
  assert.ok(profile, `missing audio profile for ${event}`)
  assert.equal(profile.event, event)
  assert.equal(profile.assetKeys[0], expectedPrimaryAssets[event])
  assert.equal(profile.volumeScale > 0 && profile.volumeScale <= 1, true, `${event} volume scale must be safe`)
  assert.equal(profile.cooldownMs >= 0, true, `${event} cooldown must not be negative`)
  assert.equal(Object.isFrozen(profile), true, `${event} profile must be immutable`)
  const configuredKeys = [profile.assetKeys, ...(profile.assetVariants ?? [])].flat()
  for (const assetKey of configuredKeys) {
    const matches = resolveRuntimeAudio(assetKey)
    assert.equal(matches.length, 1, `${assetKey} must resolve to exactly one supported runtime audio format`)
  }
}
for (let remaining = 0; remaining <= 5; remaining++) {
  const profile = audio.resolveCountdownProfile(remaining)
  assert.equal(profile.event, 'countdown')
  assert.equal(profile.assetKeys[0], `niuma/countdown_${remaining}`)
  assert.equal(Object.isFrozen(profile), true)
}
assert.equal(audio.resolveCountdownProfile(-1), null)
assert.equal(audio.resolveCountdownProfile(6), null)
assert.equal(audio.resolveCountdownProfile(4.5), null)
assert.equal(audio.AUDIO_EVENT_PROFILES.pass.assetVariants.length, 3, 'all three pass announcements must remain selectable')
assert.equal(audio.resolveAudioEvent('king_bomb'), 'king-bomb', 'legacy asset names must resolve to semantics')
assert.equal(audio.resolveAudioEvent('game_start'), 'game-start', 'legacy start keys must resolve to semantics')
assert.equal(audio.resolveAudioEvent('straight-flush'), null, 'the duplicate straight-flush semantic event must stay retired')
assert.equal(audio.resolveAudioEvent('straight_flush'), null, 'the legacy straight-flush filename must not bypass the retired semantic route')
assert.equal(audio.resolveAudioProfile('straight-flush'), null, 'straight-flush must not regain a second audio profile beside its play voice')
assert.equal(audio.resolveAudioProfile('straight_flush'), null, 'legacy straight-flush lookups must also remain silent')
assert.equal(audio.RETIRED_AUDIO_ROUTES['straight-flush'].runtimeAllowed, false)
assert.equal(audio.RETIRED_AUDIO_ROUTES.straight_flush.runtimeAllowed, false)
assert.equal(audio.resolveAudioEvent('unregistered-clip'), null, 'unknown asset names must stay optional')

const catalog = JSON.parse(read(licensedCatalogPath))
const manifest = JSON.parse(read(licensedManifestPath))
assert.equal(catalog.assets.length, 25, 'only the 25 reachable authorized clips may enter the runtime bundle')
assert.equal(catalog.archived.length, 2, 'two authorized but unreachable clips must remain outside assets')
assert.equal(catalog.excluded.length, 1, 'the rejected visual must remain explicitly excluded')
assert.match(catalog.excluded[0].url, /\.png$/)
assert.equal(manifest.assets.length, catalog.assets.length)
assert.equal(manifest.archived.length, catalog.archived.length)
assert.deepEqual(manifest.excluded, catalog.excluded)
assert.equal(new Set(manifest.assets.map(asset => asset.sha256)).size, manifest.assets.length, 'each imported clip must have a recorded content hash')
for (const asset of manifest.assets) {
  assert.match(asset.key, /^licensed\//, 'authorized clips must stay in their collision-free namespace')
  const runtimePath = path.join(projectRoot, 'assets/game-assets/audio/voices/licensed', asset.file)
  const buffer = fs.readFileSync(runtimePath)
  assert.equal(buffer.length, asset.bytes, `${asset.file} byte count must match the manifest`)
  assert.equal(crypto.createHash('sha256').update(buffer).digest('hex'), asset.sha256, `${asset.file} hash must match the manifest`)
  assert.equal(buffer.subarray(0, 3).toString('ascii'), 'ID3', `${asset.file} must have an MP3 ID3 header`)
  assert.equal(fs.existsSync(`${runtimePath}.meta`), true, `${asset.file} must be imported by Cocos Creator`)
}
for (const asset of manifest.archived) {
  const archivePath = path.join(projectRoot, manifest.archiveDirectory, asset.file)
  const buffer = fs.readFileSync(archivePath)
  assert.equal(buffer.length, asset.bytes, `${asset.file} archived byte count must match the manifest`)
  assert.equal(crypto.createHash('sha256').update(buffer).digest('hex'), asset.sha256, `${asset.file} archived hash must match the manifest`)
  assert.equal(archivePath.includes(`${path.sep}assets${path.sep}`), false, `${asset.file} must stay outside the Cocos asset graph`)
  assert.equal(fs.existsSync(`${archivePath}.meta`), false, `${asset.file} must not receive Cocos metadata`)
}
assert.deepEqual(
  fs.readdirSync(path.join(projectRoot, manifest.archiveDirectory)).filter(file => file.endsWith('.mp3')).sort(),
  manifest.archived.map(asset => asset.file).sort(),
  'licensed source archive must exactly match the non-runtime manifest',
)
assert.deepEqual(
  fs.readdirSync(path.join(projectRoot, manifest.runtimeDirectory)).filter(file => file.endsWith('.mp3')).sort(),
  manifest.assets.map(asset => asset.file).sort(),
  'licensed runtime audio must exactly match the reachable manifest',
)
assert.equal(fs.readdirSync(path.join(projectRoot, 'assets/game-assets/audio/voices/licensed')).some(file => /\.(png|jpe?g|webp)$/i.test(file)), false, 'rejected images must never enter the licensed audio runtime directory')

const policy = loadPureTs(effectPolicyPath)
assert.deepEqual(policy.DEFAULT_EFFECT_POLICY, {
  maxMajorEffectCount: 1,
  allowInputDuringEffect: true,
  replaceLowerLevelEffect: true,
})
assert.equal(policy.resolveEffectPolicy({ maxMajorEffectCount: 0 }).maxMajorEffectCount, 0)
assert.equal(policy.resolveEffectPolicy({ maxMajorEffectCount: 1 }).maxMajorEffectCount, 1)
assert.equal(policy.resolveEffectPolicy({ replaceLowerLevelEffect: false }).replaceLowerLevelEffect, false)
assert.equal(policy.resolveEffectPolicy().allowInputDuringEffect, true, 'effects must never own gameplay input')

const PlayType = {
  Single: 'Single', Pair: 'Pair', Triple: 'Triple', Straight: 'Straight', TripleWithPair: 'TripleWithPair',
  Tube: 'Tube', Plate: 'Plate', StraightFlush: 'StraightFlush', Bomb: 'Bomb', Rocket: 'Rocket', Pass: 'Pass',
}
const voices = loadPureTs(playVoiceProfilesPath, { '../core/generated': { PlayType } })
const voiceAction = (type, rank, wildcardUsages = []) => ({
  playerId: 'p1',
  type,
  cards: [{ id: `c-${rank}-1`, rank }, ...(type === PlayType.Pair ? [{ id: `c-${rank}-2`, rank }] : [])],
  resolution: { type, maxValue: 10, wildcardUsages },
})
const singleRankAssets = { 2: '2', 3: '3', 4: '4', 5: '5', 6: '6', 7: '7', 8: '8', 9: '9', 10: '10', J: 'j', Q: 'q', K: 'k', A: 'a', Small: 'small_joker', Big: 'big_joker' }
for (const [rank, key] of Object.entries(singleRankAssets)) {
  assert.equal(voices.resolvePlayVoiceProfile(voiceAction(PlayType.Single, rank)).assetKeys[0], `niuma/single_${key}`, `single ${rank} must use the complete Female matrix`)
}
const pairRankAssets = { 2: '2', 3: '3', 4: '4', 5: '5', 6: '6', 7: '7', 8: '8', 9: '9', 10: '10', J: 'j', Q: 'q', K: 'k', A: 'a' }
for (const [rank, key] of Object.entries(pairRankAssets)) {
  assert.equal(voices.resolvePlayVoiceProfile(voiceAction(PlayType.Pair, rank)).assetKeys[0], `niuma/pair_${key}`, `pair ${rank} must use the complete Female matrix`)
}
assert.deepEqual(voices.resolvePlayVoiceProfile(voiceAction(PlayType.Pair, 'Small')).assetKeys, ['licensed/pair_small_joker', 'niuma/pair_joker_generic'])
assert.deepEqual(voices.resolvePlayVoiceProfile(voiceAction(PlayType.Pair, 'Big')).assetKeys, ['niuma/pair_joker_generic'])
assert.deepEqual(voices.resolvePlayVoiceProfile(voiceAction(PlayType.Straight, 3)).assetKeys, ['niuma/straight', 'licensed/straight'])
assert.deepEqual(voices.resolvePlayVoiceProfile(voiceAction(PlayType.Triple, 3)).assetKeys, ['niuma/triple'])
assert.deepEqual(voices.resolvePlayVoiceProfile(voiceAction(PlayType.TripleWithPair, 3)).assetKeys, ['niuma/triple_with_pair'])
assert.deepEqual(voices.resolvePlayVoiceProfile(voiceAction(PlayType.Tube, 3)).assetKeys, ['niuma/tube'])
assert.deepEqual(voices.resolvePlayVoiceProfile(voiceAction(PlayType.StraightFlush, 3)).assetKeys, ['niuma/straight_flush'], 'straight-flush must have exactly one human announcement asset')
assert.equal((read(playVoiceProfilesPath).match(/PlayType\.StraightFlush/g) || []).length, 1, 'PlayVoiceProfiles must retain one straight-flush dispatch site')
assert.deepEqual(voices.resolvePlayVoiceProfile(voiceAction(PlayType.Bomb, 3)).assetKeys, ['niuma/bomb'])
assert.deepEqual(voices.resolvePlayVoiceProfile(voiceAction(PlayType.Rocket, 3)).assetKeys, ['niuma/king_bomb'])
assert.equal(voices.resolvePlayVoiceProfile(voiceAction(PlayType.Plate, 3)), null, 'the mismatched “飞机” source must not announce a steel plate')
assert.equal(voices.resolvePlayVoiceProfile(voiceAction(PlayType.Single, 'A', [{ cardId: 'c-A-1', representedValue: 12 }])), null, 'wildcard-resolved singles must not announce the physical rank')

const niumaAudioManifest = JSON.parse(read(niumaAudioManifestPath))
assert.equal(niumaAudioManifest.schemaVersion, 3)
assert.equal(niumaAudioManifest.license, 'MIT')
assert.equal(niumaAudioManifest.licenseFile, 'third_party/licenses/NiuMa-client-cocos-MIT.txt')
assert.match(read(niumaLicensePath), /^MIT License[\s\S]*Copyright \(c\) 2025 NiuMa[\s\S]*Permission is hereby granted/)
assert.equal(niumaAudioManifest.sourceRevision, 'f9d037feaef5a80867fd97c8dd39b9a7486fbeca')
assert.equal(niumaAudioManifest.assets.length, 49, 'the curated Female, round-flow and single exact-copy quick-chat clip must enter runtime')
assert.equal(niumaAudioManifest.excluded.length, 11)
assert.equal(niumaAudioManifest.excluded.some(asset => /feiji\.mp3$/.test(asset.sourcePath)), true, '飞机 must stay excluded from steel plate')
assert.equal(niumaAudioManifest.excluded.some(asset => /yapai\.mp3$/.test(asset.sourcePath)), true, 'random 压牌 must stay excluded without a rule event')
assert.equal(niumaAudioManifest.excluded.some(asset => /dealcard\.ogg$/.test(asset.sourcePath)), true, 'the redundant unverified OGG deal loop must stay excluded')
assert.deepEqual(niumaAudioManifest.mappingEvidence, {
  phraseTextArrays: [
    'assets/Scripts/Game/GuanDan/GuanDanPlayer.ts',
    'assets/Scripts/Game/GuanDan/SeatPanel.ts',
  ],
  phraseAudioRouter: 'assets/Scripts/Game/GuanDan/AudioControl.ts',
  rule: 'The old client displays zero-based phrase array index N and AudioControl.playPhrase routes it to one-based Phrase/Female/phraseNN.',
})
const importedQuickChats = niumaAudioManifest.assets.filter(asset => asset.runtimePhraseId)
assert.deepEqual(importedQuickChats.map(asset => ({
  sourcePhraseIndex: asset.sourcePhraseIndex,
  sourceText: asset.sourceText,
  runtimePhraseId: asset.runtimePhraseId,
  runtimeText: asset.runtimeText,
  key: asset.key,
})), [
  { sourcePhraseIndex: 2, sourceText: '你的牌打得太好啦', runtimePhraseId: 'nice-play', runtimeText: '你的牌打得太好啦', key: 'niuma/chat_nice_play' },
], 'quick-chat audio must require an exact verified old-client copy rather than file-number or approximate-semantic guesses')
assert.deepEqual(
  niumaAudioManifest.excluded.filter(asset => /Phrase\/Female\/phrase\d+\.ogg$/.test(asset.sourcePath)).map(asset => asset.sourcePhraseIndex),
  [1, 3, 4, 5, 6, 7, 8, 9],
  'unsafe or semantically incompatible Female quick-chat clips must remain explicitly excluded',
)
assert.equal(new Set(niumaAudioManifest.assets.map(asset => asset.sha256)).size, niumaAudioManifest.assets.length, 'NiuMa assets must each have a recorded content hash')
for (const asset of niumaAudioManifest.assets) {
  assert.match(asset.key, /^niuma\//, 'NiuMa audio must remain in its own runtime namespace')
  const runtimePath = path.join(projectRoot, niumaAudioManifest.runtimeDirectory, asset.file)
  const buffer = fs.readFileSync(runtimePath)
  assert.equal(buffer.length, asset.bytes, `${asset.file} byte count must match the NiuMa manifest`)
  assert.equal(crypto.createHash('sha256').update(buffer).digest('hex'), asset.sha256, `${asset.file} hash must match the NiuMa manifest`)
  assert.equal(fs.existsSync(`${runtimePath}.meta`), true, `${asset.file} must be imported by Cocos Creator`)
  if (requireBuild) {
    const meta = JSON.parse(read(`${runtimePath}.meta`))
    const builtPath = path.join(projectRoot, 'build/web-desktop/assets/game-assets/native', meta.uuid.slice(0, 2), `${meta.uuid}${path.extname(asset.file)}`)
    const builtBuffer = fs.readFileSync(builtPath)
    assert.equal(crypto.createHash('sha256').update(builtBuffer).digest('hex'), asset.sha256, `${asset.file} must reach the Web build unchanged`)
  }
}
const niumaRuntimeFiles = fs.readdirSync(path.join(projectRoot, niumaAudioManifest.runtimeDirectory)).filter(file => /\.(mp3|ogg)$/.test(file)).sort()
assert.deepEqual(niumaRuntimeFiles, niumaAudioManifest.assets.map(asset => asset.file).sort(), 'runtime NiuMa audio files must exactly match the curated manifest')

const niumaMaleManifest = JSON.parse(read(niumaMaleAudioManifestPath))
assert.equal(niumaMaleManifest.schemaVersion, 1)
assert.equal(niumaMaleManifest.sourceRevision, niumaAudioManifest.sourceRevision)
assert.equal(niumaMaleManifest.assets.length, 40, 'the optional Male pack must contain 39 play/pass clips and one exact-copy quick-chat clip')
assert.equal(niumaMaleManifest.excluded.length, 10)
assert.equal(niumaMaleManifest.excluded.some(asset => /Male\/feiji\.mp3$/.test(asset.sourcePath)), true)
assert.equal(niumaMaleManifest.excluded.some(asset => /Male\/yapai\.mp3$/.test(asset.sourcePath)), true)
assert.deepEqual(niumaMaleManifest.assets.filter(asset => asset.runtimePhraseId).map(asset => ({
  sourcePhraseIndex: asset.sourcePhraseIndex,
  sourceText: asset.sourceText,
  runtimeText: asset.runtimeText,
  key: asset.key,
})), [{ sourcePhraseIndex: 2, sourceText: '你的牌打得太好啦', runtimeText: '你的牌打得太好啦', key: 'niuma-male/chat_nice_play' }])
assert.equal(new Set(niumaMaleManifest.assets.map(asset => asset.sha256)).size, niumaMaleManifest.assets.length)
for (const asset of niumaMaleManifest.assets) {
  assert.match(asset.key, /^niuma-male\//)
  const runtimePath = path.join(projectRoot, niumaMaleManifest.runtimeDirectory, asset.file)
  const buffer = fs.readFileSync(runtimePath)
  assert.equal(buffer.length, asset.bytes)
  assert.equal(crypto.createHash('sha256').update(buffer).digest('hex'), asset.sha256)
  assert.equal(fs.existsSync(`${runtimePath}.meta`), true)
  if (requireBuild) {
    const meta = JSON.parse(read(`${runtimePath}.meta`))
    const builtPath = path.join(projectRoot, 'build/web-desktop/assets/game-assets/native', meta.uuid.slice(0, 2), `${meta.uuid}${path.extname(asset.file)}`)
    assert.equal(crypto.createHash('sha256').update(fs.readFileSync(builtPath)).digest('hex'), asset.sha256)
  }
}
assert.deepEqual(
  fs.readdirSync(path.join(projectRoot, niumaMaleManifest.runtimeDirectory)).filter(file => /\.(mp3|ogg)$/.test(file)).sort(),
  niumaMaleManifest.assets.map(asset => asset.file).sort(),
)

const niumaBgmManifest = JSON.parse(read(niumaBgmManifestPath))
assert.equal(niumaBgmManifest.schemaVersion, 1)
assert.equal(niumaBgmManifest.license, 'MIT')
assert.equal(niumaBgmManifest.sourceRevision, niumaAudioManifest.sourceRevision)
assert.equal(niumaBgmManifest.asset.key, 'music/niuma/table_theme')
assert.equal(niumaBgmManifest.asset.sourcePath, 'assets/GuanDan/Audio/bg.mp3')
assert.equal(niumaBgmManifest.asset.format.durationSeconds > 30, true)
const bgmRuntimePath = path.join(projectRoot, niumaBgmManifest.runtimeDirectory, niumaBgmManifest.asset.file)
const bgmBuffer = fs.readFileSync(bgmRuntimePath)
assert.equal(bgmBuffer.length, niumaBgmManifest.asset.bytes)
assert.equal(crypto.createHash('sha256').update(bgmBuffer).digest('hex'), niumaBgmManifest.asset.sha256)
assert.equal(fs.existsSync(`${bgmRuntimePath}.meta`), true, 'the selected BGM must have Cocos metadata')
if (requireBuild) {
  const bgmMeta = JSON.parse(read(`${bgmRuntimePath}.meta`))
  const builtBgmPath = path.join(projectRoot, 'build/web-desktop/assets/game-assets/native', bgmMeta.uuid.slice(0, 2), `${bgmMeta.uuid}.mp3`)
  assert.equal(crypto.createHash('sha256').update(fs.readFileSync(builtBgmPath)).digest('hex'), niumaBgmManifest.asset.sha256, 'the selected BGM must reach the Web build unchanged')
}

const battleBgmBuffer = fs.readFileSync(battleBgmPath)
assert.equal(battleBgmBuffer.length, 1566240, 'the supplied battle track must remain byte-identical')
assert.equal(crypto.createHash('sha256').update(battleBgmBuffer).digest('hex'), '11958667ef7fcbb0c6ab10e18c04c459b996e4e86c651a8695f6c20613b5db3c')
assert.equal(fs.existsSync(`${battleBgmPath}.meta`), true, 'the supplied battle BGM must have Cocos metadata')
if (requireBuild) {
  const battleBgmMeta = JSON.parse(read(`${battleBgmPath}.meta`))
  const builtBattleBgmPath = path.join(projectRoot, 'build/web-desktop/assets/game-assets/native', battleBgmMeta.uuid.slice(0, 2), `${battleBgmMeta.uuid}.mp3`)
  assert.equal(crypto.createHash('sha256').update(fs.readFileSync(builtBattleBgmPath)).digest('hex'), '11958667ef7fcbb0c6ab10e18c04c459b996e4e86c651a8695f6c20613b5db3c')
}

const effects = loadPureTs(effectResolverPath, { '../core/generated': { PlayType } })
const resolver = new effects.EffectProfileResolver()
const action = (type, count = 1) => ({
  playerId: 'p1', type, cards: Array.from({ length: count }, (_, index) => ({ id: `c${index}` })), resolution: { type, maxValue: 10, length: count },
})
assert.equal(resolver.resolve(action(PlayType.Pass, 0), 'full').sound, 'pass', 'Pass keeps its independent baseline semantic audio')
for (const type of Object.values(PlayType).filter(type => type !== PlayType.Pass && type !== PlayType.Bomb)) {
  const resolved = resolver.resolve(action(type, type === PlayType.Rocket ? 4 : type === PlayType.StraightFlush ? 5 : 1), 'full')
  assert.equal(resolved.key, 'play-normal', `${type} must not restore a rejected post-flight effect profile`)
  assert.equal(resolved.sound, null, `${type} must rely on its single play-voice route instead of a second effect sound`)
}
const sixBomb = resolver.resolve(action(PlayType.Bomb, 6), 'full')
assert.equal(sixBomb.sound, 'bomb')
assert.equal(sixBomb.key, 'six-bomb', 'exactly six cards must select the dedicated live renderer')
assert.equal(resolver.resolve(action(PlayType.Bomb, 7), 'full').key, 'bomb-medium', 'seven cards must not reuse the six-card presentation')

const reducedBomb = resolver.resolve(action(PlayType.Bomb, 8), 'reduced')
assert.equal(reducedBomb.level <= 1, true, 'reduced mode must remove table-covering effects')
assert.equal(reducedBomb.shake, 'none')
assert.equal(reducedBomb.dimTable, false)
const audioOnlyBomb = resolver.resolve(action(PlayType.Bomb, 8), 'off')
assert.equal(audioOnlyBomb.level, 0)
assert.equal(audioOnlyBomb.durationMs, 0)
assert.equal(audioOnlyBomb.flightMs, 0)
assert.equal(audioOnlyBomb.sound, 'bomb', 'visual-off mode must not silently override sound settings')

const audioController = read(audioControllerPath)
const effectController = read(effectControllerPath)
const effectPlayback = read(effectPlaybackPath)
const gameManager = read(gameManagerPath)
const gameScene = read(gameScenePath)
const tableMatchCoordinator = read(tableMatchCoordinatorPath)
const tableTurnClock = read(tableTurnClockPath)
const settingsRulesPage = read(settingsRulesPagePath)
const gameSession = read(gameSessionPath)
const gameSessionModel = read(gameSessionModelPath)
assert.match(audioController, /if \(!clip\) return this\.playFirstAvailable\(assetKeys, volumeScale, index \+ 1, epoch\)/, 'a missing clip must try the next configured candidate')
assert.match(audioController, /this\.unavailableAssets\.add\(assetKey\)/, 'failed resources must be cached instead of loaded forever')
assert.match(audioController, /if \(settings && !settings\.soundEnabled\) return/, 'the independent sound switch must be authoritative')
assert.match(audioController, /if \(!this\.isPlaybackCurrent\(epoch\)\) return/, 'a late async load must re-check playback state before sounding')
assert.match(audioController, /settings\?\.volume \?\? 0\.5\) \* volumeScale/, 'loaded clips must use the current volume rather than the request-time volume')
assert.match(audioController, /now - this\.lastQuickVoiceAt < 650/, 'quick-chat bursts must be throttled below the minigame one-shot limit')
assert.match(audioController, /now - \(this\.lastPlayedAssets\.get\(assetKey\).*< 60/, 'same-asset bursts must be deduplicated')
assert.match(audioController, /profile\.assetVariants\?\.length/, 'semantic profiles must select pass variants without exposing file names to the scene')
assert.match(audioController, /resolveCountdownProfile\(remaining\)/, 'countdown seconds must resolve through semantic profiles')
assert.match(audioController, /this\.playEvent\('game-start'\)/, 'round start must remain a semantic event')
assert.match(audioController, /lobby: 'audio\/music\/niuma\/table_theme'/, 'the existing audited track must remain the lobby BGM')
assert.match(audioController, /battle: 'audio\/music\/duizhan'/, 'the supplied track must be reserved for battle')
assert.match(audioController, /public setBgmMode \(mode: BgmMode\): void/, 'the scene boundary must explicitly select lobby or battle music')
assert.match(audioController, /BGM_ASSETS\[this\.bgmMode\] === assetPath/, 'late async BGM loads must not replace a newer mode')
assert.match(audioController, /new Node\('BackgroundMusic'\)/, 'BGM must use an isolated source instead of interrupting one-shot effects')
assert.match(audioController, /source\.loop = true/, 'the selected background track must loop')
assert.match(audioController, /if \(!settings\.bgmEnabled\)[\s\S]*source\.stop\(\)/, 'the independent music switch must stop BGM')
assert.match(audioController, /if \(!source\.playing\) source\.play\(\)/, 'enabling music must start an already loaded track')
assert.doesNotMatch(audioController, /soundEnabled[\s\S]{0,80}bgmSource\.stop/, 'the sound-effect switch must not silently control the independent music channel')
assert.match(audioController, /settings\.voicePack !== 'male'/, 'the selected voice pack must drive human announcements')
assert.match(audioController, /replace\(\/\^niuma\\\/\/, 'niuma-male\/'\)/, 'Male selection must stay in its isolated runtime namespace')
assert.match(audioController, /!key\.startsWith\('licensed\/'\)/, 'Male selection must not fall through into another recorded human voice')
assert.match(gameSessionModel, /voicePack: 'female'/, 'Female must remain the backward-compatible default pack')
assert.match(gameSessionModel, /voicePack: oneOf\(settings\.voicePack, \['female', 'male'\], base\.settings\.voicePack\)/, 'restored voice-pack values must be normalized by the session schema owner')
assert.match(settingsRulesPage, /切换报牌声线/, 'settings must expose the optional Male/Female voice pack')
assert.doesNotMatch(`${effectController}\n${effectPlayback}`, /enqueueSemanticAudio/, 'pass audio must not restore the retired side queue')
const playMethodSource = effectPlayback.slice(effectPlayback.indexOf('  public play (event: PlayEffectEvent'), effectPlayback.indexOf('  public renderPreparedContext'))
const playStartIndex = playMethodSource.indexOf('const start = async (): Promise<void> =>')
const qualityOffMatch = /if \(effectQuality === 'off'\)/.exec(playMethodSource)
assert.equal(playStartIndex >= 0, true, 'every live action must expose one queued play start')
assert.equal(Boolean(qualityOffMatch && qualityOffMatch.index > playStartIndex), true, 'visual-off actions, including Pass, must still wait for the shared visible lane')
assert.match(playMethodSource, /const handle = new EffectHandle[\s\S]*const start = async \(\): Promise<void> =>[\s\S]*if \(event\.action\.type === PlayType\.Pass\) \{[\s\S]*beginPresentation\(\)[\s\S]*this\.dependencies\.playSound\('pass'\)[\s\S]*handle\.complete\(\)[\s\S]*this\.startQueue = this\.startQueue\.then\(start, start\)/, 'Pass must use the outer play handle and sound only after its ticketed presentation begins in lane order')
assert.match(effectPlayback, /this\.dependencies\.playActionVoice\(event\.action\)/, 'incremental live actions must dispatch card announcements')
assert.match(playMethodSource, /const start = async \(\): Promise<void> =>[\s\S]*if \(effectQuality === 'off'\) \{[\s\S]*beginPresentation\(\)[\s\S]*if \(profile\.sound\) this\.dependencies\.playSound\(profile\.sound\)[\s\S]*handle\.complete\(\)[\s\S]*return[\s\S]*const cardFramesReady = await[\s\S]*flightHandle = flight\.play\(/, 'visual-off mode must keep semantic audio and complete its queued outer handle before any prepare or flight work')
assert.match(playMethodSource, /const renderImpact = \(\): void => \{[\s\S]*?this\.dependencies\.withQuality\(effectQuality, \(\) => \{[\s\S]*?if \(!rendererOwnsBombFlight\) this\.dependencies\.vibrate\(profile\.haptic\)[\s\S]*?impactHandle = this\.dependencies\.renderPlayImpact\(profile, playEvent, wildcardUsed\)/, 'enabled visuals must trigger haptics from the arrival-synchronised impact callback')
assert.match(effectController, /this\.policy\.maxMajorEffectCount === 0/, 'the major-effect budget must be enforced')
assert.match(effectController, /profile\.level > this\.majorLevel && !this\.policy\.replaceLowerLevelEffect/, 'major-effect replacement policy must be enforced')
assert.match(effectController, /private renderFlow \([\s\S]*if \(kind === 'victory'\) this\.soundPlayer\?\.\('victory'\)[\s\S]*else if \(kind === 'defeat'\) this\.soundPlayer\?\.\('defeat'\)[\s\S]*return EffectHandle\.completed\('unavailable'\)/, 'EffectController must dispatch settlement audio directly after the retired flow renderer is removed')
assert.match(effectController, /this\.renderFlow\(won \? 'victory' : 'defeat'/, 'settlement must use the shared direct dispatch path in both full and reduced modes')
assert.doesNotMatch(effectController, /showTag\(profile\.label/, 'reduced settlement must not fall back to a system-font tag')
assert.doesNotMatch(effectController, /pauseSystemEvents|resumeSystemEvents|enabled\s*=\s*false/, 'effect playback must not disable gameplay input')
assert.match(gameManager, /this\.audio\?\.playRoundStart\(\)/, 'local round creation must dispatch the layered semantic start/deal cue')
assert.match(tableTurnClock, /this\.remainingSeconds > 0 && this\.remainingSeconds <= 5[\s\S]*this\.dependencies\.playCountdown\(this\.remainingSeconds\)/, 'the last five countdown seconds must select their dedicated semantic ticks')
assert.match(tableMatchCoordinator, /isLiveNextRound[\s\S]*audio\.playRoundStart\(\)/, 'live network next-round preparation must dispatch the layered start/deal cue')
assert.match(gameScene, /action => this\.audio\?\.playActionVoice\(action\)/, 'the scene must bind action semantics to the audio controller')
assert.match(gameScene, /this\.audio\?\.setBgmMode\(visible \? 'battle' : 'lobby'\)/, 'only the visible battle table may select the battle BGM')

assert.equal(fs.existsSync(path.join(projectRoot, 'assets/game-assets/effects/kenney/LICENSE.txt')), true, 'Kenney runtime license must remain beside the textures')
assert.match(read(path.join(projectRoot, 'THIRD_PARTY.md')), /rFXGen 5\.0/)
assert.match(read(path.join(projectRoot, 'THIRD_PARTY.md')), /Creative Commons Zero/)
assert.match(read(path.join(projectRoot, 'THIRD_PARTY.md')), /Project-authorized Guandan audio collection/)

process.stdout.write(`audio and effect regression checks passed (web build ${requireBuild ? 'checked' : 'not requested'})\n`)
