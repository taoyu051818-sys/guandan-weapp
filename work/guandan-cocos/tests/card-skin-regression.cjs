const assert = require('node:assert/strict')
const crypto = require('node:crypto')
const fs = require('node:fs')
const path = require('node:path')
const zlib = require('node:zlib')
const { pathToFileURL } = require('node:url')

const projectRoot = path.resolve(__dirname, '..')
const resolverPath = path.join(projectRoot, 'assets/scripts/ui/CardSkinResolver.ts')
const frameStorePath = path.join(projectRoot, 'assets/scripts/ui/ClassicCardFrameStore.ts')
const cardViewPath = path.join(projectRoot, 'assets/scripts/ui/CardView.ts')
const geometryPath = path.join(projectRoot, 'assets/scripts/ui/ClassicCardGeometry.ts')
const vfxCardSnapshotPath = path.join(projectRoot, 'assets/scripts/effects/VfxCardSnapshot.ts')
const effectNodePoolPath = path.join(projectRoot, 'assets/scripts/effects/EffectNodePool.ts')
const handControllerPath = path.join(projectRoot, 'assets/scripts/ui/HandController.ts')
const gameScenePath = path.join(projectRoot, 'assets/scripts/scenes/GameScene.ts')
const startupCoordinatorPath = path.join(projectRoot, 'assets/scripts/scenes/StartupCoordinator.ts')
const runtimeAssetsPath = path.join(projectRoot, 'assets/game-assets/cards/classic')
const authorizedSourcesPath = path.join(projectRoot, 'art-source/cards/reference')
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

function pngHeader (filePath) {
  const bytes = fs.readFileSync(filePath)
  assert.equal(bytes.subarray(1, 4).toString('ascii'), 'PNG', `asset must be a PNG: ${filePath}`)
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20), bitDepth: bytes[24], colorType: bytes[25] }
}

function paethPredictor (left, above, upperLeft) {
  const estimate = left + above - upperLeft
  const leftDistance = Math.abs(estimate - left)
  const aboveDistance = Math.abs(estimate - above)
  const upperLeftDistance = Math.abs(estimate - upperLeft)
  if (leftDistance <= aboveDistance && leftDistance <= upperLeftDistance) return left
  return aboveDistance <= upperLeftDistance ? above : upperLeft
}

function decodeRgbaPng (filePath) {
  const bytes = fs.readFileSync(filePath)
  const pngSignature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])
  assert.equal(bytes.subarray(0, pngSignature.length).equals(pngSignature), true, `asset must have a valid PNG signature: ${filePath}`)

  let offset = pngSignature.length
  let header = null
  const imageDataChunks = []
  while (offset + 12 <= bytes.length) {
    const length = bytes.readUInt32BE(offset)
    const type = bytes.subarray(offset + 4, offset + 8).toString('ascii')
    const dataStart = offset + 8
    const dataEnd = dataStart + length
    assert.ok(dataEnd + 4 <= bytes.length, `PNG chunk exceeds file bounds: ${filePath}`)
    const data = bytes.subarray(dataStart, dataEnd)
    if (type === 'IHDR') {
      header = {
        width: data.readUInt32BE(0),
        height: data.readUInt32BE(4),
        bitDepth: data[8],
        colorType: data[9],
        compression: data[10],
        filter: data[11],
        interlace: data[12],
      }
    } else if (type === 'IDAT') {
      imageDataChunks.push(data)
    }
    offset = dataEnd + 4
    if (type === 'IEND') break
  }

  assert.ok(header, `PNG is missing IHDR: ${filePath}`)
  assert.equal(header.bitDepth, 8, `palette regression requires 8-bit PNG channels: ${filePath}`)
  assert.equal(header.colorType, 6, `palette regression requires RGBA PNG data: ${filePath}`)
  assert.deepEqual([header.compression, header.filter, header.interlace], [0, 0, 0], `palette regression requires standard non-interlaced PNG data: ${filePath}`)
  assert.ok(imageDataChunks.length > 0, `PNG is missing IDAT: ${filePath}`)

  const bytesPerPixel = 4
  const rowBytes = header.width * bytesPerPixel
  const inflated = zlib.inflateSync(Buffer.concat(imageDataChunks))
  assert.equal(inflated.length, (rowBytes + 1) * header.height, `unexpected PNG scanline length: ${filePath}`)
  const rgba = Buffer.alloc(rowBytes * header.height)
  let sourceOffset = 0
  for (let y = 0; y < header.height; y += 1) {
    const filterType = inflated[sourceOffset]
    sourceOffset += 1
    assert.ok(filterType >= 0 && filterType <= 4, `unsupported PNG filter ${filterType}: ${filePath}`)
    const rowOffset = y * rowBytes
    for (let x = 0; x < rowBytes; x += 1) {
      const encoded = inflated[sourceOffset]
      sourceOffset += 1
      const left = x >= bytesPerPixel ? rgba[rowOffset + x - bytesPerPixel] : 0
      const above = y > 0 ? rgba[rowOffset - rowBytes + x] : 0
      const upperLeft = y > 0 && x >= bytesPerPixel ? rgba[rowOffset - rowBytes + x - bytesPerPixel] : 0
      const predictor = filterType === 0
        ? 0
        : filterType === 1
          ? left
          : filterType === 2
            ? above
            : filterType === 3
              ? Math.floor((left + above) / 2)
              : paethPredictor(left, above, upperLeft)
      rgba[rowOffset + x] = (encoded + predictor) & 0xff
    }
  }
  return rgba
}

function visiblePngPalette (filePath) {
  const rgba = decodeRgbaPng(filePath)
  const colors = new Set()
  for (let offset = 0; offset < rgba.length; offset += 4) {
    if (rgba[offset + 3] === 0) continue
    colors.add(`#${rgba.subarray(offset, offset + 3).toString('hex').toUpperCase()}`)
  }
  return colors
}

function verifyJokerPalettes () {
  const expectations = [
    {
      name: 'red_joker.png',
      allowed: ['#FFFFFF', '#D71920', '#971216'],
      required: ['#FFFFFF', '#D71920'],
    },
    {
      name: 'black_joker.png',
      allowed: ['#FFFFFF', '#000000', '#333333'],
      required: ['#FFFFFF', '#000000'],
    },
  ]
  const violations = []
  for (const expectation of expectations) {
    const palette = visiblePngPalette(path.join(runtimeAssetsPath, expectation.name))
    const unexpected = [...palette].filter(color => !expectation.allowed.includes(color)).sort()
    if (unexpected.length > 0) {
      violations.push(`${expectation.name}: ${unexpected.length} unexpected colors (${unexpected.slice(0, 12).join(', ')})`)
    }
    expectation.required.forEach(color => {
      if (!palette.has(color)) violations.push(`${expectation.name}: missing required visible color ${color}`)
    })
  }
  assert.deepEqual(violations, [], `Joker artwork must use only its reviewed visible-pixel palette:\n${violations.join('\n')}`)
}

function verifyCleanJokerOverlay () {
  const red = decodeRgbaPng(path.join(runtimeAssetsPath, 'red_joker.png'))
  const black = decodeRgbaPng(path.join(runtimeAssetsPath, 'black_joker.png'))
  const redSemantic = new Map([['#FFFFFF', 0], ['#D71920', 1], ['#971216', 2]])
  const blackSemantic = new Map([['#FFFFFF', 0], ['#000000', 1], ['#333333', 2]])
  let visible = 0
  let primary = 0
  let alphaMismatch = 0
  let semanticMismatch = 0
  let transparentRgb = 0

  for (let offset = 0; offset < red.length; offset += 4) {
    const redAlpha = red[offset + 3]
    const blackAlpha = black[offset + 3]
    if (redAlpha !== blackAlpha) alphaMismatch += 1
    if (redAlpha === 0) {
      if (red[offset] || red[offset + 1] || red[offset + 2] || black[offset] || black[offset + 1] || black[offset + 2]) transparentRgb += 1
      continue
    }
    visible += 1
    const redKey = `#${red.subarray(offset, offset + 3).toString('hex').toUpperCase()}`
    const blackKey = `#${black.subarray(offset, offset + 3).toString('hex').toUpperCase()}`
    const redIndex = redSemantic.get(redKey)
    const blackIndex = blackSemantic.get(blackKey)
    if (redIndex !== blackIndex) semanticMismatch += 1
    if (redIndex === 1) primary += 1
  }

  const pixelCount = 148 * 212
  assert.equal(alphaMismatch, 0, 'red and black Jokers must share one alpha mask')
  assert.equal(semanticMismatch, 0, 'red and black Jokers must share one semantic color mask')
  assert.equal(transparentRgb, 0, 'fully transparent Joker pixels must have zero RGB')
  assert.ok(visible / pixelCount > 0.25 && visible / pixelCount < 0.45, 'Joker must remain a transparent overlay instead of an opaque rectangle')
  assert.ok(primary / visible > 0.1, 'each Joker must retain a meaningful primary-color region')

  const cornerOffsets = [0, (148 - 1) * 4, (212 - 1) * 148 * 4, (148 * 212 - 1) * 4]
  cornerOffsets.forEach(offset => assert.equal(red[offset + 3], 0, 'Joker overlay corners must remain transparent'))

  const templatePath = path.join(authorizedSourcesPath, 'joker-template.png')
  const template = decodeRgbaPng(templatePath)
  let templateVisible = 0
  let templateTransparentRgb = 0
  for (let offset = 0; offset < template.length; offset += 4) {
    if (template[offset + 3] > 0) templateVisible += 1
    else if (template[offset] || template[offset + 1] || template[offset + 2]) templateTransparentRgb += 1
  }
  assert.equal(templateTransparentRgb, 0, 'normalized Joker template must clear hidden RGB data')
  assert.ok(templateVisible / (539 * 772) > 0.25 && templateVisible / (539 * 772) < 0.45, 'normalized Joker template must remain a transparent overlay')
}

function verifyJokerMasterSource () {
  const masterPath = path.join(authorizedSourcesPath, 'joker-master.png')
  const templatePath = path.join(authorizedSourcesPath, 'joker-template.png')
  const retiredReferencePath = path.join(authorizedSourcesPath, 'joker-palette-reference.jpg')
  assert.equal(fs.existsSync(masterPath), true, 'the complete approved Joker PNG master must be retained')
  const header = pngHeader(masterPath)
  assert.deepEqual([header.width, header.height], [539, 772], 'the complete Joker master dimensions must remain 539x772')
  assert.equal(header.bitDepth, 8, 'the complete Joker master must use 8-bit channels')
  assert.equal(header.colorType, 6, 'the complete Joker master must retain RGBA data')
  assert.equal(fs.existsSync(templatePath), true, 'the normalized Joker overlay template must be retained')
  const templateHeader = pngHeader(templatePath)
  assert.deepEqual([templateHeader.width, templateHeader.height], [539, 772], 'the normalized Joker template dimensions must remain 539x772')
  assert.equal(templateHeader.colorType, 6, 'the normalized Joker template must retain RGBA data')
  assert.equal(fs.existsSync(retiredReferencePath), false, 'the obsolete cropped Joker JPG reference must not return')
}

function authorizedSourceName (runtimeName) {
  if (runtimeName === 'black_joker.png') return 'joker-small.webp'
  if (runtimeName === 'red_joker.png') return 'joker-big.webp'
  const rank = runtimeName.match(/^num_(black|red)_(\d+)\.png$/)
  if (rank) {
    const rankName = ({ 1: 'A', 11: 'J', 12: 'Q', 13: 'K' })[Number(rank[2])] ?? rank[2]
    return `rank-${rank[1]}-${rankName}.webp`
  }
  const suit = runtimeName.match(/^shape_(spade|heart|club|diamond)(_s)?\.png$/)
  if (suit) return `suit-${suit[1]}${suit[2] ? '' : '-large'}.webp`
  return null
}

async function verifyResolverAndAssets () {
  const resolver = await import(`${pathToFileURL(resolverPath).href}?regression=${Date.now()}`)
  const suits = [
    { key: 'spade', red: false },
    { key: 'heart', red: true },
    { key: 'club', red: false },
    { key: 'diamond', red: true },
  ]
  const ranks = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K']
  const cards = suits.flatMap(suit => ranks.map(rank => ({ rank, suit: suit.key, red: suit.red })))
    .concat([
      { rank: 'Small', suit: 'joker', red: false },
      { rank: 'Big', suit: 'joker', red: true },
    ])
  const plans = cards.map(card => resolver.resolveClassicCardPlan(card))

  assert.equal(cards.length, 54, 'the regression deck must cover exactly 54 card faces')
  assert.equal(plans.every(Boolean), true, 'every card face must resolve to classic artwork')
  assert.equal(new Set(plans.map(plan => plan.key)).size, 54, 'all card faces must have unique mapping keys')

  const referencedAssets = new Set(plans.flatMap(plan => resolver.classicCardAssetNames(plan)))
  const runtimePngs = pngNames(runtimeAssetsPath)
  assert.equal(referencedAssets.size, 37, '54 faces must compose from the reviewed 37 PNG components')
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
  assert.equal(new Set(resolver.ALL_CLASSIC_CARD_ASSET_NAMES).size, 37, 'the startup manifest must not contain duplicates')
  assert.equal(runtimePngs.length, 37, 'the packaged classic skin must contain exactly 37 PNG components')
  assert.equal(runtimePngs.some(name => name.startsWith('role_')), false, 'legacy role portraits must not remain packaged')
  assert.equal(resolver.ALL_CLASSIC_CARD_ASSET_NAMES.some(asset => asset.startsWith('role_')), false, 'legacy role portraits must not remain in the preload manifest')
  assert.equal(fs.readdirSync(runtimeAssetsPath).some(name => name.endsWith('.webp')), false, 'runtime cards must not depend on WebP on WeChat Android')

  const totalRuntimeBytes = runtimePngs.reduce((sum, name) => sum + fs.statSync(path.join(runtimeAssetsPath, name)).size, 0)
  assert.ok(totalRuntimeBytes < 220000, `runtime card PNG set must stay compact; found ${totalRuntimeBytes} bytes`)

  assert.equal(resolver.resolveClassicCardPlan({ rank: '?', suit: 'spade', red: false }), null, 'unknown ranks must not create partial cards')
  assert.equal(resolver.resolveClassicCardPlan({ rank: 'A', suit: '?', red: false }), null, 'unknown suits must not create partial cards')

  for (const name of runtimePngs) {
    const runtimePath = path.join(runtimeAssetsPath, name)
    const header = pngHeader(runtimePath)
    assert.equal(header.bitDepth, 8, `runtime card asset must use 8-bit channels: ${name}`)
    assert.equal(header.colorType, 6, `runtime card asset must retain an alpha channel: ${name}`)
    assert.equal(fs.existsSync(`${runtimePath}.meta`), true, `runtime card asset must retain its Cocos metadata: ${name}`)
    if (name === 'bg_front.png') {
      const upstreamPath = path.join(upstreamAssetsPath, name)
      if (fs.existsSync(upstreamPath)) {
        assert.equal(sha256(runtimePath), sha256(upstreamPath), 'the retained MIT card surface must remain byte-identical to upstream')
      }
      continue
    }
    const sourceName = authorizedSourceName(name)
    assert.ok(sourceName, `runtime card component is missing a source mapping: ${name}`)
    assert.equal(fs.existsSync(path.join(authorizedSourcesPath, sourceName)), true, `authorized card source is missing: ${sourceName}`)
    if (/^num_/.test(name)) assert.deepEqual([header.width, header.height], [48, 64], `rank artwork dimensions changed: ${name}`)
    if (/^shape_.+_s\.png$/.test(name)) assert.deepEqual([header.width, header.height], [96, 96], `corner/HUD suit dimensions changed: ${name}`)
    if (/^shape_.+\.png$/.test(name) && !/_s\.png$/.test(name)) assert.deepEqual([header.width, header.height], [128, 128], `large suit dimensions changed: ${name}`)
    if (/joker\.png$/.test(name)) assert.deepEqual([header.width, header.height], [148, 212], `joker dimensions changed: ${name}`)
  }
}

function verifySingleRendererBoundary () {
  const handController = readUtf8(handControllerPath)
  const cardView = readUtf8(cardViewPath)
  const geometry = readUtf8(geometryPath)
  const resolver = readUtf8(resolverPath)
  const frameStore = readUtf8(frameStorePath)
  const gameScene = readUtf8(gameScenePath)
  const startupCoordinator = readUtf8(startupCoordinatorPath)

  assert.doesNotMatch(handController, /CardSkinResolver|ClassicCardFrameStore/, 'HandController must stay independent from artwork loading')
  assert.doesNotMatch(resolver, /CardSkinRegistry|resolveCardSkinRenderMode|CardSkinId/, 'the removed runtime skin switch must not return')
  assert.doesNotMatch(resolver, /role_/, 'face-card portraits must not return to the resolver')
  assert.doesNotMatch(cardView, /\b(Label|RichText)\b|CardText|CenterSuit|showCodeFallback|CardSkinRegistry|requestedSkin|setSkin\s*\(/, 'CardView must not contain a second text/code card renderer')
  assert.match(cardView, /from '\.\/ClassicCardGeometry'/, 'CardView must consume the shared card geometry')
  assert.match(cardView, /from '\.\/ClassicCardFrameStore'/, 'CardView must consume the shared classic frame store')
  assert.match(cardView, /const requestId = \+\+this\.artworkRequestId[\s\S]*this\.applyCard\(requestId\)/, 'every bind must invalidate older artwork requests before any fast path')
  assert.match(cardView, /requestId !== this\.artworkRequestId[\s\S]*this\.expectedPlanKey !== plan\.key[\s\S]*expected\?\.key !== plan\.key/, 'async artwork must reject stale tokens and stale face plans')
  assert.match(cardView, /this\.hideClassicArtwork\(\)[\s\S]*requestClassicCardFrames\(plan\)/, 'an uncached face must remain hidden until all classic layers resolve')
  assert.match(cardView, /private applyClassicFrames[\s\S]*setClassicFrame\('background'[\s\S]*setClassicFrame\('cornerRank'[\s\S]*setClassicFrame\('cornerSuit'[\s\S]*setClassicFrame\('center'[\s\S]*this\.classicRoot!\.active = true/, 'classic artwork may become visible only after all four shared Sprite layers are applied')
  assert.equal((cardView.match(/new Map<ClassicLayer, Sprite>\(\)/g) || []).length, 1, 'normal and covered cards must reuse one classic Sprite set')
  const stackMethodStart = cardView.indexOf('public configureStackHitArea')
  const stackMethodEnd = cardView.indexOf('private applyHitAreaGeometry', stackMethodStart)
  assert.ok(stackMethodStart >= 0 && stackMethodEnd > stackMethodStart, 'CardView must retain a bounded covered-stack configuration method')
  const stackMethod = cardView.slice(stackMethodStart, stackMethodEnd)
  assert.match(stackMethod, /this\.stackCovered =[\s\S]*this\.hitAreaHeight[\s\S]*this\.applyHitAreaGeometry\(\)[\s\S]*this\.refreshStateVisuals\(\)/, 'covered cards must restrict interaction and redraw exposed state overlays')
  assert.doesNotMatch(stackMethod, /classicSprites|classicRoot|spriteFrame|new Node/, 'covered cards must keep the same readable classic artwork instead of creating a second renderer')

  assert.match(geometry, /export const CLASSIC_CARD_REFERENCE_SIZE/, 'the shared module must own the card reference size')
  assert.match(geometry, /export const CLASSIC_CARD_LAYER_GEOMETRY/, 'the shared module must own normal-card layer geometry')
  assert.match(geometry, /export const CLASSIC_CARD_JOKER_GEOMETRY/, 'the shared module must own joker geometry')
  assert.match(geometry, /cornerRank:[^\n]*y:\s*37/, 'corner rank must retain the reviewed horizontal center line')
  assert.match(geometry, /cornerSuit:[^\n]*height:\s*31[^\n]*y:\s*37/, 'corner suit must be smaller than the rank and share its center line')

  assert.match(frameStore, /const frameCache = new Map<string, SpriteFrame>\(\)/, 'one process-wide cache must own resolved card frames')
  assert.match(frameStore, /const frameRequests = new Map<string, Promise<SpriteFrame \| null>>\(\)/, 'one process-wide cache must deduplicate in-flight requests')
  assert.equal((frameStore.match(/loadGameAssetAsync\(/g) || []).length, 1, 'classic textures must have one production load call site')
  assert.match(frameStore, /ALL_CLASSIC_CARD_ASSET_NAMES\.map\(requestClassicCardFrame\)/, 'the startup preloader must request the complete reviewed manifest')
  assert.match(frameStore, /\.catch\(\(\) => null\)[\s\S]*\.finally\(\(\) => frameRequests\.delete\(assetName\)\)/, 'failed requests must be retryable instead of entering the cache')
  assert.equal(fs.existsSync(`${frameStorePath}.meta`), true, 'the shared frame store needs Cocos metadata')

  assert.doesNotMatch(gameScene, /preloadAllClassicCardFrames/, 'GameScene must not own card artwork bootstrap details')
  assert.match(startupCoordinator, /import \{ preloadAllClassicCardFrames \} from '\.\.\/ui\/ClassicCardFrameStore'/, 'startup must import the complete classic preloader')
  assert.match(startupCoordinator, /Promise\.all\(\[[\s\S]*preloadAllClassicCardFrames\(\)[\s\S]*\]\)/, 'lobby initialization must await the complete classic deck')
  assert.match(startupCoordinator, /if \(!cardSkinReady\) throw new Error/, 'incomplete artwork must stay on the retryable loading screen')
  assert.ok(
    startupCoordinator.indexOf('preloadAllClassicCardFrames()') < startupCoordinator.indexOf('this.dependencies.initializeApplication()'),
    'the complete classic deck must be ready before any page or table CardView is created',
  )

  assert.match(handController, /private entranceCompletion: Promise<void> \| null = null/, 'deal animation completion must remain owned by HandController')
  assert.match(handController, /public consumeEntranceCompletion \(\): Promise<void> \| null \{[\s\S]*this\.entranceCompletion = null[\s\S]*return completion/, 'the deal barrier must still be consumed once')
  assert.match(cardView, /const bombReactionRoot = new Node\('BombReactionRoot'\)[\s\S]*visualRoot\.parent = bombReactionRoot/, 'bomb motion must retain a wrapper outside the selection root')
  assert.match(cardView, /CardLevelYellowFilter[\s\S]*new Color\(255, 190, 28, 54\)/, 'level cards must receive a dedicated yellow filter above the classic artwork')
  assert.equal((cardView.match(/emit\('guandan:card-toggle'/g) || []).length, 0, 'CardView must forward raw touch input without maintaining another selection state machine')
  assert.equal((handController.match(/this\.node\.emit\('guandan:card-toggle', cardId\)/g) || []).length, 1, 'HandController must retain exactly one authoritative selection event emission')
  assert.match(cardView, /private inputTargets \(\): Node\[\] \{\s*return this\.hitArea \? \[this\.hitArea\] : \[\]/, 'only the dedicated visible-card hit area may own selection input')
}

function verifyVfxCardSnapshotBoundary () {
  const snapshot = readUtf8(vfxCardSnapshotPath)
  const pool = readUtf8(effectNodePoolPath)

  assert.doesNotMatch(snapshot, /\b(Graphics|Label|Texture2D)\b|loadGameAssetAsync|classicFrameCache|classicFrameRequests/, 'VFX snapshots must not contain another renderer or texture cache')
  assert.doesNotMatch(pool, /CardView|cardDisplay/, 'the effect pool must not route snapshots through CardView')
  assert.match(snapshot, /from '\.\.\/ui\/ClassicCardGeometry'/, 'VFX snapshots must consume the same geometry as CardView')
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
  const sourceReadme = readUtf8(path.join(authorizedSourcesPath, 'README.md'))
  const packagedLicense = readUtf8(path.join(runtimeAssetsPath, 'LICENSE-NiuMa-MIT.txt'))
  const retainedLicense = readUtf8(path.join(projectRoot, 'third_party/licenses/NiuMa-client-cocos-MIT.txt'))
  assert.match(thirdParty, /https:\/\/github\.com\/niuma-wj\/client-cocos/)
  assert.match(thirdParty, /f9d037feaef5a80867fd97c8dd39b9a7486fbeca/)
  assert.match(packagedLicense, /Copyright \(c\) 2025 NiuMa/)
  assert.equal(retainedLicense.includes('Permission is hereby granted'), true)
  assert.match(thirdParty, /Project-authorized classic card face assets/)
  assert.match(sourceReadme, /36 lossless WebP files[\s\S]*dwebp/)
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
  verifyJokerMasterSource()
  verifyJokerPalettes()
  verifyCleanJokerOverlay()
  verifySingleRendererBoundary()
  verifyVfxCardSnapshotBoundary()
  verifyLicenseRecord()
  await verifyResolverAndAssets()
  const buildChecked = verifyBuiltResources(process.argv.includes('--require-build'))
  process.stdout.write(`card skin regression checks passed (54 classic-only faces, 37 PNG components, shared geometry/cache, startup preload, license, web build ${buildChecked ? 'checked' : 'not requested'})\n`)
}

main().catch(error => {
  console.error(error)
  process.exitCode = 1
})
