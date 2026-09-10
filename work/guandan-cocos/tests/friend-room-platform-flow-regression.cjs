const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { loadTypeScript } = require('./support/typescript.cjs')

const projectRoot = path.resolve(__dirname, '..')
const sourcePath = path.join(projectRoot, 'assets/scripts/scenes/front-pages/FriendRoomPlatformFlow.ts')
const presenterPath = path.join(projectRoot, 'assets/scripts/scenes/front-pages/FriendRoomPlatformPresenter.ts')
const waitingPresenterPath = path.join(projectRoot, 'assets/scripts/scenes/front-pages/FriendRoomWaitingPresenter.ts')
const lobbyPagePath = path.join(projectRoot, 'assets/scripts/scenes/front-pages/LobbyPageDomain.ts')
const runtimeUiPath = path.join(projectRoot, 'assets/scripts/ui/RuntimeUiFactory.ts')
const clipboardPath = path.join(projectRoot, 'assets/scripts/services/ClipboardService.ts')
const ts = loadTypeScript()

const loadPureTs = filePath => {
  const result = ts.transpileModule(fs.readFileSync(filePath, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
    fileName: filePath,
    reportDiagnostics: true,
  })
  const errors = (result.diagnostics ?? []).filter(diagnostic => diagnostic.category === ts.DiagnosticCategory.Error)
  assert.deepEqual(errors, [], `${path.basename(filePath)} must transpile`)
  const loaded = { exports: {} }
  new Function('exports', 'module', 'require', result.outputText)(loaded.exports, loaded, request => {
    if (request.startsWith('.')) return loadPureTs(path.resolve(path.dirname(filePath), `${request}.ts`))
    throw new Error(`unexpected runtime dependency ${request}`)
  })
  return loaded.exports
}

const deferred = () => {
  let resolve
  let reject
  const promise = new Promise((onResolve, onReject) => { resolve = onResolve; reject = onReject })
  return { promise, resolve, reject }
}

const flush = async () => { for (let tick = 0; tick < 12; tick += 1) await Promise.resolve() }
const settings = {
  mode: 'classic', rounds: 8, scoring: 'double-3', scoreVisibility: 'live', turnSeconds: 40,
  trusteeSeconds: 15, totalTimeMinutes: 0, spectator: 'off', autoSort: true,
  disableInteraction: true, sortOrder: 'desc', authoritativeValidation: true,
}
const entry = (overrides = {}) => ({
  entryAttemptId: 'friendEntryAttempt_Q7mN4vX9kLp2', matchId: 'match-friend-1', roomId: '123456', seat: 'p1',
  gameEndpoint: 'wss://game.example/weapp', gameTicket: 'signed-ticket', joinToken: 'signed-ticket',
  expiresAt: Date.now() + 60_000, roomExpiresAt: Date.now() + 600_000, roomSettings: settings,
  roomKind: 'friend', ticketPurpose: 'entry',
  ...overrides,
})

async function main () {
  assert.equal(fs.existsSync(sourcePath), true, 'platform friend-room flow is missing')
  assert.equal(fs.existsSync(`${sourcePath}.meta`), true, 'platform friend-room flow needs Cocos metadata')
  assert.equal(fs.existsSync(clipboardPath), false, 'retired copy-invitation adapter must stay outside runtime assets')
  assert.equal(fs.existsSync(`${clipboardPath}.meta`), false, 'retired adapter must not leave orphan Cocos metadata')
  assert.equal(fs.existsSync(presenterPath), false, 'retired invitation interstitial must not return')
  assert.equal(fs.existsSync(`${presenterPath}.meta`), false, 'retired invitation interstitial must not leave metadata')
  assert.equal(fs.existsSync(waitingPresenterPath), true, 'friend-room waiting presenter is missing')
  assert.equal(fs.existsSync(`${waitingPresenterPath}.meta`), true, 'friend-room waiting presenter needs Cocos metadata')
  const lobbyPageSource = fs.readFileSync(lobbyPagePath, 'utf8')
  const runtimeUiSource = fs.readFileSync(runtimeUiPath, 'utf8')
  assert.doesNotMatch(lobbyPageSource + runtimeUiSource, /复制完整邀请口令|粘贴完整邀请口令|friendRoomInviteInput|roomCodeInput|FriendRoomPlatformPresenter/, 'manual invitation entry must not return')
  assert.match(lobbyPageSource, /gateways\.configured[\s\S]*new FriendRoomPlatformFlow/, 'platform-configured builds must own an authenticated friend-room flow')
  assert.match(lobbyPageSource, /enterMatchedRoom\(\{[\s\S]*entryAttemptId: entry\.entryAttemptId/, 'HTTP entry identity must be forwarded to the WebSocket room entry')
  assert.match(lobbyPageSource, /showLobby \(compensateReservation = true\)[\s\S]*if \(compensateReservation\) this\.friendRoomPlatformFlow\?\.handleRoomClosed/, 'local recovery resets must preserve the platform reservation while authoritative closure still compensates')
  assert.match(fs.readFileSync(waitingPresenterPath, 'utf8'), /capabilities\?\.canUseBots/, 'bot affordances must follow the authoritative room capability')
  const { FriendRoomPlatformFlow } = loadPureTs(sourcePath)

  const creates = []
  const joins = []
  const cancellations = []
  const entered = []
  const notices = []
  let changes = 0
  let disposed = false
  const gateway = {
    create: value => { const call = deferred(); creates.push({ value, call }); return call.promise },
    join: value => { const call = deferred(); joins.push({ value, call }); return call.promise },
    cancel: async matchId => { cancellations.push(matchId) },
  }
  const flow = new FriendRoomPlatformFlow({
    gateway,
    isDisposed: () => disposed,
    enterMatchedRoom: value => entered.push(value),
    showNotice: (title, detail) => notices.push({ title, detail }),
    onChanged: () => { changes += 1 },
  })

  const createTask = flow.create(settings)
  assert.equal(flow.snapshot.busy, 'creating')
  assert.deepEqual(creates[0].value, settings)
  const created = entry({
    inviteCode: 'Q7mN4vX9kLp2sTw8aBcD',
    invitePayload: { version: 1, roomId: '123456', inviteCode: 'Q7mN4vX9kLp2sTw8aBcD' },
    inviteText: '123456.Q7mN4vX9kLp2sTw8aBcD',
  })
  creates[0].call.resolve(created)
  await createTask
  assert.equal(flow.snapshot.busy, null)
  assert.equal(flow.snapshot.entry?.matchId, created.matchId)
  assert.equal(flow.snapshot.inviteText, created.inviteText)
  assert.deepEqual(entered, [created], 'a current success must enter the reserved WebSocket seat exactly once')
  const { WechatFriendInvite, friendInviteFromLaunch, friendInviteQuery } = loadPureTs(path.join(projectRoot, 'assets/scripts/services/WechatFriendInvite.ts'))
  const arrivals = []
  const shares = []
  let shown
  let detached
  const launch = { query: { friendRoom: '123456', friendInvite: created.inviteCode } }
  const nativeInvite = new WechatFriendInvite(text => arrivals.push(text), {
    getLaunchOptionsSync: () => launch,
    onShow: listener => { shown = listener }, offShow: listener => { detached = listener },
    shareAppMessage: options => shares.push(options),
  })
  assert.deepEqual(arrivals, [], 'cold launch must wait for the lobby')
  nativeInvite.activate()
  nativeInvite.activate()
  assert.deepEqual(arrivals, [created.inviteText])
  nativeInvite.share(flow.snapshot.inviteText)
  assert.equal(shares[0].query, friendInviteQuery(created.inviteText))
  assert.equal(shares[0].imageUrl, 'friend-room-share.jpg', 'room invite uses the packaged artwork, not a remote URL or live hand screenshot')
  const shareImage = fs.readFileSync(path.join(projectRoot, 'build-templates/wechatgame', shares[0].imageUrl))
  assert.equal(shareImage.readUInt16BE(0), 0xffd8, 'share artwork is a JPEG')
  assert.ok(shareImage.length < 200 * 1024, 'share artwork stays below the project 200 KiB budget')
  assert.doesNotMatch(shares[0].query, /signed-ticket|gameTicket|resumeToken/)
  assert.equal(friendInviteFromLaunch({ query: { friendRoom: '123456', friendInvite: '../bad' } }), null)
  assert.equal(friendInviteFromLaunch({ query: { friendRoom: ['123456'], friendInvite: created.inviteCode } }), null)
  shown({ query: {} })
  assert.equal(arrivals.length, 1)
  shown({ query: { friendRoom: '654321', friendInvite: created.inviteCode } })
  assert.equal(arrivals.at(-1), `654321.${created.inviteCode}`)
  assert.throws(() => nativeInvite.share(null), /邀请暂不可用/)
  const browserInvite = new WechatFriendInvite(() => {}, {})
  assert.throws(() => browserInvite.share(created.inviteText), /微信小游戏/)
  nativeInvite.dispose()
  assert.equal(detached, shown)
  shown(launch)
  assert.equal(arrivals.length, 2, 'disposed launch listener cannot join a room')
  let recovering = true
  const deferredArrivals = []
  const recoveryInvite = new WechatFriendInvite(text => {
    if (recovering) return false
    deferredArrivals.push(text)
  }, { getLaunchOptionsSync: () => launch })
  recoveryInvite.activate()
  assert.deepEqual(deferredArrivals, [], 'startup recovery lookup must finish before a new invitation joins')
  recovering = false
  recoveryInvite.activate()
  recoveryInvite.activate()
  assert.deepEqual(deferredArrivals, [created.inviteText], 'the pending invitation must survive an account recovery lookup')
  recoveryInvite.dispose()

  flow.leave()
  await flush()
  assert.deepEqual(cancellations, [created.matchId], 'leaving a waiting signed friend room must compensate the platform reservation')
  assert.equal(flow.snapshot.entry, null)

  const staleTask = flow.create({ ...settings, rounds: 12 })
  flow.leave()
  const stale = entry({ matchId: 'match-stale', roomId: '654321', inviteCode: 'Z'.repeat(24), invitePayload: { version: 1, roomId: '654321', inviteCode: 'Z'.repeat(24) }, inviteText: `654321.${'Z'.repeat(24)}` })
  creates[1].call.resolve(stale)
  await staleTask
  await flush()
  assert.equal(entered.length, 1, 'a late HTTP success after navigation must never enter its WebSocket room')
  assert.deepEqual(cancellations, [created.matchId, stale.matchId], 'a late committed room must be released through platform compensation')

  const joinTask = flow.join(' 777777.InviteToken_Q7mN4vX9kLp2 ')
  assert.equal(flow.snapshot.busy, 'joining')
  assert.equal(joins[0].value, '777777.InviteToken_Q7mN4vX9kLp2', 'the flow must trim but preserve the complete invite credential')
  const joined = entry({ matchId: 'match-joined', roomId: '777777', seat: 'p3' })
  joins[0].call.resolve(joined)
  await joinTask
  assert.equal(entered.at(-1), joined)
  assert.equal(flow.snapshot.inviteText, joins[0].value, 'a validated invitation can be shared by the joined guest')
  flow.handleRoomClosed()
  await flush()
  assert.equal(cancellations.at(-1), joined.matchId, 'room close/kick must release any remaining platform lifecycle record')

  const handedOff = new FriendRoomPlatformFlow({
    gateway, isDisposed: () => false, enterMatchedRoom: value => entered.push(value),
    showNotice: (title, detail) => notices.push({ title, detail }), onChanged: () => {},
  })
  const playingTask = handedOff.create(settings)
  const playingEntry = entry({ matchId: 'match-playing', roomId: '898989' })
  creates[2].call.resolve(playingEntry)
  await playingTask
  handedOff.handoffReservation()
  handedOff.leave()
  await flush()
  assert.equal(cancellations.includes(playingEntry.matchId), false, 'a started room is owned by the game lifecycle and must not be cancelled on menu exit')

  const terminalTask = handedOff.create(settings)
  const terminalEntry = entry({ matchId: 'match-terminal', roomId: '909090' })
  creates[3].call.resolve(terminalEntry)
  await terminalTask
  handedOff.handoffReservation()
  handedOff.handleRoomClosed()
  await flush()
  assert.equal(cancellations.includes(terminalEntry.matchId), false, 'a terminal authoritative room must not leave a permanent platform cancel retry')

  const failed = flow.join('bad invite')
  joins[1].call.reject(new Error('邀请卡片无效，请让好友重新发送邀请'))
  await failed
  assert.equal(flow.snapshot.busy, null)
  assert.match(notices.at(-1).detail, /邀请卡片无效/)

  let releaseAttempts = 0
  const retryFlow = new FriendRoomPlatformFlow({
    gateway: {
      create: async () => created,
      join: async () => joined,
      cancel: async () => { releaseAttempts += 1; if (releaseAttempts === 1) throw new Error('temporary network failure') },
    },
    isDisposed: () => false,
    enterMatchedRoom: () => {},
    showNotice: (title, detail) => notices.push({ title, detail }),
    onChanged: () => {},
  })
  await retryFlow.create(settings)
  retryFlow.leave()
  await flush()
  assert.equal(releaseAttempts, 1)
  assert.match(notices.at(-1).title, /退出待重试/, 'a failed platform release must remain visible and retryable')
  retryFlow.leave()
  await flush()
  assert.equal(releaseAttempts, 2, 'a later lifecycle exit must retry a transiently failed platform cancellation')

  const recoveredCancellations = []
  const recoveredFlow = new FriendRoomPlatformFlow({
    gateway: { create: async () => created, join: async () => joined, cancel: async matchId => { recoveredCancellations.push(matchId) } },
    isDisposed: () => false, enterMatchedRoom: () => {}, showNotice: () => {}, onChanged: () => {},
  })
  const recoveredHost = entry({
    entryAttemptId: 'hostRecoveryAttempt_Q7mN4vX9kLp', recoveryAttemptId: 'hostRecoveryAttempt_Q7mN4vX9kLp',
    matchId: 'match-recovered-host', inviteCode: 'R'.repeat(24),
    invitePayload: { version: 1, roomId: '123456', inviteCode: 'R'.repeat(24) }, inviteText: `123456.${'R'.repeat(24)}`,
  })
  recoveredFlow.restoreReservation(recoveredHost)
  assert.equal(recoveredFlow.snapshot.inviteText, recoveredHost.inviteText, 'cold-recovered hosts must regain the full share credential')
  recoveredFlow.leave()
  await flush()
  assert.deepEqual(recoveredCancellations, [recoveredHost.matchId], 'a recovered waiting reservation must still compensate on exit')

  const recoveredGuest = entry({
    entryAttemptId: 'guestRecoveryAttempt_Q7mN4vX9kLp', recoveryAttemptId: 'guestRecoveryAttempt_Q7mN4vX9kLp',
    matchId: 'match-recovered-guest', seat: 'p3', inviteCode: undefined, invitePayload: undefined, inviteText: undefined,
  })
  recoveredFlow.restoreReservation(recoveredGuest)
  assert.equal(recoveredFlow.snapshot.inviteText, null, 'guest recovery must retain a neutral non-sharing view')

  for (const order of ['old-first', 'new-first']) {
    const oldResponse = deferred()
    const newResponse = deferred()
    const cancelled = []
    const adopted = []
    let requestCount = 0
    const raceFlow = new FriendRoomPlatformFlow({
      gateway: {
        create: () => (++requestCount === 1 ? oldResponse.promise : newResponse.promise),
        join: async () => { throw new Error('unused') },
        cancel: async id => { cancelled.push(id) },
      },
      isDisposed: () => false, enterMatchedRoom: value => adopted.push(value), showNotice: () => {}, onChanged: () => {},
    })
    const room = entry({ matchId: `idempotent-${order}` })
    const oldTask = raceFlow.create(settings)
    raceFlow.leave()
    const newTask = raceFlow.create(settings)
    if (order === 'old-first') {
      oldResponse.resolve(room)
      await oldTask
      assert.deepEqual(cancelled, [], 'pending new admission may adopt the same idempotent room')
      newResponse.resolve(room)
      await newTask
      raceFlow.handoffReservation()
    } else {
      newResponse.resolve(room)
      await newTask
      raceFlow.handoffReservation()
      raceFlow.leave()
      oldResponse.resolve(room)
      await oldTask
    }
    raceFlow.destroy()
    await flush()
    assert.deepEqual(adopted.map(value => value.matchId), [room.matchId])
    assert.deepEqual(cancelled, [], `${order}: stale compensation must never cancel a handed-off room`)
  }

  for (const outcome of ['different-room', 'failed', 'destroyed', 'restored']) {
    const responses = [deferred(), deferred()]
    const cancelled = []
    let count = 0
    const cleanupFlow = new FriendRoomPlatformFlow({
      gateway: { create: () => responses[count++].promise, join: async () => entry(), cancel: async id => { cancelled.push(id) } },
      isDisposed: () => false, enterMatchedRoom: () => {}, showNotice: () => {}, onChanged: () => {},
    })
    const abandoned = entry({ matchId: `old-${outcome}` })
    const first = cleanupFlow.create(settings)
    cleanupFlow.leave()
    if (outcome === 'restored') {
      cleanupFlow.restoreReservation(abandoned)
      responses[0].resolve(abandoned)
      await first
      assert.deepEqual(cancelled, [], 'a recovered room owns a late create result too')
      cleanupFlow.leave()
    } else {
      const second = cleanupFlow.create(settings)
      responses[0].resolve(abandoned)
      await first
      assert.deepEqual(cancelled, [])
      if (outcome === 'destroyed') cleanupFlow.destroy()
      if (outcome === 'failed') responses[1].reject(new Error('create failed'))
      else responses[1].resolve(entry({ matchId: 'new-room' }))
      await second
    }
    await flush()
    assert.equal(cancelled.includes(abandoned.matchId), true, 'unadopted stale reservations must still be released')
    assert.equal(cancelled.includes('new-room'), outcome === 'destroyed')
  }

  for (const action of ['complete-release', 'leave-while-releasing', 'failed-release']) {
    const release = deferred()
    let creates = 0
    const guardedFlow = new FriendRoomPlatformFlow({
      gateway: { create: async () => entry({ matchId: `room-${++creates}` }), join: async () => entry(), cancel: () => release.promise },
      isDisposed: () => false, onChanged: () => {}, enterMatchedRoom: () => {}, showNotice: () => {},
    })
    await guardedFlow.create(settings)
    guardedFlow.leave()
    const next = guardedFlow.create(settings)
    await flush()
    assert.equal(creates, 1, 'new admission must wait for an already-started cancellation')
    if (action === 'leave-while-releasing') guardedFlow.leave()
    if (action === 'failed-release') release.reject(new Error('release failed'))
    else release.resolve()
    await next
    await flush()
    assert.equal(creates, action === 'complete-release' ? 2 : 1)
  }

  flow.destroy()
  flow.destroy()
  disposed = true
  assert.ok(changes >= 6, 'state changes must be observable by the Lobby presenter')
  process.stdout.write('friend-room platform flow regression checks passed\n')
}

main().catch(error => {
  console.error(error)
  process.exitCode = 1
})
