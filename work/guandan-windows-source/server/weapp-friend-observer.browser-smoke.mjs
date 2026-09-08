import assert from 'node:assert/strict'

/** Optional real Cocos check. Supply Playwright module path; never contacts production services. */
export const checkObserverBrowser = async ({ ticket, roomId, endpoint, delayed }) => {
  const modulePath = process.env.GUANDAN_BROWSER_TEST_MODULE
  if (!modulePath) return
  const { chromium } = await import(modulePath)
  const browser = await chromium.launch({ headless: true, channel: 'chrome' })
  try {
    const page = await browser.newPage({ viewport: { width: 1000, height: 540 } })
    const errors = []
    page.on('pageerror', error => errors.push(error.message))
    await page.addInitScript(() => {
      globalThis.__GUANDAN_RUNTIME_CONFIG__ = Object.freeze({ version: 1, platformEndpoint: '', lobbyEndpoint: '', platformAllowDevelopmentLogin: false, platformAllowInsecureEndpoint: false, platformAllowInsecureGameEndpoint: true })
    })
    await page.goto('http://localhost:18741/web-desktop/')
    await page.waitForFunction(() => {
      const walk = node => [node, ...node.children.flatMap(walk)]
      const scene = globalThis.cc?.director?.getScene()
      const game = scene && walk(scene).map(node => node.getComponent('GameScene')).find(Boolean)
      if (game?.lobby && game?.tableMatch && game?.frontPages?.lobbyPage) { globalThis.observerTestGame = game; return true }
      return false
    }, { timeout: 60000 })
    await page.evaluate(({ ticket, roomId, endpoint }) => {
      observerTestGame.lobby.enterMatchedRoom({ roomId, matchId: ticket.claims.matchId, seat: 'observer', gameTicket: ticket.gameTicket, gameEndpoint: endpoint, entryAttemptId: ticket.claims.entryAttemptId })
    }, { ticket, roomId, endpoint })
    await page.waitForFunction(() => observerTestGame.session.snapshot.isObserver && observerTestGame.tableMatch.snapshot?.phase === 'playing', { timeout: 30000 })
    const before = await page.evaluate(() => ({ view: observerTestGame.session.snapshot.myPlayerId, lobby: observerTestGame.lobby.snapshot.roomRole }))
    assert.equal(before.view, 'p1'); assert.equal(before.lobby, 'observer')
    await page.locator('#GameCanvas').screenshot({ path: '/tmp/guandan-observer-live-client.png' })
    // Real input against the upper avatar, whose physical seat is p3 from the p1 viewpoint.
    const canvas = await page.locator('#GameCanvas').boundingBox()
    await page.mouse.click(canvas.x + canvas.width * 266 / 874, canvas.y + canvas.height * 52 / 402)
    await page.waitForFunction(() => observerTestGame.session.snapshot.myPlayerId === 'p3' && observerTestGame.tableMatch.snapshot.state.players.p3.hand.every(card => card.rank), { timeout: 10000 })
    assert.equal(await page.evaluate(() => observerTestGame.tableMatch.snapshot.state.players.p1.hand.every(card => card.id.startsWith('hidden-'))), true)
    assert.equal(await page.evaluate(() => {
      const walk = node => [node, ...node.children.flatMap(walk)]
      return walk(cc.director.getScene()).some(node => node.name === 'QuickChat' && node.activeInHierarchy)
    }), false, 'observer must not retain unusable participant chat controls')
    await page.locator('#GameCanvas').screenshot({ path: '/tmp/guandan-observer-live-switched.png' })
    assert.deepEqual(errors, [], 'Cocos must render authoritative hidden hands without exceptions')
    console.log(`Cocos browser observer passed (${delayed ? 'delayed' : 'live'}): signed entry, real avatar tap, private hand switch, readonly HUD`)
  } finally { await browser.close() }
}
