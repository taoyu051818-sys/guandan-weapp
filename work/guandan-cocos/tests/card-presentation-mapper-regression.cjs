const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { pathToFileURL } = require('node:url')

const projectRoot = path.resolve(__dirname, '..')
const mapperPath = path.join(projectRoot, 'assets/scripts/ui/CardPresentationMapper.ts')
const mapperMetaPath = `${mapperPath}.meta`
const handPath = path.join(projectRoot, 'assets/scripts/ui/HandController.ts')
const playAreaPath = path.join(projectRoot, 'assets/scripts/ui/PlayAreaController.ts')
const effectTypesPath = path.join(projectRoot, 'assets/scripts/effects/EffectTypes.ts')
const vfxSnapshotPath = path.join(projectRoot, 'assets/scripts/effects/VfxCardSnapshot.ts')

const read = filePath => fs.readFileSync(filePath, 'utf8')
const card = (suit, rank) => ({ id: `${suit}-${rank}`, suit, rank, value: 0, isLevelCard: false })

async function verifyMappings () {
  const { mapCardToPresentation } = await import(`${pathToFileURL(mapperPath).href}?regression=${Date.now()}`)
  assert.deepEqual(mapCardToPresentation(card('spade', 'A')), { rank: 'A', suit: 'spade', red: false, levelCard: false })
  assert.deepEqual(mapCardToPresentation(card('heart', 10)), { rank: '10', suit: 'heart', red: true, levelCard: false })
  assert.deepEqual(mapCardToPresentation(card('club', 'K')), { rank: 'K', suit: 'club', red: false, levelCard: false })
  assert.deepEqual(mapCardToPresentation(card('diamond', 2)), { rank: '2', suit: 'diamond', red: true, levelCard: false })
  assert.deepEqual(mapCardToPresentation(card('joker', 'Small')), { rank: 'Small', suit: 'joker', red: false, levelCard: false })
  assert.deepEqual(mapCardToPresentation(card('joker', 'Big')), { rank: 'Big', suit: 'joker', red: true, levelCard: false })
  assert.equal(mapCardToPresentation({ ...card('heart', 7), isLevelCard: true }).levelCard, true)
}

function verifyOneMappingBoundary () {
  assert.equal(fs.existsSync(mapperMetaPath), true, 'the canonical presentation mapper needs Cocos metadata')
  const mapper = read(mapperPath)
  const hand = read(handPath)
  const playArea = read(playAreaPath)
  const effects = read(effectTypesPath)
  const vfx = read(vfxSnapshotPath)

  assert.match(mapper, /suit:\s*ClassicCardSuit/, 'the canonical presentation must expose semantic suit ids')
  assert.doesNotMatch(mapper, /[\u2660\u2663\u2665\u2666]/u, 'the canonical presentation must not emit host-font suit glyphs')

  for (const [name, source] of [['hand', hand], ['play area', playArea]]) {
    assert.match(source, /import \{ mapCardToPresentation \} from '\.\/CardPresentationMapper'/, `${name} must import the canonical mapper`)
    assert.match(source, /\.\.\.mapCardToPresentation\(card\)/, `${name} must bind the canonical presentation`)
    assert.doesNotMatch(source, /card\.suit === 'joker' \?/, `${name} must not retain a private joker presentation path`)
  }
  assert.match(effects, /export \{ mapCardToPresentation as cardDisplay \} from '\.\.\/ui\/CardPresentationMapper'/, 'VFX compatibility must alias the canonical mapper')
  assert.doesNotMatch(effects, /card\.suit ===/, 'EffectTypes must not retain a second card-face mapper')
  assert.match(vfx, /resolveClassicCardPlan\(cardDisplay\(card\)\)/, 'VFX snapshots must consume the canonical mapper alias')
}

Promise.resolve()
  .then(verifyMappings)
  .then(verifyOneMappingBoundary)
  .then(() => console.log('card presentation mapper regression checks passed'))
  .catch(error => {
    console.error(error)
    process.exitCode = 1
  })
