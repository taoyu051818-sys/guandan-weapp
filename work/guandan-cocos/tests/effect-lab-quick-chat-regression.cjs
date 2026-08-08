const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const projectRoot = path.resolve(__dirname, '..')
const compilerPath = '/Applications/Cocos/Creator/3.8.8/CocosCreator.app/Contents/Resources/resources/3d/engine/node_modules/typescript/lib/typescript.js'
const effectLabPath = path.join(projectRoot, 'assets/scripts/development/EffectLab.ts')
const fixedMatchPath = path.join(projectRoot, 'assets/scripts/development/FixedMatchFixtures.ts')
const quickChatPolicyPath = path.join(projectRoot, 'assets/scripts/ui/QuickChatPolicy.ts')
const chatControllerPath = path.join(projectRoot, 'assets/scripts/ui/ChatController.ts')
const effectResolverPath = path.join(projectRoot, 'assets/scripts/effects/EffectProfileResolver.ts')
const audioProfilesPath = path.join(projectRoot, 'assets/scripts/audio/AudioProfiles.ts')
const playVoiceProfilesPath = path.join(projectRoot, 'assets/scripts/audio/PlayVoiceProfiles.ts')
const gameManagerPath = path.join(projectRoot, 'assets/scripts/game/GameManager.ts')
const gameScenePath = path.join(projectRoot, 'assets/scripts/scenes/GameScene.ts')
const frontPagePath = path.join(projectRoot, 'assets/scripts/scenes/FrontPageController.ts')
const effectLabPageDomainPath = path.join(projectRoot, 'assets/scripts/scenes/front-pages/EffectLabPageDomain.ts')

assert.equal(fs.existsSync(compilerPath), true, 'Cocos Creator TypeScript compiler is required')
const ts = require(compilerPath)
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

for (const filePath of [effectLabPath, fixedMatchPath, quickChatPolicyPath]) {
  assert.equal(fs.existsSync(filePath), true, `missing ${filePath}`)
  assert.equal(fs.existsSync(`${filePath}.meta`), true, `missing Cocos metadata for ${filePath}`)
}

const PlayType = {
  Single: 'Single', Pair: 'Pair', Triple: 'Triple', Straight: 'Straight', TripleWithPair: 'TripleWithPair',
  Tube: 'Tube', Plate: 'Plate', StraightFlush: 'StraightFlush', Bomb: 'Bomb', Rocket: 'Rocket', Pass: 'Pass',
}
const ranks = [2, 3, 4, 5, 6, 7, 8, 9, 10, 'J', 'Q', 'K', 'A']
const rankValue = rank => ({ J: 11, Q: 12, K: 13, A: 14 }[rank] ?? Number(rank))
const makeDeck = level => {
  const cards = []
  for (let deck = 1; deck <= 2; deck += 1) {
    for (const suit of ['spade', 'heart', 'club', 'diamond']) {
      for (const rank of ranks) cards.push({
        id: `${deck}-${suit}-${rank}`,
        suit,
        rank,
        value: rank === level ? 15 : rankValue(rank),
        isLevelCard: rank === level,
        ...(suit === 'heart' && rank === level ? { isRedJoker: true } : {}),
      })
    }
    cards.push({ id: `${deck}-joker-small`, suit: 'joker', rank: 'Small', value: 16, isLevelCard: false })
    cards.push({ id: `${deck}-joker-big`, suit: 'joker', rank: 'Big', value: 17, isLevelCard: false })
  }
  return cards
}
const createGame = (level = 2, dealer = 'p1') => {
  const deck = makeDeck(level)
  const ids = ['p1', 'p2', 'p3', 'p4']
  return {
    currentLevel: level,
    currentTurn: dealer,
    turnOrder: ids,
    playArea: [],
    lastValidPlay: null,
    finishedPlayers: [],
    players: Object.fromEntries(ids.map((id, index) => [id, {
      id,
      name: id,
      isAI: id !== 'p1',
      team: id === 'p1' || id === 'p3' ? 'teamA' : 'teamB',
      role: 'normal',
      hand: deck.slice(index * 27, index * 27 + 27),
    }])),
  }
}
const core = { PlayType, createGame }
const audio = loadPureTs(audioProfilesPath)
const voices = loadPureTs(playVoiceProfilesPath, { '../core/generated': core })
const effects = loadPureTs(effectResolverPath, { '../core/generated': core })
const fixedMatches = loadPureTs(fixedMatchPath, { '../core/generated': core })
const quickChat = loadPureTs(quickChatPolicyPath)
const effectLabDependencies = {
  '../core/generated': core,
  '../audio/AudioProfiles': audio,
  '../audio/PlayVoiceProfiles': voices,
  '../effects/EffectProfileResolver': effects,
  '../ui/QuickChatPolicy': quickChat,
  './FixedMatchFixtures': fixedMatches,
}

const source = read(effectLabPath)
const gameManagerSource = read(gameManagerPath)
const gameSceneSource = read(gameScenePath)
const frontPageSource = read(frontPagePath)
const effectLabPageDomainSource = read(effectLabPageDomainPath)
assert.doesNotMatch(source, /location|URLSearchParams|searchParams|localStorage|sessionStorage/i, 'the effect lab must not expose a URL or persisted production bypass')
assert.match(source, /import \{ DEBUG, DEV \} from 'cc\/env'/, 'availability must use Cocos compile-time development/debug flags')
assert.doesNotMatch(source, /export class DevelopmentEffectLab/, 'the ungated implementation must not be publicly constructible')
assert.match(gameManagerSource, /applyDevelopmentFixtureState/, 'fixed matches must enter through an explicit development adapter')
assert.match(gameManagerSource, /if \(!this\.developmentFixtureActive\)[\s\S]*recordRound/, 'fixed-match settlement must not write player progression')
assert.doesNotMatch(gameSceneSource, /document\.createElement|guandan-effect-lab-bridge|guandan-effect-lab-more|guandan-effect-lab-menu/, 'EffectLab must not install a visible DOM control over the lobby or table')
assert.match(frontPageSource, /private showMoreMenu \(\): void[\s\S]*listEffectLabFixtures\(\)\.length\) entries\.push\(\['牌桌特效测试', \(\) => this\.openEffectLabTable\(\)\]\)/, 'EffectLab must be a module inside the existing More page')
assert.match(frontPageSource, /public openEffectLabTable \(\): void \{ this\.effectLabPage\.openTable\(\) \}/, 'the scene-facing compatibility method must delegate to the page domain')
const openEffectLabTableSource = effectLabPageDomainSource.slice(effectLabPageDomainSource.indexOf('public openTable'), effectLabPageDomainSource.indexOf('public show'))
assert.match(openEffectLabTableSource, /fixture\.id === 'match-opening'/, 'the table entry must reject builds without the deterministic opening fixture')
assert.match(openEffectLabTableSource, /previewFixture\('match-opening', 'full'\)/, 'opening the EffectLab must start the deterministic table fixture first')
assert.match(openEffectLabTableSource, /scheduleOnce\([\s\S]*this\.show\(0\)/, 'the EffectLab drawer must mount only after the fixed table has been entered')
assert.ok(openEffectLabTableSource.indexOf("previewFixture('match-opening', 'full')") < openEffectLabTableSource.indexOf('this.show(0)'), 'the table fixture must be requested before the drawer')
const effectLabDrawerSource = effectLabPageDomainSource.slice(effectLabPageDomainSource.indexOf('public show'), effectLabPageDomainSource.indexOf('public reflow'))
assert.match(effectLabDrawerSource, /router\.open\('effect-lab'\)[\s\S]*牌桌特效测试[\s\S]*结束测试[\s\S]*showMenu/, 'the EffectLab controls must be a table drawer with an explicit exit')
assert.doesNotMatch(effectLabDrawerSource, /返回更多功能/, 'the table drawer must not masquerade as a standalone More subpage')
assert.match(effectLabDrawerSource, /ui\.panel\('EffectLabDrawer'[\s\S]*drawer\.addComponent\(BlockInputEvents\)/, 'the table drawer must visually isolate its controls and block touches from reaching the table HUD')
assert.match(effectLabPageDomainSource, /public reflow[\s\S]*router\.current === 'effect-lab'[\s\S]*this\.show\(this\.page\)/, 'the table drawer must reflow after viewport and safe-area changes')
assert.match(frontPageSource, /router\.current === 'effect-lab'\) this\.effectLabPage\.reflow\(\)/, 'the front-page resize route must delegate drawer reflow')
const networkChatSection = gameSceneSource.slice(gameSceneSource.indexOf('private applyNetworkChat'), gameSceneSource.indexOf('private ensureFallbackUi'))
assert.match(networkChatSection, /this\.chat\?\.isBlocked\(viewerId, packet\.playerId\)/, 'network voice playback must consult the local sender block')
assert.match(networkChatSection, /decision\?\.accepted && !blocked/, 'a blocked sender must not play quick-chat voice audio')
const quickChatPanelSection = gameSceneSource.slice(gameSceneSource.indexOf('private toggleChatPanel'), gameSceneSource.indexOf('private arrangeTableHudHand'))
assert.match(gameSceneSource, /onChat: \(\) => this\.toggleChatPanel\(\)/, 'the table HUD quick-chat action must open the scene panel')
assert.match(quickChatPanelSection, /QUICK_CHAT_PHRASES\.forEach[\s\S]*Node\.EventType\.TOUCH_END[\s\S]*this\.sendQuickChat\(phrase\)/, 'each visible phrase button must dispatch its selected phrase')
assert.match(quickChatPanelSection, /if \(this\.session\?\.snapshot\.isMultiplayer\)[\s\S]*this\.lobby\?\.chat\(phrase\.text\)[\s\S]*return[\s\S]*this\.chat\?\.send\(humanId, phrase\)/, 'multiplayer chat must await the authoritative echo while local games use ChatController directly')
assert.match(gameSceneSource, /this\.ownChatLabel\.string = this\.chat\?\.get\(humanId\)\?\.message \?\? ''[\s\S]*this\.ownChatLabel\.node\.active = Boolean\(this\.ownChatLabel\.string\)/, 'an accepted local or echoed phrase must render visibly for the sending player')

const productionLabModule = loadPureTs(effectLabPath, { ...effectLabDependencies, 'cc/env': { DEV: false, DEBUG: false } })
assert.equal(productionLabModule.isEffectLabAvailable(), false)
assert.equal(productionLabModule.createEffectLab(), null, 'production builds must not create a lab instance')

const triggered = []
const developmentLabModule = loadPureTs(effectLabPath, { ...effectLabDependencies, 'cc/env': { DEV: true, DEBUG: false } })
const lab = developmentLabModule.createEffectLab({
  playAction: preview => triggered.push(['play', preview.fixture.id]),
  playAudio: event => triggered.push(['audio', event]),
  playCountdown: remaining => triggered.push(['countdown', remaining]),
  playTribute: fixture => triggered.push(['tribute', fixture.phase]),
  playSettlement: fixture => triggered.push(['settlement', fixture.won, fixture.levelUp]),
  startFixedMatch: (_state, fixture) => triggered.push(['match', fixture.id]),
  playQuickChat: phrase => triggered.push(['quick-chat', phrase.id]),
  playFlow: fixture => triggered.push(['flow', fixture.kind]),
  playSequence: fixture => triggered.push(['sequence', fixture.mode]),
  runDiagnostic: fixture => triggered.push(['diagnostic', fixture.check]),
})
assert.ok(lab)
const debugBuildLabModule = loadPureTs(effectLabPath, { ...effectLabDependencies, 'cc/env': { DEV: false, DEBUG: true } })
assert.ok(debugBuildLabModule.createEffectLab(), 'debug Web builds must expose the lab for runtime acceptance')
const fixtures = lab.list()
assert.equal(Object.isFrozen(fixtures), true)
assert.equal(new Set(fixtures.map(fixture => fixture.id)).size, fixtures.length, 'fixture ids must be unique')
assert.deepEqual(new Set(fixtures.map(fixture => fixture.kind)), new Set(['match', 'play', 'sequence', 'diagnostic']), 'the runtime lab must expose only the approved fixture kinds')

const matchPreviews = lab.list('match').map(fixture => lab.inspect(fixture.id))
assert.deepEqual(matchPreviews.map(preview => preview.fixture.id), ['match-opening', 'match-wildcard-bomb', 'match-follow-bomb'])
for (const preview of matchPreviews) {
  const stateCards = Object.values(preview.matchState.players)
    .flatMap(player => player.hand)
    .concat(preview.matchState.playArea.flatMap(action => action.cards))
  assert.equal(stateCards.length, 108, `${preview.fixture.id} must account for both complete decks`)
  assert.equal(new Set(stateCards.map(card => card.id)).size, 108, `${preview.fixture.id} must not duplicate a physical card`)
  assert.equal(preview.matchState.currentTurn, 'p1')
}
assert.equal(lab.inspect('match-wildcard-bomb').matchState.players.p1.hand.some(card => card.isRedJoker), true)
assert.equal(lab.inspect('match-wildcard-bomb').matchState.players.p1.hand.filter(card => card.rank === 8).length >= 4, true)
assert.equal(lab.inspect('match-follow-bomb').matchState.lastValidPlay.type, PlayType.Bomb)
lab.inspect('match-opening').matchState.players.p1.hand[0].id = 'mutated-fixed-match'
assert.notEqual(lab.inspect('match-opening').matchState.players.p1.hand[0].id, 'mutated-fixed-match', 'fixed match inspection must create fresh state')

const playPreviews = lab.list('play').map(fixture => lab.inspect(fixture.id))
const approvedBombFixtures = new Map([
  ['play-bomb-small', { cards: 4, key: 'bomb-small' }],
  ['play-six-bomb', { cards: 6, key: 'six-bomb' }],
  ['play-bomb-medium', { cards: 7, key: 'bomb-medium' }],
  ['play-bomb-large', { cards: 8, key: 'bomb-large' }],
])
assert.deepEqual(playPreviews.map(preview => preview.fixture.id), [...approvedBombFixtures.keys()], 'the play drawer must contain exactly the four approved Bomb fixtures')
assert.equal(playPreviews.every(preview => preview.action.type === PlayType.Bomb), true, 'non-Bomb play types must not return to the lab')
assert.equal(playPreviews.every(preview => preview.effectProfile), true, 'every approved Bomb fixture must resolve an EffectController profile')
for (const preview of playPreviews) {
  const expected = approvedBombFixtures.get(preview.fixture.id)
  assert.ok(expected, `${preview.fixture.id} must be an approved Bomb fixture`)
  assert.equal(preview.action.cards.length, expected.cards, `${preview.fixture.id} must use the approved Bomb card count`)
  assert.equal(preview.action.resolution.length, expected.cards, `${preview.fixture.id} resolution length must match its cards`)
  assert.equal(preview.effectProfile.key, expected.key, `${preview.fixture.id} must resolve to its dedicated Bomb renderer key`)
  assert.match(preview.fixture.label, /^商业保留 ·/, `${preview.fixture.id} must be marked as a retained commercial effect`)
  assert.match(preview.fixture.description, /正式牌局/, `${preview.fixture.id} must describe its live-match status`)
  assert.equal(new Set(preview.action.cards.map(card => card.id)).size, preview.action.cards.length, `${preview.fixture.id} card ids must be unique`)
  const physicalCopies = new Map()
  for (const card of preview.action.cards) {
    const key = `${card.suit}:${card.rank}`
    physicalCopies.set(key, (physicalCopies.get(key) ?? 0) + 1)
  }
  assert.equal([...physicalCopies.values()].every(count => count <= 2), true, `${preview.fixture.id} must fit a two-deck fixture`)
}
const mutablePreview = lab.inspect('play-bomb-small')
mutablePreview.action.cards[0].id = 'mutated-by-test'
assert.notEqual(lab.inspect('play-bomb-small').action.cards[0].id, 'mutated-by-test', 'each inspection must return fresh fixture data')
assert.equal(Object.isFrozen(mutablePreview.effectProfile), true)
assert.equal(Object.isFrozen(mutablePreview.effectProfile.color), true, 'fixture inspection must not expose resolver-owned mutable profiles')

for (const retiredKind of ['flow', 'audio', 'quick-chat', 'countdown', 'tribute', 'settlement']) {
  assert.deepEqual(lab.list(retiredKind), [], `${retiredKind} fixtures must stay unloaded from the runtime lab`)
}

const retiredFixtureIds = [
  'play-single', 'play-pair', 'play-triple', 'play-straight', 'play-triple-with-pair', 'play-tube', 'play-plate',
  'play-straight-flush', 'play-king-bomb', 'play-pass', 'play-wildcard',
  'flow-deal', 'flow-grade', 'flow-trustee', 'flow-trustee-off', 'flow-chat-left', 'flow-chat-right',
  'flow-tribute', 'flow-return-tribute', 'flow-anti-tribute', 'flow-player-finished', 'flow-upgrade',
  'flow-victory', 'flow-defeat', 'flow-match-success',
  'sequence-rapid-plays', 'sequence-major-replace', 'sequence-style-matrix',
  ...audio.AUDIO_EVENTS.map(event => `audio-${event}`),
  ...quickChat.QUICK_CHAT_PHRASES.map(phrase => `quick-chat-${phrase.id}`),
  ...[0, 1, 2, 3, 4, 5].map(remaining => `countdown-${remaining}`),
  'tribute-give', 'tribute-return', 'tribute-anti',
  'settlement-victory-up-1', 'settlement-victory-up-3', 'settlement-defeat',
]
for (const fixtureId of retiredFixtureIds) {
  assert.equal(lab.inspect(fixtureId), null, `${fixtureId} must stay unloaded`)
  assert.equal(lab.trigger(fixtureId), null, `${fixtureId} must not dispatch through the lab`)
}

const sequencePreviews = lab.list('sequence').map(fixture => lab.inspect(fixture.id))
assert.deepEqual(sequencePreviews.map(preview => preview.fixture.id), ['sequence-quality-matrix', 'sequence-seat-matrix'], 'only approved Bomb QA sequences may remain')
assert.deepEqual(sequencePreviews.map(preview => preview.sequence.mode), ['quality-matrix', 'seat-matrix'])
for (const preview of sequencePreviews) {
  assert.equal(preview.sequence.steps.every(step => approvedBombFixtures.has(step.fixtureId)), true, `${preview.fixture.id} must reference only approved Bomb fixtures`)
}
assert.deepEqual(lab.inspect('sequence-quality-matrix').sequence.steps.map(step => step.quality), ['full', 'reduced', 'off'])
assert.equal(lab.inspect('sequence-seat-matrix').sequence.steps.length, 4, 'projectile QA must cover all four seat origins')
assert.equal(lab.inspect('diagnostic-runtime-assets').diagnostic.check, 'runtime-assets')
assert.equal(lab.inspect('play-bomb-small', 'reduced').quality, 'reduced')
assert.equal(lab.inspect('missing-fixture'), null)

lab.trigger('match-follow-bomb')
lab.trigger('play-six-bomb')
lab.trigger('sequence-quality-matrix')
lab.trigger('diagnostic-runtime-assets')
assert.deepEqual(triggered, [
  ['match', 'match-follow-bomb'],
  ['play', 'play-six-bomb'],
  ['sequence', 'quality-matrix'],
  ['diagnostic', 'runtime-assets'],
])

assert.equal(quickChat.QUICK_CHAT_PHRASES.length, 6)
assert.equal(new Set(quickChat.QUICK_CHAT_PHRASES.map(phrase => phrase.id)).size, 6)
assert.equal(new Set(quickChat.QUICK_CHAT_PHRASES.map(phrase => phrase.text)).size, 6)
assert.doesNotMatch(quickChat.QUICK_CHAT_PHRASES.map(phrase => phrase.text).join('|'), /MM|GG|底裤|输穿|嘲讽|辱骂/i, 'audited phrases must stay neutral')
assert.deepEqual(
  quickChat.QUICK_CHAT_PHRASES.map(phrase => [phrase.id, phrase.voice]),
  [
    ['hurry', 'chat_hurry'],
    ['nice-play', 'niuma/chat_nice_play'],
    ['teamwork', 'chat_teamwork'],
    ['cheer', 'chat_cheer'],
    ['thanks', 'chat_thanks'],
    ['play-again', 'chat_play_again'],
  ],
  'only the phrase with exact verified copy/audio agreement may use an imported NiuMa voice',
)
assert.equal(quickChat.QUICK_CHAT_PHRASES.find(phrase => phrase.id === 'nice-play').text, '你的牌打得太好啦')
assert.equal(quickChat.QUICK_CHAT_PHRASES.some(phrase => phrase.text === '这手打得漂亮'), false, 'the obsolete approximate copy must leave the whitelist')
assert.equal(Object.isFrozen(quickChat.QUICK_CHAT_PHRASES), true)
assert.equal(quickChat.QUICK_CHAT_PHRASES.every(Object.isFrozen), true)

const policy = new quickChat.QuickChatPolicy({ perUserIntervalMs: 1000, repeatCooldownMs: 5000, bubbleTtlMs: 2500 })
const first = policy.submit('p1', 'hurry', 0)
assert.equal(first.accepted, true)
assert.equal(first.bubble.message, '请尽快出牌')
assert.deepEqual(policy.submit('p1', 'nice-play', 500), { accepted: false, reason: 'user-throttled', retryAfterMs: 500 })
assert.equal(policy.submit('p2', 'nice-play', 500).accepted, true, 'per-user throttles must not block another seat')
assert.equal(policy.getBubble('p2', 500).message, '你的牌打得太好啦', 'the visible/network copy must exactly match the imported voice')
assert.deepEqual(policy.submit('p1', 'hurry', 1000), { accepted: false, reason: 'repeat-cooldown', retryAfterMs: 4000 })
assert.equal(policy.submit('p1', 'nice-play', 1000).accepted, true, 'different content may pass after the per-user interval')
assert.deepEqual(policy.submit('p3', 'arbitrary network text', 1000), { accepted: false, reason: 'unknown-phrase', retryAfterMs: 0 })

const p2Bubble = policy.getBubble('p2', 1000)
policy.block('p4', 'p2')
assert.equal(policy.isBlocked('p4', 'p2'), true)
assert.equal(policy.getVisibleBubble('p4', 'p2', 1000), undefined, 'blocked sender must be hidden only for the target viewer')
assert.equal(policy.getBubble('p2', 1000), p2Bubble, 'blocking must not mutate message/network state')
assert.equal(policy.getVisibleBubble('p3', 'p2', 1000), p2Bubble, 'other viewers must remain unaffected')
policy.unblock('p4', 'p2')
assert.equal(policy.getVisibleBubble('p4', 'p2', 1000), p2Bubble, 'unblocking restores an unexpired bubble')
assert.deepEqual(policy.expire(2999), [], 'unexpired bubbles must remain visible')
assert.equal(policy.getBubble('p2', 2999), p2Bubble)
assert.deepEqual(policy.expire(3000), ['p2'])
assert.deepEqual(policy.expire(3500), ['p1'], 'replacement bubbles must receive their own fresh expiry')

const chatControllerSource = read(chatControllerPath)
assert.match(chatControllerSource, /private readonly policy = new QuickChatPolicy\(\)/, 'the runtime controller must delegate to the pure policy')
assert.match(chatControllerSource, /public block \(viewerId: PlayerId, senderId: PlayerId\)/)
assert.match(chatControllerSource, /public unblock \(viewerId: PlayerId, senderId: PlayerId\)/)
assert.match(chatControllerSource, /this\.policy\.expire\(\)/, 'seat bubbles must expire through the policy')
assert.doesNotMatch(read(quickChatPolicyPath), /from\s+['"].*(network|LobbyController|GameManager)/, 'presentation blocking must stay outside rules and networking')

const scheduledChatClears = []
class MockComponent {
  scheduleOnce (callback, delaySeconds) { scheduledChatClears.push({ callback, delaySeconds }) }
}
class MockEventTarget {
  constructor () { this.listeners = new Map() }
  on (type, listener) {
    const listeners = this.listeners.get(type) ?? []
    listeners.push(listener)
    this.listeners.set(type, listeners)
  }
  emit (type, payload) { for (const listener of this.listeners.get(type) ?? []) listener(payload) }
}
const chatRuntime = loadPureTs(chatControllerPath, {
  cc: { _decorator: { ccclass: () => value => value }, Component: MockComponent, EventTarget: MockEventTarget },
  './QuickChatPolicy': quickChat,
})
const controller = new chatRuntime.ChatController()
const emittedChats = []
controller.events.on('guandan:chat', chat => emittedChats.push(chat))
const localDecision = controller.send('p1', quickChat.QUICK_CHAT_PHRASES[4])
assert.equal(localDecision.accepted, true, 'clicking a local phrase must be accepted by ChatController')
assert.equal(controller.get('p1').message, '谢谢', 'the local sender bubble must be available to GameScene rendering')
assert.deepEqual(emittedChats, [localDecision.bubble], 'accepted local chat must request an immediate scene render')
assert.equal(scheduledChatClears.length, 1, 'accepted chat must schedule its visible bubble expiry')

console.log('effect lab and quick chat regression passed')
