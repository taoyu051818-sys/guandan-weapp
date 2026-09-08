const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const projectRoot = path.resolve(__dirname, '..')
const { loadTypeScript } = require('./support/typescript.cjs')
const ts = loadTypeScript()
const read = filePath => fs.readFileSync(filePath, 'utf8')
const quickChatPolicyPath = path.join(projectRoot, 'assets/scripts/ui/QuickChatPolicy.ts')
const chatControllerPath = path.join(projectRoot, 'assets/scripts/ui/ChatController.ts')
const gameSceneSource = read(path.join(projectRoot, 'assets/scripts/scenes/GameScene.ts'))
const tableOverlaySource = read(path.join(projectRoot, 'assets/scripts/scenes/TableOverlayController.ts'))
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

const quickChat = loadPureTs(quickChatPolicyPath)
const networkChatSection = tableOverlaySource.slice(tableOverlaySource.indexOf('private readonly applyNetworkChat'), tableOverlaySource.indexOf('private readonly handleChatChanged'))
assert.match(networkChatSection, /this\.dependencies\.chat\.isBlocked\(viewerId, packet\.playerId\)/, 'network voice playback must consult the local sender block')
assert.match(networkChatSection, /decision\.accepted && !blocked/, 'a blocked sender must not play quick-chat voice audio')
const quickChatPanelSection = tableOverlaySource.slice(tableOverlaySource.indexOf('public toggleQuickChatPanel'), tableOverlaySource.indexOf('private createModalShade'))
assert.match(gameSceneSource, /onChat: \(\) => this\.tableOverlays\?\.toggleQuickChatPanel\(\)/, 'the table HUD quick-chat action must open the extracted overlay panel')
assert.match(quickChatPanelSection, /QUICK_CHAT_PHRASES\.forEach[\s\S]*Node\.EventType\.TOUCH_END[\s\S]*this\.sendQuickChat\(phrase\)/, 'each visible phrase button must dispatch its selected phrase')
assert.match(quickChatPanelSection, /if \(this\.dependencies\.isMultiplayer\(\)\)[\s\S]*this\.dependencies\.lobby\.chat\(phrase\.text\)[\s\S]*return[\s\S]*this\.dependencies\.chat\.send\(humanId, phrase\)/, 'multiplayer chat must await the authoritative echo while local games use ChatController directly')
assert.match(tableOverlaySource, /label\.string = this\.dependencies\.chat\.get\(id\)\?\.message \?\? ''[\s\S]*label\.node\.active = this\.tableVisible && Boolean\(label\.string\)/, 'all four seat bubbles must render accepted local or echoed phrases above the hand')

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

console.log('quick chat regression passed')
