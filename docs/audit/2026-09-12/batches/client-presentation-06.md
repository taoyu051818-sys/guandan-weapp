# 客户端牌面与呈现审计 · client-presentation-06

审计日期：2026-09-12。审阅人：audit_client_state。仓库：`/Users/mac/Documents/Codex/2026-08-02/wo-yi`。HEAD：`1d58999dc6e5455b049e1643660bbba3deee1406`。

结论：本批完整审阅 6 个 pending 文件、1036 行，新增确认问题 0、未证实候选 0。没有将“回归通过”当成视觉或全库健康证明。原有 5 处 dirty 保留，尤其 TablePhasePresenter.ts 按当前用户修改版本审阅，未编辑。仅新增本报告及同名 JSON；不修改产品/测试、全局清单、STATUS 或生成产物，不构建、提交、部署或访问线上数据。

## 范围与方法

先重读审计 README / STATUS / coverage；起始覆盖 156/629，以下六项均 pending。完整 SHA-256 与逐文件 notes 在同名 JSON；本次末尾再次核对与起始哈希相同。

| 完整审阅文件（均在 work/guandan-cocos/assets/scripts/） | 行数 | 重点结果 |
| --- | ---: | --- |
| ui/CardView.ts | 503 | bind token/plan key/销毁门禁、四层复用、级标/灰态/锁态、输入绑定、入场屏障 |
| ui/CardPresentationMapper.ts | 23 | 标准牌面唯一转换，大小王不挂级标 |
| ui/CardSkinResolver.ts | 109 | 54 合法面到 37 组件，正常牌与王复用清空多余层 |
| scenes/TableHudPresenter.ts | 244 | avatar key、资源 generation、dispose/cancel，玩家相对与观战/公开记牌投影 |
| scenes/TablePhasePresenter.ts | 110 | 贡还/托管/observer/pending 权限、准备/终场 CTA、overlay 清理 |
| scenes/TableSnapshotPresenter.ts | 47 | 四座队伍相对级数/胜负、名次与余牌公开、模式/隐藏积分文案 |

已完整读取 ui-ux-pro-max 技能，并自行查询。最初两次较宽的 animation interruption 查询未直接命中；随后窄查 `python3 /Users/mac/.codex/skills/ui-ux-pro-max/scripts/search.py "rapid animation interrupted" --domain ux`，核验 Cancellable State Transitions（Web）：取消/替换运动并直接落实语义状态，正确性不应依赖结束回调。仅迁移这一状态原则到现有 Cocos 契约，不据 Web 平台条款强造问题，不建立新设计系统或改美术。

辅助读取 ClassicCardFrameStore、ClassicCardGeometry 与相关测试、TableGameHud 与 seat/timer owner、ProfileAvatar、GameScene、TableMatchCoordinator 及 settlement 展示调用链等，不计这些文件的完整覆盖。

## 核对结果与边界

- CardView.ts:108–117 每次 bind 在快路径前递增 requestId；268–289 先隐藏未就绪新面，并同时检查 requestId、node.isValid 与当前 plan key。292–304 明确把王不使用的 corner 层清成 null，并切换 center 尺寸，因此普通牌/王复用不沿用旧层。96–106 销毁使旧 artwork request 失效。禁用只解除输入/完成入场，仍允许当前正确牌面加载完成，不误称禁用也取消了素材请求。
- CardView.ts:317–353 的 epoch 防止旧动画结束触发新屏障；替换、立即完成、点按、disable、destroy 都直接把透明度/位置/缩放落到最终状态且 resolve。外层 BombReactionRoot 不被这一收尾重置。级标、完整脸选择灰层与覆盖条锁标相互独立（367–429）。已知旧 touchend 选择失效仍归 CI-05-001，不重复计为本批问题。
- TableHudPresenter.ts:114–121 同时校验头像 key 与 generation；174–183、197–243 取消两类资源句柄并挡住销毁/上一代异步结果。ProfileAvatar 当前实际来源捕获请求失败为 null，ClassicCardFrameStore 捕获失败为 null，未把任意会 reject 的伪造注入当成当前未处理异常。实际 GameScene.ts:430–454 创建一次 Presenter，381–382 销毁后清空引用；探针中同实例 dispose→mount 是验证 generation 隔离的合成时序，**不证明生产重挂入口或同实例头像重取契约**（ownAvatarKey 在 dispose 不归零这一点未计缺陷）。
- TablePhasePresenter.ts:35–48、52–95 同步决定 overlay、贡还/准备/托管/观战按钮状态；入场 tween 仅设置装饰 scale，没有靠动画结束才切换权限或显示。TableMatchCoordinator.ts:129–136 只在 phase 变化时触发该入场。当前未证实旧装饰 tween 导致错误语义状态；不将未在 Cocos 实测的帧间动画/销毁顺序作“无问题”保证。
- TableSnapshotPresenter 从实际 player.team 推导相对队伍，四座回归通过；HUD 公共记牌只减当前可见手牌与公开 playArea，隐藏对手只用长度参与局势推断。未添加跨桌来源归属的第二个问题（CS-01-001 已记录）。

## 已执行的安全验证

先核对脚本与 TypeScript loader，再运行下列 7 项；全部退出 0：

```sh
cd /Users/mac/Documents/Codex/2026-08-02/wo-yi/work/guandan-cocos
node tests/card-skin-regression.cjs
node tests/card-presentation-mapper-regression.cjs
node tests/table-phase-presenter-regression.cjs
node tests/table-snapshot-presenter-regression.cjs
node tests/table-game-hud-regression.cjs
node tests/effect-controller-lifecycle-regression.cjs
node tests/hand-touch-coordinates-regression.cjs
```

牌面回归实际检查 54 面/37 PNG、映射/几何/缓存边界和许可引用，并读取**已有** Web build 资源 config；可选本机上游背景图仅作只读 hash 对照。没有执行构建或上传，已有构建清单通过不代表当前 dirty 已进入交付包。

### 可复制内存探针

以下脚本仅从当前源码转译到内存并断言；不写任何文件、不访问真实网络/用户数据。实际被测模块是 CardView、Mapper、Resolver、Geometry、HUD/Phase/Snapshot Presenter。Cocos 节点/Graphics/Sprite/tween、资源与头像 Promise、HUD view/settlement-view 与无关 projector 均为记录型存根。因此验证的是控制流、绘制指令与资源赋值，不是 GPU 像素、Cocos 真实调度、对象释放、真机触摸或视觉验收。

覆盖：54 面 × 2 级牌标志 × 2 选择 × 2 锁定 × 2 覆盖形态 = 864 组；异面、cached 快路径、同面不同 ID 和销毁共 4 类迟到响应；失败重绑重试；5 个入场 completion；头像 A/B 乱序与 observer 清空；销毁/新 generation 的资源门禁及取消；阶段 overlay 清理与终场 fallback。

```sh
cd /Users/mac/Documents/Codex/2026-08-02/wo-yi
node <<'NODE'
const assert = require('node:assert/strict')
const path = require('node:path')
const repo = process.cwd()
const base = path.join(repo, 'work/guandan-cocos')
const { loadTs } = require(path.join(base, 'tests/support/load-typescript-module.cjs'))
const source = name => path.join(base, 'assets/scripts', name + '.ts')
const flush = async () => { for (let i = 0; i < 8; i++) await Promise.resolve() }
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r }); return { promise, resolve } }
class Vec3 {
  constructor (x = 0, y = 0, z = 0) { Object.assign(this, { x, y, z }) }
  clone () { return new Vec3(this.x, this.y, this.z) }
}
Vec3.ZERO = new Vec3(); Vec3.ONE = new Vec3(1, 1, 1)
class Vec2 { constructor (x = 0, y = 0) { Object.assign(this, { x, y }) } clone () { return new Vec2(this.x, this.y) } }
class Component {
  constructor () { this.enabledInHierarchy = true }
  getComponent (Type) { return this.node.getComponent(Type) }
  addComponent (Type) { return this.node.addComponent(Type) }
}
class Node {
  static EventType = { TOUCH_START: 'start', TOUCH_MOVE: 'move', TOUCH_END: 'end', TOUCH_CANCEL: 'cancel' }
  constructor (name = '') {
    Object.assign(this, { name, isValid: true, active: true, children: [], components: [], handlers: new Map(), position: Vec3.ZERO, scale: Vec3.ONE })
  }
  set parent (parent) { this._parent = parent; parent?.children.push(this) }
  get parent () { return this._parent }
  get activeInHierarchy () { return this.active && this.isValid && (!this.parent || this.parent.activeInHierarchy) }
  get worldPosition () { return this.position }
  setPosition (value) { this.position = value }
  setScale (x, y, z) { this.scale = typeof x === 'number' ? new Vec3(x, y, z) : x }
  setSiblingIndex (index) { this.siblingIndex = index }
  getChildByName (name) { return this.children.find(child => child.name === name) }
  addComponent (Type) { const c = new Type(); c.node = this; this.components.push(c); return c }
  getComponent (Type) { return this.components.find(c => c instanceof Type) }
  getComponentInChildren (Type) { return this.getComponent(Type) ?? this.children.map(n => n.getComponentInChildren(Type)).find(Boolean) }
  on (event, callback, owner) { this.handlers.set(event, { callback, owner }) }
  off (event, callback, owner) { const h = this.handlers.get(event); if (h?.callback === callback && h.owner === owner) this.handlers.delete(event) }
  emit (event, data) { const h = this.handlers.get(event); h?.callback.call(h.owner, data) }
  destroy () { this.isValid = false; this.children.forEach(c => c.destroy()) }
}
class UITransform { setContentSize (width, height) { this.contentSize = { width, height } } hitTest () { return true } }
class Graphics { constructor () { this.commands = [] } clear () { this.commands = [] } }
for (const method of ['moveTo', 'lineTo', 'quadraticCurveTo', 'close', 'roundRect', 'fill', 'stroke']) {
  Graphics.prototype[method] = function (...args) { this.commands.push([method, ...args]) }
}
class Label {}
Label.Overflow = { NONE: 0 }; Label.HorizontalAlign = { CENTER: 0 }; Label.VerticalAlign = { CENTER: 0 }
class Sprite {}
Sprite.Type = { SIMPLE: 0 }; Sprite.SizeMode = { CUSTOM: 0 }
class SpriteFrame {}
class Texture2D {}
class Color { constructor (...rgba) { this.rgba = rgba } }
const tweens = []
const stops = []
function tween (target) {
  const record = { target, callback: null, patches: [] }
  const api = { delay: () => api, to: (_duration, patch) => { record.patches.push(patch); return api },
    call: callback => { record.callback = callback; return api }, start: () => { tweens.push(record); return api },
    stop: () => api }
  return api
}
const cc = { Node, Component, Vec2, Vec3, UITransform, Graphics, Color, Label, LabelOutline: class {},
  Sprite, SpriteFrame, Texture2D, UIOpacity: class {}, Tween: { stopAllByTarget: target => stops.push(target) }, tween,
  _decorator: { ccclass: () => value => value } }
const resolver = loadTs(source('ui/CardSkinResolver'))
const mapper = loadTs(source('ui/CardPresentationMapper'))
const geometry = loadTs(source('ui/ClassicCardGeometry'))
const frameCache = new Map()
const frameRequests = []
const framesFor = plan => new Map(resolver.classicCardAssetNames(plan).map(name => [name, { asset: name }]))
const cardStore = {
  getCachedClassicCardFrames: plan => frameCache.get(plan.key) ?? null,
  requestClassicCardFrames: plan => { const d = deferred(); frameRequests.push({ ...d, plan }); return d.promise },
}
const { CardView } = loadTs(source('ui/CardView'), {
  cc, './CardSkinResolver': resolver, './ClassicCardGeometry': geometry, './ClassicCardFrameStore': cardStore,
  './HandGroupBadgeView': { HandGroupBadgeView: class { render (value) { this.value = value } } },
})
const suits = ['spade', 'heart', 'club', 'diamond']
const ranks = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K']
const deck = suits.flatMap(suit => ranks.map(rank => ({ suit, rank, id: suit + rank })))
  .concat(['Small', 'Big'].map(rank => ({ suit: 'joker', rank, id: rank })))
function presentation (card, extra = {}) { return { id: card.id, ...mapper.mapCardToPresentation(card), selected: false, interactive: false, ...extra } }
function makeView () { const n = new Node('Card'); const view = n.addComponent(CardView); view.onLoad(); return view }
function face (view) { return [...view.classicSprites].map(([key, sprite]) => [key, sprite.spriteFrame?.asset ?? null]) }
function rest (view) {
  assert.equal(view.opacity.opacity, 255)
  assert.deepEqual(view.visualRoot.position, Vec3.ZERO)
  assert.deepEqual(view.visualRoot.scale, Vec3.ONE)
}

;(async () => {
  // All actual mapper/resolver faces; actual CardView bind, level/selection/lock drawing and Sprite assignments.
  const view = makeView()
  let cases = 0
  for (const card of deck) for (const levelCard of [false, true]) for (const selected of [false, true]) for (const locked of [false, true]) for (const covered of [false, true]) {
    const cardData = presentation({ ...card, isLevelCard: levelCard }, { selected, locked, groupBadge: locked ? { label: 'pair' } : undefined })
    const plan = resolver.resolveClassicCardPlan(cardData)
    frameCache.set(plan.key, framesFor(plan))
    view.configureStackHitArea(covered ? 24 : 0, 0, covered ? 3 : 1)
    view.bind(cardData)
    assert.equal(view.classicRoot.active, true)
    assert.equal(view.levelBadge.active, card.suit !== 'joker' && levelCard)
    assert.equal(view.selectionOverlay.commands.length > 0, selected)
    assert.equal(view.lockOverlay.commands.length > 0, locked)
    assert.equal(view.groupBadge?.value?.label ?? null, locked ? 'pair' : null)
    const expected = framesFor(plan)
    assert.deepEqual(face(view), [
      ['background', expected.get(plan.background).asset], ['cornerRank', plan.cornerRank ?? null],
      ['cornerSuit', plan.cornerSuit ?? null], ['center', plan.joker ?? plan.center ?? null],
    ])
    assert.deepEqual(view.classicSprites.get('center').node.getComponent(UITransform).contentSize,
      card.suit === 'joker' ? { width: 74, height: 106 } : { width: 56, height: 56 })
    if (selected) assert.deepEqual(view.selectionOverlay.commands, [['roundRect', -38, -56, 76, 112, 8], ['fill']])
    assert.equal(view.hitArea.handlers.size, 0)
    cases++
  }
  // Slow A -> B resolves B first; cached C invalidates outstanding A even on fast path.
  frameCache.clear()
  view.bind(presentation(deck[0])); const a = frameRequests.at(-1)
  view.bind(presentation(deck[13])); const b = frameRequests.at(-1)
  assert.equal(view.classicRoot.active, false)
  b.resolve(framesFor(b.plan)); await flush()
  const bFace = face(view)
  a.resolve(framesFor(a.plan)); await flush(); assert.deepEqual(face(view), bFace)
  view.bind(presentation(deck[1])); const slow = frameRequests.at(-1)
  const cachedCard = presentation(deck[52]); const cachedPlan = resolver.resolveClassicCardPlan(cachedCard)
  frameCache.set(cachedPlan.key, framesFor(cachedPlan)); view.bind(cachedCard)
  const cachedFace = face(view)
  slow.resolve(framesFor(slow.plan)); await flush(); assert.deepEqual(face(view), cachedFace)
  // Same face key with a different card identity also needs the latest bind token.
  view.bind(presentation(deck[3], { id: 'same-face-old' })); const sameOld = frameRequests.at(-1)
  view.bind(presentation(deck[3], { id: 'same-face-new', selected: true })); const sameNew = frameRequests.at(-1)
  sameOld.resolve(framesFor(sameOld.plan)); await flush(); assert.equal(view.classicRoot.active, false)
  sameNew.resolve(framesFor(sameNew.plan)); await flush(); assert.equal(view.classicRoot.active, true)
  assert.equal(view.card.id, 'same-face-new'); assert.equal(view.selectionOverlay.commands.length > 0, true)
  // Failed load does not expose stale layers; next bind retries. Invalid plan hides it.
  view.bind(presentation(deck[2])); const failure = frameRequests.at(-1)
  failure.resolve(null); await flush(); assert.equal(view.classicRoot.active, false)
  view.bind(presentation(deck[2])); const retry = frameRequests.at(-1)
  assert.notEqual(retry, failure); retry.resolve(framesFor(retry.plan)); await flush()
  assert.equal(view.classicRoot.active, true)
  view.bind({ ...presentation(deck[2]), rank: '?' }); assert.equal(view.classicRoot.active, false)
  // Real onLoad/enable/disable binding only targets the dedicated hit area.
  view.bind(presentation(deck[52], { interactive: true }))
  assert.equal(view.hitArea.handlers.size, 4); assert.equal(view.node.handlers.size, 0)
  let completed = 0
  const first = view.playEntrance().then(() => { completed++ })
  const oldDone = tweens.at(-1).callback
  const second = view.playEntrance().then(() => { completed++ })
  await flush(); assert.equal(completed, 1)
  oldDone(); await flush(); assert.equal(completed, 1); assert.equal(view.opacity.opacity, 0)
  view.finishEntranceImmediately(); await Promise.all([first, second]); assert.equal(completed, 2); rest(view)
  for (const reason of ['touch', 'disable', 'destroy']) {
    const v = makeView(); v.bind(presentation(deck[52], { interactive: true }))
    const done = v.playEntrance().then(() => { completed++ })
    const staleDone = tweens.at(-1).callback
    const bombPosition = new Vec3(5, 7, 0); v.bombReactionRoot.setPosition(bombPosition)
    if (reason === 'touch') v.handleTouchStart({ getID: () => 3, getLocation: () => new Vec2(4, 5) })
    else if (reason === 'disable') { v.enabledInHierarchy = false; v.onDisable() }
    else v.onDestroy()
    await done; rest(v); assert.equal(v.bombReactionRoot.position, bombPosition)
    if (reason !== 'touch') assert.equal(v.hitArea.handlers.size, 0)
    staleDone(); await flush()
  }
  const dead = makeView(); dead.bind(presentation(deck[5])); const pendingDead = frameRequests.at(-1)
  const deadFace = face(dead); dead.onDestroy()
  pendingDead.resolve(framesFor(pendingDead.plan)); await flush(); assert.deepEqual(face(dead), deadFace)
  assert.ok(stops.length > 0)
  console.log(JSON.stringify({ cardFaceStateCases: cases, staleFaceResponsesRejected: 4, failedLoadRetry: true, entranceBarriersResolved: completed, lateDestroyRejected: true }))

  // Actual TableHudPresenter/TableSnapshotPresenter, controlled asset and avatar promises; no Cocos/GPU.
  const assetRequests = []
  const suitRequests = []
  const huds = []
  class Hud {
    constructor () { this.calls = []; huds.push(this) }
    mount () { this.node = new Node('hud'); return this.node }
    setTurnActionNodes () {}
    setVisible (value) { this.node.active = value }
    render (value) { this.rendered = value }
    setTimerArtwork (v) { this.calls.push(['timer', v]) }
    setDefaultAvatarFrame (v) { this.calls.push(['default', v]) }
    setOwnAvatarFrame (v) { this.calls.push(['own', v]) }
    setSuitFrames (v) { this.calls.push(['suits', v]) }
    dispose () { this.node.destroy() }
  }
  const snapshotPresenter = loadTs(source('scenes/TableSnapshotPresenter'))
  const { TableHudPresenter } = loadTs(source('scenes/TableHudPresenter'), {
    cc, '../ui/TableGameHud': { TableGameHud: Hud, TABLE_GAME_HUD_COUNTER_RANKS: [...ranks, '小王', '大王'] },
    '../services/GameAssetLoader': { loadGameAsset: (asset, type, callback) => {
      const r = { asset, callback, cancelled: false }; assetRequests.push(r); return () => { r.cancelled = true }
    } },
    '../ui/ClassicCardFrameStore': { requestClassicCardFrame: asset => {
      const d = deferred(); suitRequests.push({ asset, ...d }); return d.promise
    } },
    './TableSnapshotPresenter': snapshotPresenter,
    '../ui/TableTributeInfoView': { tributeInfoText: () => '' },
    '../game/PublicStraightFlushPossibility': { publicStraightFlushPossibleSuits: () => [] },
    './DuplicateTablePresentation': { duplicateTableLabel: () => null },
    '../services/DefaultProfileFrames': { defaultProfileFrame: () => null },
  })
  let own = { id: 'owner', avatarUrl: 'A', displayName: 'Owner' }
  let lobby = { roomRole: 'player', roomId: 'room', members: ['p1', 'p2', 'p3', 'p4'], trustees: {} }
  const avatars = []
  const deps = { root: new Node('root'), actions: {}, lobbySnapshot: () => lobby, isMultiplayer: () => true,
    turnClock: () => null, ownProfile: () => own, ownAvatarFrame: () => { const d = deferred(); avatars.push(d); return d.promise } }
  const hud = new TableHudPresenter(deps)
  const mountOptions = { turnActionNodes: [], legacyLabels: [], legacySeatNodes: [] }
  hud.mount(mountOptions); const oldHud = hud.hud
  const players = Object.fromEntries(['p1', 'p2', 'p3', 'p4'].map((id, i) => [id, {
    id, team: i % 2 === 0 ? 'teamA' : 'teamB', name: id, hand: [{ id: id + '-card', rank: '3', suit: 'spade' }], isAI: false,
  }]))
  const snapshot = { phase: 'playing', actionPending: false, teamLevels: { teamA: '3', teamB: '4' },
    state: { turnOrder: Object.keys(players), players, currentTurn: 'p1', currentLevel: '3', ruleProfile: { allowA2345Straight: true }, finishedPlayers: [], playArea: [] },
    tribute: null, settlement: null }
  const hand = { availableSuits: [], selectedSuit: null, lockDecision: { kind: 'unavailable' }, restoreAvailable: false }
  hud.render(snapshot, 'p1', hand); own = { ...own, avatarUrl: 'B' }; hud.render(snapshot, 'p1', hand)
  avatars[1].resolve({ name: 'B' }); await flush()
  avatars[0].resolve({ name: 'A' }); await flush()
  assert.deepEqual(oldHud.calls.filter(c => c[0] === 'own'), [['own', { name: 'B' }]])
  lobby = { ...lobby, roomRole: 'observer' }; hud.render(snapshot, 'p1', hand); await flush()
  assert.deepEqual(oldHud.calls.at(-1), ['own', null])
  assert.equal(oldHud.rendered.handToolsVisible, false); assert.equal(oldHud.rendered.arrangeVisible, false)
  assert.equal(oldHud.rendered.trusteeVisible, false)
  assert.equal(oldHud.rendered.cardCounts['3'], 7)
  lobby = { ...lobby, roomRole: 'player' }; own = { ...own, avatarUrl: 'C' }; hud.render(snapshot, 'p1', hand)
  const lateAvatar = avatars.at(-1)
  const oldCallCount = oldHud.calls.length
  hud.dispose(); assert.ok(assetRequests.every(r => r.cancelled))
  // Synthetic reuse only exercises generation rejection, not a production remount contract.
  hud.mount(mountOptions); const newHud = hud.hud
  lateAvatar.resolve({ name: 'late-C' })
  assetRequests.slice(0, 2).forEach(r => r.callback(null, { old: r.asset }))
  suitRequests.slice(0, 4).forEach(r => r.resolve({ old: r.asset }))
  await flush(); assert.equal(oldHud.calls.length, oldCallCount); assert.deepEqual(newHud.calls, [])
  assetRequests.slice(2).forEach(r => r.callback(null, { current: r.asset }))
  suitRequests.slice(4).forEach(r => r.resolve({ current: r.asset }))
  await flush(); assert.deepEqual(newHud.calls.map(c => c[0]), ['timer', 'default', 'suits'])
  const lastCalls = newHud.calls.length; hud.dispose()
  assetRequests.slice(2).forEach(r => r.callback(null, { late: r.asset }))
  await flush(); assert.equal(newHud.calls.length, lastCalls)
  console.log(JSON.stringify({ avatarLatestWins: true, observerClearsOwnAvatar: true, oldGenerationRejected: true, currentArtworkApplied: true, disposeCancels: true }))

  // Phase orchestration with a recorded settlement-view port: clear/visibility/CTA paths, not pixels.
  const settlements = []
  const { TablePhasePresenter } = loadTs(source('scenes/TablePhasePresenter'), {
    cc, '../ui/TablePlayActionPolicy': { TablePlayActionPolicy: class { resolve () { return ['hint', 'play'] } } },
    '../ui/TableSettlementView': { TableSettlementView: class {
      clear () { settlements.push(['clear']) }
      render (overlay, content) { overlay.string = ''; settlements.push(['render', content]) }
    } },
    './MatchEndedPresentation': { projectMatchEndedPresentation: () => ({ title: 'ended', detail: 'summary' }) },
    './SettlementPresentation': { projectSettlementContent: () => ({ title: 'settled' }) },
  })
  const phaseRoot = new Node('phase')
  const overlayNode = new Node('overlay'); overlayNode.parent = phaseRoot; const overlay = overlayNode.addComponent(Label)
  const next = new Node('next'); next.parent = phaseRoot; next.addComponent(Label)
  const phase = new TablePhasePresenter({ controls: { overlayLabel: overlay, nextRound: next },
    lobby: { snapshot: {} }, session: { snapshot: { isMultiplayer: true } } })
  phase.renderPhaseOverlay({ ...snapshot, phase: 'settlement', settlement: {} }, 'p1', null, null, false)
  assert.equal(overlayNode.active, true); assert.equal(next.position.y, -172)
  phase.renderPhaseOverlay({ ...snapshot, phase: 'tribute' }, 'p1', null, null, false)
  assert.equal(overlayNode.active, false); assert.deepEqual(settlements.at(-1), ['clear'])
  phase.renderPhaseOverlay(snapshot, 'p1', null, null, true); assert.equal(overlayNode.active, false)
  phase.renderPhaseOverlay(snapshot, 'p1', null, { reason: 'single-round' }, true)
  assert.equal(overlayNode.active, true); assert.equal(overlay.string, 'ended\nsummary')
  phase.clear(); assert.deepEqual(settlements.at(-1), ['clear'])
  console.log(JSON.stringify({ settlementToTributeClears: true, playingHidesOverlay: true, terminalFallbackText: true, explicitClear: true }))
})().catch(error => { console.error(error); process.exitCode = 1 })
NODE
```

终版实际输出：

```text
{"cardFaceStateCases":864,"staleFaceResponsesRejected":4,"failedLoadRetry":true,"entranceBarriersResolved":5,"lateDestroyRejected":true}
{"avatarLatestWins":true,"observerClearsOwnAvatar":true,"oldGenerationRejected":true,"currentArtworkApplied":true,"disposeCancels":true}
{"settlementToTributeClears":true,"playingHidesOverlay":true,"terminalFallbackText":true,"explicitClear":true}
```

末尾再次读取 6 个文件 SHA-256 与 git HEAD/status，审阅哈希相同且原 5 处 dirty 保留。未更新总 inventory/coverage；由根线程独立复跑及汇总。真实设备渲染、Cocos 生命周期和资源释放专项仍待后续，不由本内存结果替代。
