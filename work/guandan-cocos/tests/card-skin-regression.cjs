const assert = require('node:assert/strict')
const crypto = require('node:crypto')
const fs = require('node:fs')
const path = require('node:path')
const { pathToFileURL } = require('node:url')

const projectRoot = path.resolve(__dirname, '..')
const resolverPath = path.join(projectRoot, 'assets/scripts/ui/CardSkinResolver.ts')
const frameStorePath = path.join(projectRoot, 'assets/scripts/ui/ClassicCardFrameStore.ts')
const cardViewPath = path.join(projectRoot, 'assets/scripts/ui/CardView.ts')
const vfxCardSnapshotPath = path.join(projectRoot, 'assets/scripts/effects/VfxCardSnapshot.ts')
const effectNodePoolPath = path.join(projectRoot, 'assets/scripts/effects/EffectNodePool.ts')
const handControllerPath = path.join(projectRoot, 'assets/scripts/ui/HandController.ts')
const gameScenePath = path.join(projectRoot, 'assets/scripts/scenes/GameScene.ts')
const runtimeAssetsPath = path.join(projectRoot, 'assets/game-assets/cards/classic')
const upstreamAssetsPath = '/Users/mac/Downloads/掼蛋/client-cocos/assets/Game/Poker'

function readUtf8 (filePath) {
  return fs.readFileSync(filePath, 'utf8')
}

function sha256 (filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex')
}

function pngNames (directory) {
  return fs.readdirSync(directory).filter(name => name.endsWith('.png')).sort()
}

async function verifyResolverAndAssets () {
  const resolver = await import(`${pathToFileURL(resolverPath).href}?regression=${Date.now()}`)
  const suits = [
    { display: '♠', red: false },
    { display: '♥', red: true },
    { display: '♣', red: false },
    { display: '♦', red: true },
  ]
  const ranks = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K']
  const cards = suits.flatMap(suit => ranks.map(rank => ({ rank, suit: suit.display, red: suit.red })))
    .concat([
      { rank: '小王', suit: '王', red: false },
      { rank: '大王', suit: '王', red: true },
    ])
  const plans = cards.map(card => resolver.resolveClassicCardPlan(card))

  assert.equal(cards.length, 54, 'the regression deck must cover exactly 54 card faces')
  assert.equal(plans.every(Boolean), true, 'every card face must resolve to classic artwork')
  assert.equal(new Set(plans.map(plan => plan.key)).size, 54, 'all card faces must have unique mapping keys')

  const referencedAssets = new Set(plans.flatMap(plan => resolver.classicCardAssetNames(plan)))
  const runtimePngs = pngNames(runtimeAssetsPath)
  assert.equal(referencedAssets.size, 49, '54 faces must compose from the reviewed 49 PNG components')
  assert.deepEqual(
    Array.from(referencedAssets).map(asset => `${asset}.png`).sort(),
    runtimePngs,
    'the resolver must reference every packaged classic component exactly once',
  )
  assert.deepEqual(
    [...resolver.ALL_CLASSIC_CARD_ASSET_NAMES].map(asset => `${asset}.png`).sort(),
    runtimePngs,
    'the startup preloader manifest must exactly match the packaged PNG set',
  )
  assert.equal(new Set(resolver.ALL_CLASSIC_CARD_ASSET_NAMES).size, 49, 'the startup manifest must not contain duplicates')

  assert.equal(resolver.resolveClassicCardPlan({ rank: '?', suit: '♠', red: false }), null, 'unknown ranks must not create partial cards')
  assert.equal(resolver.resolveClassicCardPlan({ rank: 'A', suit: '?', red: false }), null, 'unknown suits must not create partial cards')

  for (const name of runtimePngs) {
    const runtimePath = path.join(runtimeAssetsPath, name)
    const upstreamPath = path.join(upstreamAssetsPath, name)
    if (!fs.existsSync(upstreamPath)) continue
    assert.equal(sha256(runtimePath), sha256(upstreamPath), `runtime PNG must remain byte-identical to upstream: ${name}`)
    const runtimeMeta = `${runtimePath}.meta`
    const upstreamMeta = `${upstreamPath}.meta`
    if (fs.existsSync(runtimeMeta) && fs.existsSync(upstreamMeta)) {
      assert.notEqual(readUtf8(runtimeMeta), readUtf8(upstreamMeta), `upstream metadata must not be copied: ${name}.meta`)
    }
  }
}

function verifySingleRendererBoundary () {
  const handController = readUtf8(handControllerPath)
  const cardView = readUtf8(cardViewPath)
  const resolver = readUtf8(resolverPath)
  const frameStore = readUtf8(frameStorePath)
  const gameScene = readUtf8(gameScenePath)

  assert.doesNotMatch(handController, /CardSkinResolver|ClassicCardFrameStore/, 'HandController must stay independent from artwork loading')
  assert.doesNotMatch(resolver, /CardSkinRegistry|resolveCardSkinRenderMode|CardSkinId/, 'the removed runtime skin switch must not return')
  assert.doesNotMatch(cardView, /\b(Label|RichText)\b|CardText|CenterSuit|showCodeFallback|CardSkinRegistry|requestedSkin|setSkin\s*\(/, 'CardView must not contain a second text/code card renderer')
  assert.match(cardView, /from '\.\/ClassicCardFrameStore'/, 'CardView must consume the shared classic frame store')
  assert.match(cardView, /const requestId = \+\+this\.artworkRequestId[\s\S]*this\.applyCard\(requestId\)/, 'every bind must invalidate older artwork requests before any fast path')
  assert.match(cardView, /requestId !== this\.artworkRequestId[\s\S]*this\.expectedPlanKey !== plan\.key[\s\S]*expected\?\.key !== plan\.key/, 'async artwork must reject stale tokens and stale face plans')
  assert.match(cardView, /this\.hideClassicArtwork\(\)[\s\S]*requestClassicCardFrames\(plan\)/, 'an uncached face must remain hidden until all classic layers resolve')
  assert.match(cardView, /this\.renderedPlan = plan[\s\S]*this\.classicRoot!\.active = true/, 'classic artwork may become visible only after a complete plan is applied')
  assert.match(cardView, /StackCornerRank/, 'stack strips must reuse the classic rank Sprite')
  assert.match(cardView, /StackCornerSuit/, 'stack strips must reuse the classic suit Sprite')
  assert.match(cardView, /StackCornerJoker/, 'stack strips must reuse the classic joker Sprite')

  assert.match(frameStore, /const frameCache = new Map<string, SpriteFrame>\(\)/, 'one process-wide cache must own resolved card frames')
  assert.match(frameStore, /const frameRequests = new Map<string, Promise<SpriteFrame \| null>>\(\)/, 'one process-wide cache must deduplicate in-flight requests')
  assert.equal((frameStore.match(/loadGameAssetAsync\(/g) || []).length, 1, 'classic textures must have one production load call site')
  assert.match(frameStore, /ALL_CLASSIC_CARD_ASSET_NAMES\.map\(requestClassicCardFrame\)/, 'the startup preloader must request the complete reviewed manifest')
  assert.match(frameStore, /\.catch\(\(\) => null\)[\s\S]*\.finally\(\(\) => frameRequests\.delete\(assetName\)\)/, 'failed requests must be retryable instead of entering the cache')
  assert.equal(fs.existsSync(`${frameStorePath}.meta`), true, 'the shared frame store needs Cocos metadata')

  assert.match(gameScene, /import \{ preloadAllClassicCardFrames \} from '\.\.\/ui\/ClassicCardFrameStore'/, 'startup must import the complete classic preloader')
  assert.match(gameScene, /Promise\.all\(\[[\s\S]*preloadAllClassicCardFrames\(\)[\s\S]*\]\)/, 'lobby initialization must await the complete classic deck')
  assert.match(gameScene, /if \(!classicFramesReady\) throw new Error/, 'incomplete artwork must stay on the retryable loading screen')
  assert.ok(
    gameScene.indexOf('preloadAllClassicCardFrames()') < gameScene.indexOf('this.initializeGame()'),
    'the complete classic deck must be ready before any page or table CardView is created',
  )

  assert.match(handController, /private entranceCompletion: Promise<void> \| null = null/, 'deal animation completion must remain owned by HandController')
  assert.match(handController, /public consumeEntranceCompletion \(\): Promise<void> \| null \{[\s\S]*this\.entranceCompletion = null[\s\S]*return completion/, 'the deal barrier must still be consumed once')
  assert.match(cardView, /const bombReactionRoot = new Node\('BombReactionRoot'\)[\s\S]*visualRoot\.parent = bombReactionRoot/, 'bomb motion must retain a wrapper outside the selection root')
  assert.equal((cardView.match(/emit\('guandan:card-toggle'/g) || []).length, 0, 'CardView must forward raw touch input without maintaining another selection state machine')
  assert.equal((handController.match(/this\.node\.emit\('guandan:card-toggle', cardId\)/g) || []).length, 1, 'HandController must retain exactly one authoritative selection event emission')
  assert.match(cardView, /private inputTargets \(\): Node\[\] \{\s*return this\.hitArea \? \[this\.hitArea\] : \[\]/, 'only the dedicated visible-card hit area may own selection input')
}

function verifyVfxCardSnapshotBoundary () {
  const snapshot = readUtf8(vfxCardSnapshotPath)
  const pool = readUtf8(effectNodePoolPath)

  assert.doesNotMatch(snapshot, /\b(Graphics|Label|Texture2D)\b|loadGameAssetAsync|classicFrameCache|classicFrameRequests/, 'VFX snapshots must not contain another renderer or texture cache')
  assert.doesNotMatch(pool, /CardView|cardDisplay/, 'the effect pool must not route snapshots through CardView')
  assert.match(snapshot, /from '\.\.\/ui\/ClassicCardFrameStore'/, 'VFX snapshots must consume the same frame store as CardView')
  assert.match(snapshot, /resolveClassicCardPlan\(cardDisplay\(card\)\)/, 'VFX cards must consume the canonical presentation mapping')
  assert.match(snapshot, /requestClassicCardFrames\(plan\)/, 'VFX cards must request an all-or-nothing classic plan')
  assert.match(snapshot, /requestId !== this\.requestId[\s\S]*this\.expectedPlanKey !== plan\.key/, 'pooled VFX nodes must reject stale async artwork')
  assert.match(snapshot, /preloadClassicCardFrames\(plans as ClassicCardPlan\[\]\)/, 'effect prewarming must populate the process-wide frame store')
  assert.match(snapshot, /artworkRoot\.active = false/, 'unready snapshots must remain hidden')
  assert.equal((snapshot.match(/node\.addComponent\(Sprite\)/g) || []).length, 1, 'all VFX visual layers must use the Sprite-only layer factory')
  assert.match(pool, /node\.getComponent\(VfxCardSnapshot\)\?\.bind\(card\)/, 'pooled snapshots must rebind the acquired card')
  assert.match(pool, /node\.getComponent\(VfxCardSnapshot\)\?\.hide\(\)/, 'pool release must invalidate pending loads and hide the old face')
}

function verifyLicenseRecord () {
  const thirdParty = readUtf8(path.join(projectRoot, 'THIRD_PARTY.md'))
  const packagedLicense = readUtf8(path.join(runtimeAssetsPath, 'LICENSE-NiuMa-MIT.txt'))
  const retainedLicense = readUtf8(path.join(projectRoot, 'third_party/licenses/NiuMa-client-cocos-MIT.txt'))
  assert.match(thirdParty, /https:\/\/github\.com\/niuma-wj\/client-cocos/)
  assert.match(thirdParty, /f9d037feaef5a80867fd97c8dd39b9a7486fbeca/)
  assert.match(packagedLicense, /Copyright \(c\) 2025 NiuMa/)
  assert.equal(retainedLicense.includes('Permission is hereby granted'), true)
}

function verifyBuiltResources (requireBuild) {
  const configPath = path.join(projectRoot, 'build/web-desktop/assets/game-assets/config.json')
  if (!fs.existsSync(configPath)) {
    assert.equal(requireBuild, false, `web resources bundle is missing: ${configPath}`)
    return false
  }
  const config = JSON.parse(readUtf8(configPath))
  const paths = new Set(Object.values(config.paths || {}).map(entry => entry[0]))
  pngNames(runtimeAssetsPath).forEach(name => {
    const asset = name.slice(0, -'.png'.length)
    assert.equal(paths.has(`cards/classic/${asset}/texture`), true, `web bundle must publish classic texture: ${asset}`)
  })
  assert.equal(paths.has('cards/classic/LICENSE-NiuMa-MIT'), true, 'the web resources bundle must retain the upstream MIT license')
  return true
}

async function main () {
  verifySingleRendererBoundary()
  verifyVfxCardSnapshotBoundary()
  verifyLicenseRecord()
  await verifyResolverAndAssets()
  const buildChecked = verifyBuiltResources(process.argv.includes('--require-build'))
  process.stdout.write(`card skin regression checks passed (54 classic-only faces, shared cache, startup preload, license, web build ${buildChecked ? 'checked' : 'not requested'})\n`)
}

main().catch(error => {
  console.error(error)
  process.exitCode = 1
})
