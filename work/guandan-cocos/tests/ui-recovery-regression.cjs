const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { loadTypeScript } = require('./support/typescript.cjs')
const ts = loadTypeScript()
const root = path.resolve(__dirname, '..')
const load = (file, dependencies = {}) => {
  const result = ts.transpileModule(fs.readFileSync(path.join(root, file), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  })
  const module = { exports: {} }
  Function('module', 'exports', 'require', result.outputText)(module, module.exports, name => {
    if (name in dependencies) return dependencies[name]
    throw new Error(`Unexpected runtime dependency ${name} in ${file}`)
  })
  return module.exports
}

const safe = load('assets/scripts/ui/SafeAreaLayout.ts')
const { resolveTableHudFrameLayout } = load('assets/scripts/ui/TableHudLayoutPolicy.ts', {
  './SafeAreaLayout': safe, './WechatCapsuleLayout': load('assets/scripts/ui/WechatCapsuleLayout.ts'),
})
for (const viewport of [
  { width: 1280, height: 589 }, { width: 1280, height: 720 },
  { width: 874, height: 402 }, { width: 1565, height: 720, safeLeft: 54, safeRight: 84, safeTop: 12, safeBottom: 26 },
]) {
  const sizes = { backSize: { width: 60, height: 60 }, roundSize: { width: 272, height: 84 }, seatSize: { width: 180, height: 108 }, suitSize: { width: 480, height: 68 }, toolbarSize: { width: 480, height: 70 } }
  const frame = resolveTableHudFrameLayout({ viewport, ...sizes })
  const { back, round } = frame.top
  assert.ok(round.y + sizes.roundSize.height * round.scale / 2 < back.y - sizes.backSize.height * back.scale / 2, 'level information belongs below Back, not beside it')
  assert.ok(Math.abs((back.x - 30 * back.scale) - (round.x - 136 * round.scale)) < 1, 'Back and level information share a left edge')
  const toolbar = frame.bottom.toolbar
  const toolbarBottom = toolbar.y - sizes.toolbarSize.height * toolbar.scale / 2
  assert.ok(toolbarBottom >= frame.bounds.bottom, 'toolbar must stay within the bottom safe edge')
  assert.ok(toolbarBottom - frame.bounds.bottom < 14, 'hand tools must not drift upward into the play lane')
}

const { projectSettlementContent } = load('assets/scripts/scenes/SettlementPresentation.ts', { './MatchEndedPresentation': load('assets/scripts/scenes/MatchEndedPresentation.ts') })
const snapshot = {
  state: { players: { p1: { name: '我', team: 'teamA' }, p2: { name: '左家', team: 'teamB' }, p3: { name: '队友', team: 'teamA' }, p4: { name: '右家', team: 'teamB' } } },
  settlement: { fullRank: ['p3', 'p1', 'p4', 'p2'], winnerTeam: 'teamA', levelUp: 3, message: '双上', isGameWon: false },
}
const settlement = projectSettlementContent(snapshot, 'p1', '本局胜利', true, ['p1', 'p1', 'p3'])
assert.deepEqual(settlement.players.map(p => p.team), ['队友', '我', '对手', '对手'])
assert.deepEqual(settlement.players.map(p => p.ready), ['已准备', '已准备', '未准备', '未准备'])
assert.match(settlement.footer, /胜方升 3 级 · 下一局准备 2\/4/, 'duplicate ready IDs must not inflate the visible count')
assert.equal(settlement.summary, '我方升 3 级')
assert.equal(projectSettlementContent(snapshot, 'p2', '本局失利', true, []).summary, '对方升 3 级', 'a loss must not imply that the viewer was promoted')
snapshot.settlement.isGameWon = true
assert.equal(projectSettlementContent(snapshot, 'p1', null, true, []).summary, '我方完成过 A · 本场结束')
assert.equal(projectSettlementContent(snapshot, 'p1', null, true, []).players.every(p => p.ready === '本局完成'), true)

const independentSnapshot = {
  state: { ...snapshot.state, currentLevel: 'A' },
  settlement: { ...snapshot.settlement, isGameWon: false, format: 'independent', levelUp: 0, pointsEarned: 3 },
}
const betweenRounds = projectSettlementContent(independentSnapshot, 'p1', null, true, ['p1'])
assert.equal(betweenRounds.summary, '我方获胜 · 得 3 分')
assert.match(betweenRounds.footer, /本局打 A · 不升级、不进贡 · 下一局准备 1\/4/)
const singleEnded = { reason: 'single-round', winnerTeam: 'teamA', scores: { teamA: 3, teamB: 0 }, roundsPlayed: 1, configuredRounds: 1 }
const singleResult = projectSettlementContent(independentSnapshot, 'p1', null, true, ['p1'], singleEnded)
assert.equal(singleResult.title, '本局结束 · 胜利')
assert.match(singleResult.summary, /随机级牌 · 单局结算/)
assert.doesNotMatch(JSON.stringify(singleResult), /升 0 级|完成过 A|下一局准备|未准备/)
assert.equal(singleResult.players.length, 4)
assert.ok(singleResult.players.every(player => player.ready === '本局完成'))
assert.equal(projectSettlementContent(independentSnapshot, 'p2', null, true, [], singleEnded).title, '本局结束 · 失利')

// Exercise the real settlement renderer; rows and their columns must not
// collide, including a long Unicode player name and narrow overlay reflow.
const settlementPanels = [], settlementLabels = []
class SettlementTransform {}
const settlementNode = (name, parent, x, y, width, height) => {
  const node = {
    name, parent, x, y, width, height, children: [], isValid: true, active: true,
    setScale (x, y) { this.scale = { x, y } },
    setSiblingIndex (index) { this.siblingIndex = index },
    getComponent: () => ({ contentSize: { width, height } }),
    destroy () { this.isValid = false },
  }
  parent?.children.push(node)
  return node
}
class SettlementUi {
  constructor (parent) { this.parent = parent }
  panel (name, x, y, width, height, style) {
    const node = settlementNode(name, this.parent, x, y, width, height)
    node.style = style; settlementPanels.push(node); return node
  }
}
const { TableSettlementView } = load('assets/scripts/ui/TableSettlementView.ts', {
  cc: { Color: class { constructor (...values) { this.values = values } }, UITransform: SettlementTransform },
  './RuntimeUiFactory': { RuntimeUiFactory: SettlementUi },
  './CoastalUi': { coastalText: (ui, text, x, y, width, height, size, options = {}) => {
    const node = settlementNode('Text', options.parent ?? ui.parent, x, y, width, height)
    settlementLabels.push({ text, node, size }); return node
  } },
})
const settlementOverlay = { node: settlementNode('Overlay', null, 0, 0, 608, 480), string: 'old overlay' }
const settlementView = new TableSettlementView()
settlementView.render(settlementOverlay, {
  ...settlement, players: settlement.players.map((player, index) => ({ ...player, name: index === 1 ? '陵水牌友🌊快乐掼蛋好朋友' : player.name })),
})
const rankRows = settlementPanels.filter(node => node.name.startsWith('SettlementRank-'))
assert.equal(rankRows.length, 4)
rankRows.forEach((row, index) => {
  if (index) assert.ok(row.y + row.height / 2 + 6 <= rankRows[index - 1].y - rankRows[index - 1].height / 2)
  const columns = settlementLabels.filter(item => item.node.parent === row).map(item => item.node)
  assert.equal(columns.length, 4)
  columns.forEach((column, columnIndex) => {
    assert.ok(Math.abs(column.x) + column.width / 2 <= row.width / 2)
    if (columnIndex) assert.ok(columns[columnIndex - 1].x + columns[columnIndex - 1].width / 2 < column.x - column.width / 2)
  })
})
assert.ok(settlementLabels.some(item => item.text.endsWith('…')), 'long names are clipped by Unicode code points instead of shrinking to tiny type')
assert.equal(settlementPanels[0].scale.x, 0.8)
assert.equal(settlementOverlay.string, '')
settlementView.clear()
assert.equal(settlementPanels[0].active, false)
assert.equal(settlementPanels[0].isValid, false)

// Run public preview domains with trap gateways: any remote operation is a test failure.
const product = { id: 'tissue', name: '抽纸', pointsPrice: 900, stock: 99 }
let selected, redeem, productBack, route = '', token = 0
const notices = []
const previews = {
  renderShopPreview: (_ui, _screen, products, _back, select) => { assert.equal(products[0], product); selected = select },
  renderProductPreview: (_ui, _screen, _product, back, notice) => { productBack = back; redeem = notice },
}
const trap = new Proxy({}, { get: () => () => assert.fail('a read-only preview must never call a gateway') })
const deps = {
  previewProducts: [product], previewTournaments: [],
  router: { open: page => { route = page; return {} }, get current () { return route } }, screen: {},
  gateways: { configured: true, shop: trap, tournaments: trap, wallet: trap }, wallet: trap,
  issuePageRequest: () => ++token, currentPageRequest: () => token,
  isDisposed: () => false, setTableVisible: () => {}, invalidateMatchAttempt: () => {},
  showMenu: () => { route = 'menu' }, showNotice: (...args) => notices.push(args),
  showToast: text => notices.push([text]),
  beginMatch: () => assert.fail('preview cannot enter a fake tournament'),
}
const { ShopPageDomain } = load('assets/scripts/scenes/front-pages/ShopPageDomain.ts', {
  cc: {}, '../../services/DevelopmentApis': { SAMPLE_PRODUCTS: [product] }, './CoastalPreviewPages': previews,
})
const shop = new ShopPageDomain(deps)
shop.showPreview()
assert.equal(route, 'shop')
selected(product)
assert.equal(route, 'product')
shop.reflow()
assert.equal(route, 'product', 'resizing must preserve selected product')
redeem()
assert.match(notices.at(-1).join(' '), /不会创建订单或扣除积分/)
productBack()
assert.equal(route, 'shop')
const previewSource = fs.readFileSync(path.join(root, 'assets/scripts/scenes/front-pages/CoastalPreviewPages.ts'), 'utf8')
assert.doesNotMatch(previewSource, /createOrder|\.enroll\(|gateways\./, 'preview renderer must not acquire transaction dependencies')
assert.doesNotMatch(previewSource, /renderCompetitionPreview|CompetitionPreviewTrophy|陵水赛事/, 'retired tournament preview has no renderer')
assert.match(previewSource, /back, '返回商城'/, 'product detail must correctly label its return destination')
const matching = fs.readFileSync(path.join(root, 'assets/scripts/scenes/front-pages/MatchmakingPageView.ts'), 'utf8')
assert.match(matching, /height: needsAction \? 116 : 38/, 'actionable matching errors retain multiline height')
assert.match(matching, /\[-1, 0, 1\]\.forEach/, 'first-version three-card shuffle restored')
assert.doesNotMatch(matching, /MatchingSurface|coastalIcon|120, 96/, 'retired large matching panel and four floating boxes must not return')
console.log('UI recovery regression passed: safe-edge placement, authoritative settlement, read-only previews, multiline matching')
