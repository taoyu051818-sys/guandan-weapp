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

const flush = async () => { await Promise.resolve(); await Promise.resolve() }
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
  assert.equal(fs.existsSync(clipboardPath), true, 'clipboard adapter is missing')
  assert.equal(fs.existsSync(`${clipboardPath}.meta`), true, 'clipboard adapter needs Cocos metadata')
  assert.equal(fs.existsSync(presenterPath), true, 'authenticated friend-room UI presenter is missing')
  assert.equal(fs.existsSync(`${presenterPath}.meta`), true, 'authenticated friend-room UI presenter needs Cocos metadata')
  assert.equal(fs.existsSync(waitingPresenterPath), true, 'friend-room waiting presenter is missing')
  assert.equal(fs.existsSync(`${waitingPresenterPath}.meta`), true, 'friend-room waiting presenter needs Cocos metadata')
  const presenterSource = fs.readFileSync(presenterPath, 'utf8')
  const lobbyPageSource = fs.readFileSync(lobbyPagePath, 'utf8')
  const runtimeUiSource = fs.readFileSync(runtimeUiPath, 'utf8')
  assert.match(presenterSource, /六位房间号仅用于展示[\s\S]*加入必须粘贴完整邀请口令/, 'platform UI must explain that the visible room id is not a join credential')
  assert.match(presenterSource, /复制完整邀请口令/, 'room sharing must name the complete invite credential')
  assert.match(runtimeUiSource, /friendRoomInviteInput[\s\S]*粘贴完整邀请口令[\s\S]*InputMode\.ANY/, 'platform invite input must accept the full opaque credential')
  assert.match(lobbyPageSource, /gateways\.configured[\s\S]*new FriendRoomPlatformFlow/, 'platform-configured builds must own an authenticated friend-room flow')
  assert.match(lobbyPageSource, /enterMatchedRoom\(\{[\s\S]*entryAttemptId: entry\.entryAttemptId/, 'HTTP entry identity must be forwarded to the WebSocket room entry')
  assert.match(lobbyPageSource, /showLobby \(compensateReservation = true\)[\s\S]*if \(compensateReservation\) this\.friendRoomPlatformFlow\?\.handleRoomClosed/, 'local recovery resets must preserve the platform reservation while authoritative closure still compensates')
  assert.match(fs.readFileSync(waitingPresenterPath, 'utf8'), /capabilities\?\.canUseBots/, 'bot affordances must follow the authoritative room capability')
  const { FriendRoomPlatformFlow } = loadPureTs(sourcePath)
  const { writeClipboardText } = loadPureTs(clipboardPath)

  const creates = []
  const joins = []
  const cancellations = []
  const entered = []
  const notices = []
  const copied = []
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
    copyText: async value => { copied.push(value) },
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
  await flow.copyInvite()
  assert.deepEqual(copied, [created.inviteText], 'sharing must copy the complete invite text, never the six-digit display id')

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
  flow.handleRoomClosed()
  await flush()
  assert.equal(cancellations.at(-1), joined.matchId, 'room close/kick must release any remaining platform lifecycle record')

  const handedOff = new FriendRoomPlatformFlow({
    gateway, isDisposed: () => false, enterMatchedRoom: value => entered.push(value),
    showNotice: (title, detail) => notices.push({ title, detail }), onChanged: () => {}, copyText: async () => {},
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
  joins[1].call.reject(new Error('请粘贴完整的好友房邀请口令'))
  await failed
  assert.equal(flow.snapshot.busy, null)
  assert.match(notices.at(-1).detail, /完整的好友房邀请口令/)

  const navigatorWrites = []
  await writeClipboardText('123456.full-secret', { clipboard: { writeText: async text => navigatorWrites.push(text) } })
  assert.deepEqual(navigatorWrites, ['123456.full-secret'])
  const wxWrites = []
  await writeClipboardText('654321.other-secret', undefined, {
    setClipboardData: ({ data, success }) => { wxWrites.push(data); success() },
  })
  assert.deepEqual(wxWrites, ['654321.other-secret'])
  await assert.rejects(writeClipboardText('secret', undefined, undefined), /不支持复制/)

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
    copyText: async () => {},
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
  const recoveredCopies = []
  const recoveredFlow = new FriendRoomPlatformFlow({
    gateway: { create: async () => created, join: async () => joined, cancel: async matchId => { recoveredCancellations.push(matchId) } },
    isDisposed: () => false, enterMatchedRoom: () => {}, showNotice: () => {}, onChanged: () => {},
    copyText: async text => { recoveredCopies.push(text) },
  })
  const recoveredHost = entry({
    entryAttemptId: 'hostRecoveryAttempt_Q7mN4vX9kLp', recoveryAttemptId: 'hostRecoveryAttempt_Q7mN4vX9kLp',
    matchId: 'match-recovered-host', inviteCode: 'R'.repeat(24),
    invitePayload: { version: 1, roomId: '123456', inviteCode: 'R'.repeat(24) }, inviteText: `123456.${'R'.repeat(24)}`,
  })
  recoveredFlow.restoreReservation(recoveredHost)
  assert.equal(recoveredFlow.snapshot.inviteText, recoveredHost.inviteText, 'cold-recovered hosts must regain the full share credential')
  await recoveredFlow.copyInvite()
  assert.deepEqual(recoveredCopies, [recoveredHost.inviteText])
  recoveredFlow.leave()
  await flush()
  assert.deepEqual(recoveredCancellations, [recoveredHost.matchId], 'a recovered waiting reservation must still compensate on exit')

  const recoveredGuest = entry({
    entryAttemptId: 'guestRecoveryAttempt_Q7mN4vX9kLp', recoveryAttemptId: 'guestRecoveryAttempt_Q7mN4vX9kLp',
    matchId: 'match-recovered-guest', seat: 'p3', inviteCode: undefined, invitePayload: undefined, inviteText: undefined,
  })
  recoveredFlow.restoreReservation(recoveredGuest)
  assert.equal(recoveredFlow.snapshot.inviteText, null, 'guest recovery must retain a neutral non-sharing view')

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
