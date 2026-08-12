import assert from 'node:assert/strict'
import { createPlatformRuntime } from '../platform-server.js'
import { GameTicketService, GameTicketVerifier, gameResultSignature, signCompactToken, spectatorEventSignature, verifyCompactToken } from './crypto.js'
import { SpectatorEventReporter } from './spectator-event-reporter.js'

const accessSecret = 'friend-room-access-secret-with-at-least-thirty-two-characters'
const ticketSecret = 'friend-room-ticket-secret-with-at-least-thirty-two-characters'
const resultSecret = 'friend-room-result-secret-with-at-least-thirty-two-characters'
const spectatorSecret = 'friend-room-spectator-secret-with-at-least-thirty-two-characters'
const gameEndpoint = 'ws://127.0.0.1:39999/weapp'

const listen = async (runtime) => {
  await new Promise(resolve => runtime.server.listen(0, '127.0.0.1', resolve))
  const { port } = runtime.server.address()
  return `http://127.0.0.1:${port}`
}
const close = runtime => new Promise(resolve => runtime.server.close(resolve))
const call = async (baseUrl, path, { method = 'GET', token, body } = {}) => {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
  return { status: response.status, payload: await response.json() }
}

const runtime = await createPlatformRuntime({
  env: {
    NODE_ENV: 'test',
    PLATFORM_ENABLE_DEV_LOGIN: 'true',
    PLATFORM_ACCESS_SECRET: accessSecret,
    GAME_TICKET_SECRET: ticketSecret,
    GAME_RESULT_SECRET: resultSecret,
    GAME_SPECTATOR_EVENT_SECRET: spectatorSecret,
    GAME_ENDPOINT: gameEndpoint,
  },
  wxCodeVerifier: { async verify () { throw new Error('本测试不使用微信登录') } },
  logger: { error () {} },
})
let platformNow = Date.now()
runtime.service.now = () => platformNow
runtime.service.friendRoomTtlMs = 60_000
runtime.service.gameTickets = new GameTicketService({
  secret: ticketSecret,
  gameEndpoint,
  ttlMs: 2_000,
  now: () => platformNow,
})
const baseUrl = await listen(runtime)

try {
  const login = async (index) => {
    const response = await call(baseUrl, '/api/v1/auth/dev-login', {
      method: 'POST',
      body: { deviceId: `friend-room-device-${index}`, displayName: `好友房玩家${index}` },
    })
    assert.equal(response.status, 200)
    return { token: response.payload.data.accessToken, userId: response.payload.data.user.id }
  }
  const players = []
  for (let index = 1; index <= 10; index += 1) players.push(await login(index))

  const settings = {
    mode: 'classic',
    rounds: 8,
    scoring: 'double-4',
    scoreVisibility: 'hidden',
    turnSeconds: 60,
    trusteeSeconds: 30,
    totalTimeMinutes: 20,
    spectator: 'off',
    autoSort: false,
    disableInteraction: false,
    sortOrder: 'asc',
    authoritativeValidation: true,
  }
  const createBody = { entryAttemptId: 'friend-create-attempt-0001', roomSettings: settings }

  const anonymousCreate = await call(baseUrl, '/api/v1/friend-rooms/create', { method: 'POST', body: createBody })
  assert.equal(anonymousCreate.status, 401, '创建好友房必须登录')
  const anonymousJoin = await call(baseUrl, '/api/v1/friend-rooms/join', {
    method: 'POST',
    body: { entryAttemptId: 'friend-join-attempt-anon', roomId: '123456', inviteCode: 'A'.repeat(24) },
  })
  assert.equal(anonymousJoin.status, 401, '加入好友房必须登录')

  const invalidSettings = await call(baseUrl, '/api/v1/friend-rooms/create', {
    method: 'POST',
    token: players[0].token,
    body: { entryAttemptId: 'friend-create-invalid-1', roomSettings: { ...settings, rounds: 5 } },
  })
  assert.equal(invalidSettings.status, 400)
  assert.equal(invalidSettings.payload.error.code, 'INVALID_FRIEND_ROOM_SETTINGS')
  const invalidEntryAttempt = await call(baseUrl, '/api/v1/friend-rooms/create', {
    method: 'POST',
    token: players[0].token,
    body: { entryAttemptId: 'short.or.invalid', roomSettings: settings },
  })
  assert.equal(invalidEntryAttempt.status, 400)
  assert.equal(invalidEntryAttempt.payload.error.code, 'INVALID_ENTRY_ATTEMPT_ID')

  const created = await call(baseUrl, '/api/v1/friend-rooms/create', {
    method: 'POST', token: players[0].token, body: createBody,
  })
  assert.equal(created.status, 200)
  const hostEntry = created.payload.data.entry
  assert.equal(hostEntry.entryAttemptId, createBody.entryAttemptId)
  assert.equal(hostEntry.seat, 'p1')
  assert.match(hostEntry.roomId, /^\d{6}$/)
  assert.match(hostEntry.inviteCode, /^[A-Za-z0-9_-]{20,128}$/)
  assert.deepEqual(hostEntry.invitePayload, {
    version: 1,
    roomId: hostEntry.roomId,
    inviteCode: hostEntry.inviteCode,
  })
  assert.equal(hostEntry.inviteText, `${hostEntry.roomId}.${hostEntry.inviteCode}`)
  assert.equal(hostEntry.gameEndpoint, gameEndpoint)
  assert.equal(hostEntry.joinToken, hostEntry.gameTicket)
  assert.deepEqual(hostEntry.roomSettings, settings)
  assert.ok(hostEntry.expiresAt > platformNow)
  assert.ok(hostEntry.roomExpiresAt >= platformNow + 60_000)

  const hostClaims = verifyCompactToken(hostEntry.gameTicket, ticketSecret, {
    now: platformNow,
    kind: 'game-ticket',
    audience: 'guandan-game',
  })
  assert.deepEqual(
    {
      sub: hostClaims.sub,
      matchId: hostClaims.matchId,
      roomId: hostClaims.roomId,
      seat: hostClaims.seat,
      roomKind: hostClaims.roomKind,
      purpose: hostClaims.purpose,
      entryAttemptId: hostClaims.entryAttemptId,
      roomExpiresAt: hostClaims.roomExpiresAt,
      roomSettings: hostClaims.roomSettings,
    },
    {
      sub: players[0].userId,
      matchId: hostEntry.matchId,
      roomId: hostEntry.roomId,
      seat: 'p1',
      roomKind: 'friend',
      purpose: 'entry',
      entryAttemptId: createBody.entryAttemptId,
      roomExpiresAt: hostEntry.roomExpiresAt,
      roomSettings: settings,
    },
    '房主票据必须绑定用户、房间、p1 和完整规范化设置',
  )
  const strictVerifier = new GameTicketVerifier({ secret: ticketSecret, required: true, now: () => platformNow })
  assert.equal(strictVerifier.inspect(hostEntry.gameTicket).roomKind, 'friend')
  const ordinaryTicket = runtime.service.gameTickets.issue({
    userId: 'ordinary-user', matchId: 'ordinary-match', roomId: '234567', seat: 'p1',
  })
  const ordinaryClaims = strictVerifier.inspect(ordinaryTicket.gameTicket)
  assert.equal(ordinaryClaims.roomKind, 'match')
  assert.equal(ordinaryClaims.purpose, 'entry')
  assert.match(ordinaryClaims.entryAttemptId, /^[A-Za-z0-9_-]{22,128}$/)
  assert.equal('roomSettings' in ordinaryClaims, false)
  assert.equal('roomExpiresAt' in ordinaryClaims, false)

  const signedClaims = {
    kind: 'game-ticket',
    aud: 'guandan-game',
    sub: players[0].userId,
    matchId: hostEntry.matchId,
    roomId: hostEntry.roomId,
    seat: 'p1',
    roomKind: 'friend',
    purpose: 'entry',
    entryAttemptId: 'friend-strict-attempt-0001',
    roomExpiresAt: hostEntry.roomExpiresAt,
    roomSettings: settings,
    jti: 'friend-strict-claims-test',
    iat: Math.floor(platformNow / 1000),
    exp: Math.floor((platformNow + 30_000) / 1000),
  }
  const forged = overrides => signCompactToken({ ...signedClaims, ...overrides }, ticketSecret)
  assert.throws(() => strictVerifier.inspect(forged({ roomKind: 'other' })), /房间类型/)
  assert.throws(() => strictVerifier.inspect(forged({ purpose: 'other' })), /用途/)
  assert.throws(() => strictVerifier.inspect(forged({ entryAttemptId: 'invalid.attempt' })), /entryAttemptId/)
  assert.equal(
    strictVerifier.inspect(forged({ roomKind: 'match', purpose: 'rejoin', roomExpiresAt: undefined, roomSettings: undefined })).purpose,
    'rejoin',
  )
  assert.throws(() => strictVerifier.inspect(forged({ roomExpiresAt: signedClaims.exp * 1000 - 1 })), /租约/)
  assert.throws(() => strictVerifier.inspect(forged({ roomExpiresAt: platformNow + 31 * 24 * 60 * 60 * 1000 })), /租约/)
  const { mode: _mode, ...nonCanonicalSettings } = settings
  assert.throws(() => strictVerifier.inspect(forged({ roomSettings: nonCanonicalSettings })), /规范格式/)
  assert.throws(() => strictVerifier.inspect(forged({ roomKind: 'match' })), /不能携带好友房字段/)

  const consumedVerifier = new GameTicketVerifier({ secret: ticketSecret, required: true, now: () => platformNow })
  const firstBinding = consumedVerifier.inspectWithConsumptionStatus(forged({})).claims
  consumedVerifier.consume(firstBinding)
  assert.throws(
    () => consumedVerifier.inspectWithConsumptionStatus(forged({ roomSettings: { ...settings, rounds: 12 } })),
    /消费记录不一致/,
    '同一 jti 的好友房设置不能被另一张有效签名票替换',
  )
  assert.throws(
    () => consumedVerifier.inspectWithConsumptionStatus(forged({ entryAttemptId: 'friend-strict-attempt-0002' })),
    /消费记录不一致/,
    '同一 jti 不能改绑另一 entryAttemptId',
  )

  const duplicateCreate = await call(baseUrl, '/api/v1/friend-rooms/create', {
    method: 'POST', token: players[0].token, body: createBody,
  })
  assert.deepEqual(duplicateCreate.payload.data.entry, hostEntry, '创建请求重试必须返回同一房间和票据')
  const settingsConflict = await call(baseUrl, '/api/v1/friend-rooms/create', {
    method: 'POST',
    token: players[0].token,
    body: { ...createBody, roomSettings: { ...settings, rounds: 12 } },
  })
  assert.equal(settingsConflict.status, 409)
  assert.equal(settingsConflict.payload.error.code, 'IDEMPOTENCY_CONFLICT', 'roomSettings 必须纳入创建幂等指纹')
  const activeCreateConflict = await call(baseUrl, '/api/v1/friend-rooms/create', {
    method: 'POST',
    token: players[0].token,
    body: { entryAttemptId: 'friend-create-attempt-0002', roomSettings: settings },
  })
  assert.equal(activeCreateConflict.status, 409)
  assert.equal(activeCreateConflict.payload.error.code, 'ALREADY_MATCHING')

  const fakeInvite = 'Z'.repeat(32)
  const wrongInvite = await call(baseUrl, '/api/v1/friend-rooms/join', {
    method: 'POST',
    token: players[4].token,
    body: { entryAttemptId: 'friend-join-wrong-code-1', roomId: hostEntry.roomId, inviteCode: fakeInvite },
  })
  const unknownRoom = await call(baseUrl, '/api/v1/friend-rooms/join', {
    method: 'POST',
    token: players[4].token,
    body: { entryAttemptId: 'friend-join-unknown-room', roomId: hostEntry.roomId === '999999' ? '999998' : '999999', inviteCode: hostEntry.inviteCode },
  })
  assert.equal(wrongInvite.status, 404)
  assert.equal(unknownRoom.status, 404)
  assert.deepEqual(wrongInvite.payload.error, unknownRoom.payload.error, '错误邀请码与未知房间不得形成枚举旁路')
  assert.equal(wrongInvite.payload.error.code, 'FRIEND_ROOM_UNAVAILABLE')

  const joinBodies = [1, 2, 3].map(index => ({
    entryAttemptId: `friend-join-attempt-000${index}`,
    roomId: hostEntry.roomId,
    inviteCode: hostEntry.inviteCode,
  }))
  const joinedResponses = await Promise.all(joinBodies.map((body, index) => call(baseUrl, '/api/v1/friend-rooms/join', {
    method: 'POST', token: players[index + 1].token, body,
  })))
  assert.ok(joinedResponses.every(response => response.status === 200), '三个并发加入请求必须原子预留不同席位')
  const joinedEntries = joinedResponses.map(response => response.payload.data.entry)
  assert.deepEqual(new Set(joinedEntries.map(entry => entry.seat)), new Set(['p2', 'p3', 'p4']))
  assert.ok(joinedEntries.every(entry => entry.roomId === hostEntry.roomId && !('inviteCode' in entry)))
  for (let index = 0; index < joinedEntries.length; index += 1) {
    const entry = joinedEntries[index]
    const claims = verifyCompactToken(entry.gameTicket, ticketSecret, {
      now: platformNow,
      kind: 'game-ticket',
      audience: 'guandan-game',
    })
    assert.equal(claims.sub, players[index + 1].userId)
    assert.equal(claims.seat, entry.seat)
    assert.equal(claims.roomKind, 'friend')
    assert.equal(claims.entryAttemptId, joinBodies[index].entryAttemptId)
    assert.equal(claims.roomExpiresAt, hostEntry.roomExpiresAt)
    assert.deepEqual(claims.roomSettings, settings, '四席票据必须绑定同一份房间设置')
  }
  const matchedState = await runtime.store.read(state => state.matches[hostEntry.matchId])
  assert.equal(matchedState.status, 'matched', '好友房只有四席到齐后才能 matched')
  assert.equal(new Set(matchedState.participants.filter(item => item.status === 'matched').map(item => item.seat)).size, 4)

  const duplicateJoin = await call(baseUrl, '/api/v1/friend-rooms/join', {
    method: 'POST', token: players[1].token, body: joinBodies[0],
  })
  assert.deepEqual(duplicateJoin.payload.data.entry, joinedEntries[0], '加入请求重试必须返回同一席位和票据')
  const changedJoinAttempt = await call(baseUrl, '/api/v1/friend-rooms/join', {
    method: 'POST',
    token: players[1].token,
    body: { ...joinBodies[0], roomId: hostEntry.roomId === '111111' ? '111112' : '111111' },
  })
  assert.equal(changedJoinAttempt.status, 409)
  assert.equal(changedJoinAttempt.payload.error.code, 'IDEMPOTENCY_CONFLICT')

  const fullRoom = await call(baseUrl, '/api/v1/friend-rooms/join', {
    method: 'POST',
    token: players[4].token,
    body: { entryAttemptId: 'friend-join-full-room-1', roomId: hostEntry.roomId, inviteCode: hostEntry.inviteCode },
  })
  assert.equal(fullRoom.status, 409)
  assert.equal(fullRoom.payload.error.code, 'FRIEND_ROOM_FULL')

  const activeQuick = await call(baseUrl, '/api/v1/match/join', {
    method: 'POST', token: players[5].token, body: { mode: 'quick' },
  })
  assert.equal(activeQuick.status, 200)
  const activeJoinConflict = await call(baseUrl, '/api/v1/friend-rooms/join', {
    method: 'POST',
    token: players[5].token,
    body: { entryAttemptId: 'friend-join-active-user', roomId: hostEntry.roomId, inviteCode: hostEntry.inviteCode },
  })
  assert.equal(activeJoinConflict.status, 409)
  assert.equal(activeJoinConflict.payload.error.code, 'ALREADY_MATCHING')
  await call(baseUrl, '/api/v1/match/cancel', {
    method: 'POST', token: players[5].token, body: { matchId: activeQuick.payload.data.match.matchId },
  })

  const oldHostTicket = hostEntry.gameTicket
  const oldJoinTicket = joinedEntries[0].gameTicket
  platformNow += 2_500
  const hostRecoveryAttemptT1 = 'friend-host-recovery-attempt-t1'
  const hostRecoveryAttemptT2 = 'friend-host-recovery-attempt-t2'
  const guestRecoveryAttemptT1 = 'friend-guest-recovery-attempt-t1'
  const anonymousRecovery = await call(baseUrl, '/api/v1/friend-rooms/active', {
    method: 'POST', body: { recoveryAttemptId: 'anonymous-recovery-attempt-01' },
  })
  assert.equal(anonymousRecovery.status, 401)
  const malformedRecovery = await call(baseUrl, '/api/v1/friend-rooms/active', {
    method: 'POST', token: players[9].token, body: { recoveryAttemptId: 'invalid.recovery' },
  })
  assert.equal(malformedRecovery.status, 400)
  assert.equal(malformedRecovery.payload.error.code, 'INVALID_RECOVERY_ATTEMPT_ID')
  const noActiveRecovery = await call(baseUrl, '/api/v1/friend-rooms/active', {
    method: 'POST', token: players[9].token, body: { recoveryAttemptId: 'no-active-recovery-attempt-01' },
  })
  assert.equal(noActiveRecovery.status, 200)
  assert.equal(noActiveRecovery.payload.data.entry, null)
  const recoveredHost = await call(baseUrl, '/api/v1/friend-rooms/active', {
    method: 'POST', token: players[0].token, body: { recoveryAttemptId: hostRecoveryAttemptT1 },
  })
  const recoveredHostDuplicate = await call(baseUrl, '/api/v1/friend-rooms/active', {
    method: 'POST', token: players[0].token, body: { recoveryAttemptId: hostRecoveryAttemptT1 },
  })
  const recoveredGuest = await call(baseUrl, '/api/v1/friend-rooms/active', {
    method: 'POST', token: players[1].token, body: { recoveryAttemptId: guestRecoveryAttemptT1 },
  })
  assert.equal(recoveredHost.status, 200)
  assert.equal(recoveredGuest.status, 200)
  assert.deepEqual(recoveredHostDuplicate.payload.data.entry, recoveredHost.payload.data.entry, '同一 recoveryAttemptId 必须重放同一票据/JTI')
  assert.equal(recoveredHost.payload.data.entry.roomId, hostEntry.roomId)
  assert.equal(recoveredHost.payload.data.entry.seat, 'p1')
  assert.equal(recoveredHost.payload.data.entry.ticketPurpose, 'entry')
  assert.equal(recoveredHost.payload.data.entry.entryAttemptId, hostRecoveryAttemptT1)
  assert.equal(recoveredHost.payload.data.entry.recoveryAttemptId, hostRecoveryAttemptT1)
  assert.equal(recoveredHost.payload.data.entry.roomExpiresAt, hostEntry.roomExpiresAt)
  assert.notEqual(recoveredHost.payload.data.entry.gameTicket, oldHostTicket)
  assert.equal(recoveredHost.payload.data.entry.inviteText, hostEntry.inviteText, '房主冷启动可恢复完整邀请载荷')
  assert.equal(recoveredGuest.payload.data.entry.roomId, hostEntry.roomId)
  assert.equal(recoveredGuest.payload.data.entry.seat, joinedEntries[0].seat)
  assert.equal(recoveredGuest.payload.data.entry.ticketPurpose, 'entry')
  assert.equal(recoveredGuest.payload.data.entry.entryAttemptId, guestRecoveryAttemptT1)
  assert.equal(recoveredGuest.payload.data.entry.recoveryAttemptId, guestRecoveryAttemptT1)
  assert.notEqual(recoveredGuest.payload.data.entry.gameTicket, oldJoinTicket)
  assert.equal('inviteCode' in recoveredGuest.payload.data.entry, false, '访客恢复接口不得泄露邀请密钥')
  assert.equal('invitePayload' in recoveredGuest.payload.data.entry, false)
  assert.equal('inviteText' in recoveredGuest.payload.data.entry, false)
  const recoveredHostClaims = strictVerifier.inspect(recoveredHost.payload.data.entry.gameTicket)
  assert.equal(recoveredHostClaims.entryAttemptId, hostRecoveryAttemptT1)
  const rotatedHostRecovery = await call(baseUrl, '/api/v1/friend-rooms/active', {
    method: 'POST', token: players[0].token, body: { recoveryAttemptId: hostRecoveryAttemptT2 },
  })
  assert.notEqual(rotatedHostRecovery.payload.data.entry.gameTicket, recoveredHost.payload.data.entry.gameTicket, '新 recoveryAttemptId 必须签发新 JTI')
  assert.notEqual(
    strictVerifier.inspect(rotatedHostRecovery.payload.data.entry.gameTicket).jti,
    recoveredHostClaims.jti,
  )
  assert.equal(rotatedHostRecovery.payload.data.entry.entryAttemptId, hostRecoveryAttemptT2)
  const replayedHostAfterRotation = await call(baseUrl, '/api/v1/friend-rooms/active', {
    method: 'POST', token: players[0].token, body: { recoveryAttemptId: hostRecoveryAttemptT1 },
  })
  assert.equal(
    replayedHostAfterRotation.payload.data.entry.gameTicket,
    recoveredHost.payload.data.entry.gameTicket,
    '签出 T2 后重放 T1 仍必须返回持久 receipt 中的原 JTI',
  )
  assert.equal(
    await runtime.store.read(state => state.matches[hostEntry.matchId]
      .participants.find(item => item.userId === players[0].userId)
      .recoveryAttempts[hostRecoveryAttemptT1].entry.gameTicket),
    recoveredHost.payload.data.entry.gameTicket,
    '恢复 attempt receipt 必须持久在 participant 状态内',
  )
  const reissuedHost = await call(baseUrl, '/api/v1/friend-rooms/create', {
    method: 'POST', token: players[0].token, body: createBody,
  })
  const reissuedJoin = await call(baseUrl, '/api/v1/friend-rooms/join', {
    method: 'POST', token: players[1].token, body: joinBodies[0],
  })
  assert.equal(reissuedHost.status, 200)
  assert.equal(reissuedJoin.status, 200)
  assert.equal(reissuedHost.payload.data.entry.roomId, hostEntry.roomId)
  assert.equal(reissuedHost.payload.data.entry.inviteCode, hostEntry.inviteCode)
  assert.equal(reissuedHost.payload.data.entry.seat, 'p1')
  assert.equal(reissuedHost.payload.data.entry.roomExpiresAt, hostEntry.roomExpiresAt, '短期票据重签不得改变好友房租约')
  assert.equal(reissuedJoin.payload.data.entry.seat, joinedEntries[0].seat)
  assert.equal(
    strictVerifier.inspect(reissuedHost.payload.data.entry.gameTicket).entryAttemptId,
    createBody.entryAttemptId,
    '原 create attempt 重试签出的票仍必须绑定原 entryAttemptId',
  )
  assert.equal(
    strictVerifier.inspect(reissuedJoin.payload.data.entry.gameTicket).entryAttemptId,
    joinBodies[0].entryAttemptId,
  )
  assert.throws(() => verifyCompactToken(oldHostTicket, ticketSecret, {
    now: platformNow, kind: 'game-ticket', audience: 'guandan-game',
  }), /过期/)
  assert.deepEqual(
    verifyCompactToken(reissuedHost.payload.data.entry.gameTicket, ticketSecret, {
      now: platformNow, kind: 'game-ticket', audience: 'guandan-game',
    }).roomSettings,
    settings,
    '重签不得改变好友房设置 claims',
  )
  assert.equal(await runtime.store.read(state => state.matches[hostEntry.matchId].status), 'matched', '票据过期不得取消好友房分配')

  const spectatorReporter = new SpectatorEventReporter({
    endpoint: `${baseUrl}/api/v1/game/spectator-events`,
    secret: spectatorSecret,
    lifecycleSecret: resultSecret,
    maxAttempts: 1,
  })
  const voluntaryIndex = 1
  const voluntaryEntry = joinedEntries[voluntaryIndex]
  const voluntaryPlayer = players[voluntaryIndex + 1]
  const voluntaryRecoveryT1 = await call(baseUrl, '/api/v1/matches/recover', {
    method: 'POST', token: voluntaryPlayer.token, body: { recoveryAttemptId: 'friend-voluntary-recovery-t1' },
  })
  const voluntaryRecoveryT2 = await call(baseUrl, '/api/v1/matches/recover', {
    method: 'POST', token: voluntaryPlayer.token, body: { recoveryAttemptId: 'friend-voluntary-recovery-t2' },
  })
  const voluntaryRecoveryClaims = [voluntaryRecoveryT1, voluntaryRecoveryT2].map(response => (
    strictVerifier.inspect(response.payload.data.entry.gameTicket)
  ))
  assert.notEqual(voluntaryRecoveryClaims[0].jti, voluntaryRecoveryClaims[1].jti)
  const voluntaryLeave = {
    eventId: `spectate:${hostEntry.matchId}:1`,
    matchId: hostEntry.matchId,
    roomId: hostEntry.roomId,
    sequence: 1,
    at: platformNow,
    type: 'seat-left',
    roundSequence: 1,
    playerId: voluntaryEntry.seat,
    reason: 'left',
    userId: voluntaryPlayer.userId,
  }
  const released = await spectatorReporter.report(voluntaryLeave)
  assert.equal(released.duplicate, false)
  assert.ok(
    voluntaryRecoveryClaims.every(claims => released.seatRelease.revokedTickets.some(item => item.jti === claims.jti && item.exp === claims.exp)),
    'seat-left 必须一次返回该席位当前世代所有未过期恢复票 JTI',
  )
  const duplicateRelease = await spectatorReporter.report(voluntaryLeave)
  assert.equal(duplicateRelease.duplicate, true, '同一 seat-left 事件重试必须幂等')
  assert.deepEqual(duplicateRelease.seatRelease.revokedTickets, released.seatRelease.revokedTickets, '幂等回执必须重放相同吊销集合')
  await assert.rejects(
    spectatorReporter.report({ ...voluntaryLeave, reason: 'kicked' }),
    error => error?.status === 409 && error?.code === 'SPECTATOR_EVENT_ID_CONFLICT',
    '同一 eventId 不得改写 seat-left 原因',
  )
  const releasedState = await runtime.store.read(state => ({
    match: state.matches[hostEntry.matchId],
    active: state.activeMatchByUser[voluntaryPlayer.userId] || null,
  }))
  assert.equal(releasedState.match.status, 'matching')
  assert.equal(releasedState.active, null)
  const voluntaryRecord = releasedState.match.participants.find(item => item.userId === voluntaryPlayer.userId)
  assert.equal(voluntaryRecord.status, 'cancelled')
  assert.equal(voluntaryRecord.leaveReason, 'left')
  assert.ok(voluntaryRecord.ticketRevokedAt)
  assert.equal(voluntaryRecord.gameTicket, undefined)

  const voluntaryReplacementBody = {
    entryAttemptId: 'friend-seat-replacement-1',
    roomId: hostEntry.roomId,
    inviteCode: hostEntry.inviteCode,
  }
  const voluntaryReplacement = await call(baseUrl, '/api/v1/friend-rooms/join', {
    method: 'POST', token: players[4].token, body: voluntaryReplacementBody,
  })
  assert.equal(voluntaryReplacement.status, 200)
  assert.equal(voluntaryReplacement.payload.data.entry.seat, voluntaryEntry.seat, '已确认离席必须立即释放原席位供补位')
  assert.deepEqual(
    verifyCompactToken(voluntaryReplacement.payload.data.entry.gameTicket, ticketSecret, {
      now: platformNow, kind: 'game-ticket', audience: 'guandan-game',
    }).roomSettings,
    settings,
  )
  assert.equal(await runtime.store.read(state => state.matches[hostEntry.matchId].status), 'matched')

  const kickedEntry = reissuedJoin.payload.data.entry
  const kickedTicket = kickedEntry.gameTicket
  const kickedEvent = {
    eventId: `spectate:${hostEntry.matchId}:2`,
    matchId: hostEntry.matchId,
    roomId: hostEntry.roomId,
    sequence: 2,
    at: platformNow,
    type: 'seat-left',
    roundSequence: 1,
    playerId: kickedEntry.seat,
    reason: 'kicked',
    userId: players[1].userId,
  }
  await spectatorReporter.report(kickedEvent)
  assert.equal(
    verifyCompactToken(kickedTicket, ticketSecret, {
      now: platformNow, kind: 'game-ticket', audience: 'guandan-game',
    }).sub,
    players[1].userId,
    '被踢时旧自包含票可能仍在密码学有效期内，必须依赖牌局服持久黑名单拒绝',
  )
  const kickedRetry = await call(baseUrl, '/api/v1/friend-rooms/join', {
    method: 'POST', token: players[1].token, body: joinBodies[0],
  })
  assert.equal(kickedRetry.status, 403)
  assert.equal(kickedRetry.payload.error.code, 'FRIEND_ROOM_BANNED')
  const kickedNewAttempt = await call(baseUrl, '/api/v1/friend-rooms/join', {
    method: 'POST',
    token: players[1].token,
    body: { ...joinBodies[0], entryAttemptId: 'friend-kicked-new-attempt' },
  })
  assert.equal(kickedNewAttempt.status, 403, '被踢用户换 entryAttemptId 也不得重签')
  assert.equal(kickedNewAttempt.payload.error.code, 'FRIEND_ROOM_BANNED')
  const kickedReplacement = await call(baseUrl, '/api/v1/friend-rooms/join', {
    method: 'POST',
    token: players[5].token,
    body: { entryAttemptId: 'friend-seat-replacement-2', roomId: hostEntry.roomId, inviteCode: hostEntry.inviteCode },
  })
  assert.equal(kickedReplacement.status, 200)
  assert.equal(kickedReplacement.payload.data.entry.seat, kickedEntry.seat)

  const gameStart = {
    eventId: `spectate:${hostEntry.matchId}:3`,
    matchId: hostEntry.matchId,
    roomId: hostEntry.roomId,
    sequence: 3,
    at: platformNow,
    type: 'game-start',
    roundSequence: 1,
  }
  const claimed = await spectatorReporter.claimStart(gameStart)
  assert.equal(claimed.lifecycleClaim.status, 'playing')
  const playingState = await runtime.store.read(state => state.matches[hostEntry.matchId])
  assert.equal(playingState.status, 'playing')
  assert.equal(playingState.participants.filter(item => item.status === 'playing').length, 4)
  const frozenPlayingRoomExpiresAt = playingState.friendRoomExpiresAt
  platformNow = Math.max(platformNow + 2_500, frozenPlayingRoomExpiresAt + 1)
  const playingUserIds = playingState.participants.filter(item => item.status === 'playing').map(item => item.userId)
  const playingRecoveryAttempts = playingUserIds.map((_, index) => `friend-playing-recovery-t1-0${index}`)
  const playingRecoveries = await Promise.all(playingUserIds.map((userId, index) => {
    const player = players.find(item => item.userId === userId)
    return call(baseUrl, '/api/v1/matches/recover', {
      method: 'POST', token: player.token, body: { recoveryAttemptId: playingRecoveryAttempts[index] },
    })
  }))
  assert.ok(playingRecoveries.every(response => response.status === 200 && response.payload.data.entry.ticketPurpose === 'rejoin'))
  assert.deepEqual(new Set(playingRecoveries.map(response => response.payload.data.entry.seat)), new Set(['p1', 'p2', 'p3', 'p4']))
  for (let index = 0; index < playingRecoveries.length; index += 1) {
    const entry = playingRecoveries[index].payload.data.entry
    const claims = strictVerifier.inspect(entry.gameTicket)
    assert.equal(claims.purpose, 'rejoin')
    assert.equal(claims.sub, playingUserIds[index])
    assert.equal(claims.matchId, hostEntry.matchId)
    assert.equal(claims.roomId, hostEntry.roomId)
    assert.equal(claims.seat, entry.seat)
    assert.equal(claims.entryAttemptId, playingRecoveryAttempts[index])
    assert.equal(entry.entryAttemptId, playingRecoveryAttempts[index])
    assert.equal(entry.recoveryAttemptId, playingRecoveryAttempts[index])
    assert.equal(entry.roomExpiresAt, frozenPlayingRoomExpiresAt)
    assert.equal(claims.roomExpiresAt, frozenPlayingRoomExpiresAt)
    assert.ok(claims.roomExpiresAt < platformNow, 'playing rejoin 必须允许保留已经过去的原 lobby lease')
    assert.ok(claims.exp * 1000 > platformNow, 'rejoin 短票 exp 必须独立于已经过去的 lobby lease')
    assert.equal('inviteCode' in entry, false, 'playing 冷启动恢复不得重新暴露邀请凭据')
    assert.equal('invitePayload' in entry, false)
    assert.equal('inviteText' in entry, false)
  }
  assert.equal(
    await runtime.store.read(state => state.matches[hostEntry.matchId].friendRoomExpiresAt),
    frozenPlayingRoomExpiresAt,
    'rejoin 绝不能续期或改写好友房 lobby lease',
  )
  const wsConsumptionVerifier = new GameTicketVerifier({ secret: ticketSecret, required: true, now: () => platformNow })
  const firstPlayingClaims = wsConsumptionVerifier.inspect(playingRecoveries[0].payload.data.entry.gameTicket)
  wsConsumptionVerifier.consume(firstPlayingClaims)
  const samePlayingRecovery = await call(baseUrl, '/api/v1/matches/recover', {
    method: 'POST', token: players.find(item => item.userId === playingUserIds[0]).token,
    body: { recoveryAttemptId: playingRecoveryAttempts[0] },
  })
  assert.equal(samePlayingRecovery.payload.data.entry.gameTicket, playingRecoveries[0].payload.data.entry.gameTicket)
  const nextPlayingAttempt = 'friend-playing-recovery-t2-00'
  const nextPlayingRecovery = await call(baseUrl, '/api/v1/matches/recover', {
    method: 'POST', token: players.find(item => item.userId === playingUserIds[0]).token,
    body: { recoveryAttemptId: nextPlayingAttempt },
  })
  const nextPlayingClaims = wsConsumptionVerifier.inspect(nextPlayingRecovery.payload.data.entry.gameTicket)
  assert.notEqual(nextPlayingClaims.jti, firstPlayingClaims.jti, '消费 T1 后新 recoveryAttemptId 必须得到可用的新 JTI')
  assert.equal(nextPlayingClaims.entryAttemptId, nextPlayingAttempt)
  const hiddenFeed = await call(baseUrl, '/api/v1/spectate')
  assert.ok(!hiddenFeed.payload.data.feeds.some(feed => feed.matchId === hostEntry.matchId), 'spectator=off 的好友房不得进入公开观战列表')

  await spectatorReporter.report({
    eventId: `spectate:${hostEntry.matchId}:4`,
    matchId: hostEntry.matchId,
    roomId: hostEntry.roomId,
    sequence: 4,
    at: platformNow,
    type: 'room-closed',
    roundSequence: 1,
    reason: 'start-participant-lost',
  })
  const closedState = await runtime.store.read(state => ({
    match: state.matches[hostEntry.matchId],
    active: players.slice(0, 6).map(player => state.activeMatchByUser[player.userId] || null),
  }))
  assert.equal(closedState.match.status, 'aborted')
  assert.equal(closedState.match.abortReason, 'start-participant-lost')
  assert.deepEqual(closedState.active, [null, null, null, null, null, null], 'room-close 必须释放当前与历史席位 activeMatch')

  const publicCreated = await call(baseUrl, '/api/v1/friend-rooms/create', {
    method: 'POST',
    token: players[0].token,
    body: {
      entryAttemptId: 'friend-public-create-01',
      roomSettings: { ...settings, spectator: 'live' },
    },
  })
  const publicEntry = publicCreated.payload.data.entry
  const publicGuest = await call(baseUrl, '/api/v1/friend-rooms/join', {
    method: 'POST',
    token: players[1].token,
    body: {
      entryAttemptId: 'friend-public-guest-001',
      roomId: publicEntry.roomId,
      inviteCode: publicEntry.inviteCode,
    },
  })
  const publicLeave = {
    eventId: `spectate:${publicEntry.matchId}:1`,
    matchId: publicEntry.matchId,
    roomId: publicEntry.roomId,
    sequence: 1,
    at: platformNow,
    type: 'seat-left',
    roundSequence: 1,
    playerId: publicGuest.payload.data.entry.seat,
    reason: 'left',
    userId: players[1].userId,
  }
  await spectatorReporter.report(publicLeave)
  platformNow += 15_001
  const publicFeed = await call(baseUrl, `/api/v1/spectate/${encodeURIComponent(publicEntry.matchId)}?delaySeconds=15`)
  assert.equal(publicFeed.status, 200)
  assert.equal(publicFeed.payload.data.feed.events[0].type, 'seat-left')
  assert.equal(publicFeed.payload.data.feed.events[0].playerId, publicGuest.payload.data.entry.seat)
  assert.equal('userId' in publicFeed.payload.data.feed.events[0], false, '公开 seat-left DTO 不得暴露平台 userId')
  await spectatorReporter.report({
    eventId: `spectate:${publicEntry.matchId}:2`,
    matchId: publicEntry.matchId,
    roomId: publicEntry.roomId,
    sequence: 2,
    at: platformNow,
    type: 'room-closed',
    roundSequence: 1,
    reason: 'host-left',
  })

  let cancelOrder = 0
  const createTwoSeatRoom = async (label) => {
    cancelOrder += 1
    const host = await call(baseUrl, '/api/v1/friend-rooms/create', {
      method: 'POST',
      token: players[0].token,
      body: { entryAttemptId: `friend-${label}-host-${cancelOrder}`, roomSettings: settings },
    })
    assert.equal(host.status, 200)
    const entry = host.payload.data.entry
    const guest = await call(baseUrl, '/api/v1/friend-rooms/join', {
      method: 'POST',
      token: players[1].token,
      body: {
        entryAttemptId: `friend-${label}-guest-${cancelOrder}`,
        roomId: entry.roomId,
        inviteCode: entry.inviteCode,
      },
    })
    assert.equal(guest.status, 200)
    assert.equal(await runtime.store.read(state => state.matches[entry.matchId].status), 'matching')
    return { host: entry, guest: guest.payload.data.entry }
  }
  const closeTwoSeatRoom = room => spectatorReporter.report({
    eventId: `spectate:${room.host.matchId}:2`,
    matchId: room.host.matchId,
    roomId: room.host.roomId,
    sequence: 2,
    at: platformNow,
    type: 'room-closed',
    roundSequence: 1,
    reason: 'host-left',
  })

  const cancelThenEventRoom = await createTwoSeatRoom('cancel-first')
  const guestCancelledFirst = await call(baseUrl, '/api/v1/match/cancel', {
    method: 'POST',
    token: players[1].token,
    body: { matchId: cancelThenEventRoom.host.matchId },
  })
  assert.equal(guestCancelledFirst.status, 200)
  assert.equal(guestCancelledFirst.payload.data.match.status, 'cancelled')
  const pendingOldAttemptJoin = await call(baseUrl, '/api/v1/friend-rooms/join', {
    method: 'POST', token: players[1].token,
    body: {
      entryAttemptId: cancelThenEventRoom.guest.entryAttemptId,
      roomId: cancelThenEventRoom.host.roomId,
      inviteCode: cancelThenEventRoom.host.inviteCode,
    },
  })
  const pendingNewAttemptJoin = await call(baseUrl, '/api/v1/friend-rooms/join', {
    method: 'POST', token: players[1].token,
    body: {
      entryAttemptId: 'friend-cancel-pending-new-attempt',
      roomId: cancelThenEventRoom.host.roomId,
      inviteCode: cancelThenEventRoom.host.inviteCode,
    },
  })
  const pendingRecovery = await call(baseUrl, '/api/v1/matches/recover', {
    method: 'POST', token: players[1].token,
    body: { recoveryAttemptId: 'friend-cancel-pending-recovery' },
  })
  for (const pending of [pendingOldAttemptJoin, pendingNewAttemptJoin, pendingRecovery]) {
    assert.equal(pending.status, 409)
    assert.equal(pending.payload.error.code, 'FRIEND_SEAT_RELEASE_PENDING')
  }
  const confirmedLeave = await spectatorReporter.report({
    eventId: `spectate:${cancelThenEventRoom.host.matchId}:1`,
    matchId: cancelThenEventRoom.host.matchId,
    roomId: cancelThenEventRoom.host.roomId,
    sequence: 1,
    at: platformNow,
    type: 'seat-left',
    roundSequence: 1,
    playerId: cancelThenEventRoom.guest.seat,
    reason: 'left',
    userId: players[1].userId,
  })
  assert.equal(confirmedLeave.accepted, true, 'guest cancel 先到后 seat-left 必须确认并让 outbox 排空')
  const guestCancelAfterEvent = await call(baseUrl, '/api/v1/match/cancel', {
    method: 'POST', token: players[1].token, body: { matchId: cancelThenEventRoom.host.matchId },
  })
  assert.equal(guestCancelAfterEvent.status, 200)
  const revokedAttemptJoin = await call(baseUrl, '/api/v1/friend-rooms/join', {
    method: 'POST', token: players[1].token,
    body: {
      entryAttemptId: cancelThenEventRoom.guest.entryAttemptId,
      roomId: cancelThenEventRoom.host.roomId,
      inviteCode: cancelThenEventRoom.host.inviteCode,
    },
  })
  assert.equal(revokedAttemptJoin.status, 409)
  assert.equal(revokedAttemptJoin.payload.error.code, 'FRIEND_ENTRY_ATTEMPT_REVOKED')
  const rejoinedAfterConfirmation = await call(baseUrl, '/api/v1/friend-rooms/join', {
    method: 'POST', token: players[1].token,
    body: {
      entryAttemptId: 'friend-cancel-confirmed-rejoin',
      roomId: cancelThenEventRoom.host.roomId,
      inviteCode: cancelThenEventRoom.host.inviteCode,
    },
  })
  assert.equal(rejoinedAfterConfirmation.status, 200, '双签 seat-left 确认后新 attempt 才能重新入席')
  assert.equal(rejoinedAfterConfirmation.payload.data.entry.seat, cancelThenEventRoom.guest.seat)
  await closeTwoSeatRoom(cancelThenEventRoom)

  const eventThenCancelRoom = await createTwoSeatRoom('event-first')
  await spectatorReporter.report({
    eventId: `spectate:${eventThenCancelRoom.host.matchId}:1`,
    matchId: eventThenCancelRoom.host.matchId,
    roomId: eventThenCancelRoom.host.roomId,
    sequence: 1,
    at: platformNow,
    type: 'seat-left',
    roundSequence: 1,
    playerId: eventThenCancelRoom.guest.seat,
    reason: 'left',
    userId: players[1].userId,
  })
  const guestCancelledAfter = await call(baseUrl, '/api/v1/match/cancel', {
    method: 'POST', token: players[1].token, body: { matchId: eventThenCancelRoom.host.matchId },
  })
  assert.equal(guestCancelledAfter.status, 200, 'seat-left 先到后 guest cancel 必须幂等')
  assert.equal(guestCancelledAfter.payload.data.match.status, 'cancelled')
  await closeTwoSeatRoom(eventThenCancelRoom)

  const hostCancelFirstRoom = await createTwoSeatRoom('host-cancel-first')
  const hostCancelled = await call(baseUrl, '/api/v1/match/cancel', {
    method: 'POST', token: players[0].token, body: { matchId: hostCancelFirstRoom.host.matchId },
  })
  assert.equal(hostCancelled.status, 200)
  assert.equal(hostCancelled.payload.data.match.status, 'cancelled')
  const closeAfterCancel = await spectatorReporter.report({
    eventId: `spectate:${hostCancelFirstRoom.host.matchId}:1`,
    matchId: hostCancelFirstRoom.host.matchId,
    roomId: hostCancelFirstRoom.host.roomId,
    sequence: 1,
    at: platformNow,
    type: 'room-closed',
    roundSequence: 1,
    reason: 'start-rejected',
  })
  assert.equal(closeAfterCancel.ignored, true, 'host cancel 先到后同终态 room-closed 必须幂等确认')

  const roomCloseFirstRoom = await createTwoSeatRoom('room-close-first')
  await spectatorReporter.report({
    eventId: `spectate:${roomCloseFirstRoom.host.matchId}:1`,
    matchId: roomCloseFirstRoom.host.matchId,
    roomId: roomCloseFirstRoom.host.roomId,
    sequence: 1,
    at: platformNow,
    type: 'room-closed',
    roundSequence: 1,
    reason: 'host-left',
  })
  const hostCancelAfterClose = await call(baseUrl, '/api/v1/match/cancel', {
    method: 'POST', token: players[0].token, body: { matchId: roomCloseFirstRoom.host.matchId },
  })
  assert.equal(hostCancelAfterClose.status, 200, 'room-closed 先到后 host cancel 必须幂等')
  assert.equal(hostCancelAfterClose.payload.data.match.status, 'aborted')

  let configuredEndOrder = 0
  const createStartedFriendRoom = async (label, roomSettings) => {
    configuredEndOrder += 1
    const createdRoom = await call(baseUrl, '/api/v1/friend-rooms/create', {
      method: 'POST',
      token: players[0].token,
      body: { entryAttemptId: `friend-${label}-host-${configuredEndOrder}`, roomSettings },
    })
    assert.equal(createdRoom.status, 200)
    const entry = createdRoom.payload.data.entry
    for (let index = 1; index <= 3; index += 1) {
      const joined = await call(baseUrl, '/api/v1/friend-rooms/join', {
        method: 'POST',
        token: players[index].token,
        body: {
          entryAttemptId: `friend-${label}-guest-${configuredEndOrder}-${index}`,
          roomId: entry.roomId,
          inviteCode: entry.inviteCode,
        },
      })
      assert.equal(joined.status, 200)
    }
    const startEvent = {
      eventId: `spectate:${entry.matchId}:1`,
      matchId: entry.matchId,
      roomId: entry.roomId,
      sequence: 1,
      at: platformNow,
      type: 'game-start',
      roundSequence: 1,
    }
    await spectatorReporter.claimStart(startEvent)
    return entry
  }

  const economyBeforeConfiguredEnd = await runtime.store.read(state => ({
    ledgerCount: state.ledgerEntries.length,
    gameResultCount: Object.keys(state.gameResults).length,
    stats: players.slice(0, 4).map(player => structuredClone(state.userStats[player.userId])),
  }))
  const roundLimitEntry = await createStartedFriendRoom('round-limit', { ...settings, spectator: 'live' })
  const roundLimitEnd = {
    eventId: `spectate:${roundLimitEntry.matchId}:2`,
    matchId: roundLimitEntry.matchId,
    roomId: roundLimitEntry.roomId,
    sequence: 2,
    at: platformNow,
    type: 'match-ended',
    roundSequence: settings.rounds,
    reason: 'round-limit',
    scores: { teamA: 12, teamB: 8 },
    roundsPlayed: settings.rounds,
    endedAt: platformNow,
    winnerTeam: 'teamA',
  }
  const unsignedLifecycleBody = JSON.stringify(roundLimitEnd)
  const unsignedLifecycleTimestamp = String(Date.now())
  const spectatorOnlyEnd = await fetch(`${baseUrl}/api/v1/game/spectator-events`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-spectator-event-id': roundLimitEnd.eventId,
      'x-spectator-timestamp': unsignedLifecycleTimestamp,
      'x-spectator-signature': spectatorEventSignature(unsignedLifecycleBody, spectatorSecret, unsignedLifecycleTimestamp),
    },
    body: unsignedLifecycleBody,
  })
  assert.equal(spectatorOnlyEnd.status, 401, 'match-ended 只有 spectator secret 时必须拒绝')
  const roundLimitAccepted = await spectatorReporter.report(roundLimitEnd)
  assert.equal(roundLimitAccepted.duplicate, false)
  const roundLimitDuplicate = await spectatorReporter.report(roundLimitEnd)
  assert.equal(roundLimitDuplicate.duplicate, true, 'match-ended 重试必须幂等')
  await assert.rejects(
    spectatorReporter.report({ ...roundLimitEnd, scores: { teamA: 13, teamB: 8 } }),
    error => error?.status === 409 && error?.code === 'SPECTATOR_EVENT_ID_CONFLICT',
  )
  const completedByLimit = await runtime.store.read(state => ({
    match: state.matches[roundLimitEntry.matchId],
    active: players.slice(0, 4).map(player => state.activeMatchByUser[player.userId] || null),
    ledgerCount: state.ledgerEntries.length,
    gameResultCount: Object.keys(state.gameResults).length,
    stats: players.slice(0, 4).map(player => structuredClone(state.userStats[player.userId])),
  }))
  assert.equal(completedByLimit.match.status, 'completed')
  assert.equal(completedByLimit.match.completionReason, 'round-limit')
  assert.deepEqual(completedByLimit.match.friendMatchEnd, {
    reason: 'round-limit',
    scores: { teamA: 12, teamB: 8 },
    roundsPlayed: settings.rounds,
    endedAt: platformNow,
    winnerTeam: 'teamA',
  })
  assert.deepEqual(completedByLimit.active, [null, null, null, null])
  assert.equal(completedByLimit.ledgerCount, economyBeforeConfiguredEnd.ledgerCount, '配置终局不得生成积分流水')
  assert.equal(completedByLimit.gameResultCount, economyBeforeConfiguredEnd.gameResultCount, '配置终局不得伪造 GAME_RESULT')
  assert.deepEqual(completedByLimit.stats, economyBeforeConfiguredEnd.stats, '配置终局不得更新排名牌局统计')
  const delayedRoundLimit = await call(baseUrl, `/api/v1/spectate/${encodeURIComponent(roundLimitEntry.matchId)}?delaySeconds=15`)
  assert.equal(delayedRoundLimit.payload.data.feed.status, 'running')
  assert.equal(delayedRoundLimit.payload.data.feed.timelineComplete, false)
  assert.equal(delayedRoundLimit.payload.data.feed.matchEnd, null, '延迟到达前不得泄露终局比分元数据')
  platformNow += 15_001
  const visibleRoundLimit = await call(baseUrl, `/api/v1/spectate/${encodeURIComponent(roundLimitEntry.matchId)}?delaySeconds=15`)
  assert.equal(visibleRoundLimit.payload.data.feed.status, 'finished')
  assert.equal(visibleRoundLimit.payload.data.feed.timelineComplete, true)
  assert.deepEqual(visibleRoundLimit.payload.data.feed.matchEnd, completedByLimit.match.friendMatchEnd)
  assert.equal(visibleRoundLimit.payload.data.feed.events.at(-1).type, 'match-ended')

  const timeLimitEntry = await createStartedFriendRoom('time-limit', { ...settings, spectator: 'live' })
  const timeLimitStartedAt = await runtime.store.read(state => state.matches[timeLimitEntry.matchId].startedAt)
  const timeLimitThreshold = timeLimitStartedAt + settings.totalTimeMinutes * 60_000
  platformNow = timeLimitThreshold
  const timeLimitEnd = {
    eventId: `spectate:${timeLimitEntry.matchId}:2`,
    matchId: timeLimitEntry.matchId,
    roomId: timeLimitEntry.roomId,
    sequence: 2,
    at: platformNow,
    type: 'match-ended',
    roundSequence: 1,
    reason: 'time-limit',
    scores: { teamA: 3, teamB: 1 },
    roundsPlayed: 0,
    endedAt: platformNow,
    winnerTeam: null,
  }
  await assert.rejects(
    spectatorReporter.report({ ...timeLimitEnd, at: timeLimitThreshold - 1, endedAt: timeLimitThreshold - 1 }),
    error => error?.status === 409 && error?.code === 'FRIEND_TIME_LIMIT_EARLY',
    '签名配置时限到达前 1ms 也不得结束好友房',
  )
  await assert.rejects(
    spectatorReporter.report({ ...timeLimitEnd, winnerTeam: 'teamA' }),
    error => error?.status === 409 && error?.code === 'FRIEND_TIME_LIMIT_MUST_DRAW',
    '中局 time-limit 必须明确按 draw 终止',
  )
  const acceptedTimeLimit = await spectatorReporter.report(timeLimitEnd)
  assert.equal(acceptedTimeLimit.duplicate, false)
  assert.equal((await spectatorReporter.report(timeLimitEnd)).duplicate, true, '到达总时限后的终局重试必须幂等')
  const abortedByTime = await runtime.store.read(state => ({
    match: state.matches[timeLimitEntry.matchId],
    active: players.slice(0, 4).map(player => state.activeMatchByUser[player.userId] || null),
    ledgerCount: state.ledgerEntries.length,
    gameResultCount: Object.keys(state.gameResults).length,
  }))
  assert.equal(abortedByTime.match.status, 'aborted')
  assert.equal(abortedByTime.match.abortReason, 'time-limit')
  assert.equal(abortedByTime.match.friendMatchEnd.winnerTeam, null)
  assert.deepEqual(abortedByTime.active, [null, null, null, null])
  assert.equal(abortedByTime.ledgerCount, economyBeforeConfiguredEnd.ledgerCount)
  assert.equal(abortedByTime.gameResultCount, economyBeforeConfiguredEnd.gameResultCount)
  const timeLimitCleanup = await spectatorReporter.report({
    eventId: `spectate:${timeLimitEntry.matchId}:3`,
    matchId: timeLimitEntry.matchId,
    roomId: timeLimitEntry.roomId,
    sequence: 3,
    at: platformNow,
    type: 'room-closed',
    roundSequence: 1,
    reason: 'host-left',
  })
  assert.equal(timeLimitCleanup.ignored, true, 'time-limit 终态后的资源回收必须确认而不重试')

  const waitingCreated = await call(baseUrl, '/api/v1/friend-rooms/create', {
    method: 'POST',
    token: players[6].token,
    body: { entryAttemptId: 'friend-waiting-create-01', roomSettings: settings },
  })
  const waitingEntry = waitingCreated.payload.data.entry
  const prematureStart = {
    eventId: `spectate:${waitingEntry.matchId}:1`,
    matchId: waitingEntry.matchId,
    roomId: waitingEntry.roomId,
    sequence: 1,
    at: platformNow,
    type: 'game-start',
    roundSequence: 1,
  }
  await assert.rejects(
    spectatorReporter.claimStart(prematureStart),
    error => error?.status === 409 && error?.code === 'MATCH_NOT_SPECTATABLE',
    '未满四席的好友房不得取得 game-start claim',
  )
  assert.equal(await runtime.store.read(state => state.matches[waitingEntry.matchId].status), 'matching')
  await spectatorReporter.report({
    ...prematureStart,
    type: 'room-closed',
    reason: 'entry-timeout',
  })
  const waitingClosed = await runtime.store.read(state => ({
    match: state.matches[waitingEntry.matchId],
    active: state.activeMatchByUser[players[6].userId] || null,
  }))
  assert.equal(waitingClosed.match.status, 'aborted')
  assert.equal(waitingClosed.match.abortReason, 'entry-timeout')
  assert.equal(waitingClosed.active, null, '未满员房间的 entry-timeout 也必须释放 activeMatch')

  const expiringCreated = await call(baseUrl, '/api/v1/friend-rooms/create', {
    method: 'POST',
    token: players[7].token,
    body: { entryAttemptId: 'friend-expiring-create-1', roomSettings: settings },
  })
  const expiringEntry = expiringCreated.payload.data.entry
  platformNow = expiringEntry.roomExpiresAt + 1
  const expiredJoin = await call(baseUrl, '/api/v1/friend-rooms/join', {
    method: 'POST',
    token: players[8].token,
    body: {
      entryAttemptId: 'friend-expired-join-01',
      roomId: expiringEntry.roomId,
      inviteCode: expiringEntry.inviteCode,
    },
  })
  assert.equal(expiredJoin.status, 404)
  assert.equal(expiredJoin.payload.error.code, 'FRIEND_ROOM_UNAVAILABLE')
  const expiredState = await runtime.store.read(state => ({
    match: state.matches[expiringEntry.matchId],
    active: state.activeMatchByUser[players[7].userId] || null,
  }))
  assert.equal(expiredState.match.status, 'cancelled')
  assert.equal(expiredState.match.cancelReason, 'friend-room-expired')
  assert.equal(expiredState.active, null, '好友房租约过期必须释放房主 activeMatch')

  const installPlayingMatch = async ({ id, roomId, fixed = false }) => runtime.store.transaction(state => {
    const participants = players.slice(0, 4).map((player, index) => ({
      userId: player.userId,
      status: 'playing',
      seat: `p${index + 1}`,
      joinedAt: platformNow,
      startedAt: platformNow,
      ...runtime.service.gameTickets.issue({
        userId: player.userId,
        matchId: id,
        roomId,
        seat: `p${index + 1}`,
      }),
    }))
    state.matches[id] = {
      id,
      mode: fixed ? 'lingshui_16_cup' : 'quick',
      status: 'playing',
      roomId,
      participants,
      createdAt: platformNow,
      matchedAt: platformNow,
      startedAt: platformNow,
      ...(fixed ? { tournamentId: 'lingshui-16-cup', assignmentId: `assignment-${id}` } : {}),
    }
    participants.forEach(participant => { state.activeMatchByUser[participant.userId] = id })
  })
  const clearSyntheticMatch = async id => runtime.store.transaction(state => {
    const match = state.matches[id]
    match.status = 'completed'
    match.participants.forEach(participant => {
      participant.status = 'completed'
      if (state.activeMatchByUser[participant.userId] === id) delete state.activeMatchByUser[participant.userId]
    })
  })

  await installPlayingMatch({ id: 'mat_recover_quick', roomId: '810001' })
  const quickRecoveryAttempt = 'quick-recovery-attempt-user-01'
  const recoveredQuick = await call(baseUrl, '/api/v1/matches/recover', {
    method: 'POST', token: players[0].token, body: { recoveryAttemptId: quickRecoveryAttempt },
  })
  const recoveredQuickDuplicate = await call(baseUrl, '/api/v1/matches/recover', {
    method: 'POST', token: players[0].token, body: { recoveryAttemptId: quickRecoveryAttempt },
  })
  const recoveredQuickPeer = await call(baseUrl, '/api/v1/matches/recover', {
    method: 'POST', token: players[1].token, body: { recoveryAttemptId: 'quick-recovery-attempt-user-02' },
  })
  assert.equal(recoveredQuick.status, 200)
  assert.equal(recoveredQuickDuplicate.payload.data.entry.gameTicket, recoveredQuick.payload.data.entry.gameTicket)
  assert.deepEqual(
    {
      matchId: recoveredQuick.payload.data.entry.matchId,
      roomId: recoveredQuick.payload.data.entry.roomId,
      seat: recoveredQuick.payload.data.entry.seat,
      roomKind: recoveredQuick.payload.data.entry.roomKind,
      ticketPurpose: recoveredQuick.payload.data.entry.ticketPurpose,
    },
    { matchId: 'mat_recover_quick', roomId: '810001', seat: 'p1', roomKind: 'match', ticketPurpose: 'rejoin' },
  )
  assert.equal(recoveredQuickPeer.payload.data.entry.seat, 'p2', '通用恢复只能返回当前用户原席位')
  const quickRecoveryClaims = strictVerifier.inspect(recoveredQuick.payload.data.entry.gameTicket)
  assert.equal(quickRecoveryClaims.sub, players[0].userId)
  assert.equal(quickRecoveryClaims.roomKind, 'match')
  assert.equal(quickRecoveryClaims.purpose, 'rejoin')
  assert.equal(quickRecoveryClaims.entryAttemptId, quickRecoveryAttempt)
  assert.equal(recoveredQuick.payload.data.entry.entryAttemptId, quickRecoveryAttempt)
  assert.equal(recoveredQuick.payload.data.entry.recoveryAttemptId, quickRecoveryAttempt)
  assert.equal('roomSettings' in quickRecoveryClaims, false)
  const rotatedQuick = await call(baseUrl, '/api/v1/matches/recover', {
    method: 'POST', token: players[0].token, body: { recoveryAttemptId: 'quick-recovery-attempt-user-03' },
  })
  assert.notEqual(
    strictVerifier.inspect(rotatedQuick.payload.data.entry.gameTicket).jti,
    quickRecoveryClaims.jti,
    '普通 playing match 使用新恢复 attempt 时也必须轮换 JTI',
  )
  await clearSyntheticMatch('mat_recover_quick')

  await installPlayingMatch({ id: 'mat_recover_fixed', roomId: '810002', fixed: true })
  const reusedRecoveryAttempt = await call(baseUrl, '/api/v1/matches/recover', {
    method: 'POST', token: players[0].token, body: { recoveryAttemptId: quickRecoveryAttempt },
  })
  assert.equal(reusedRecoveryAttempt.status, 409)
  assert.equal(reusedRecoveryAttempt.payload.error.code, 'RECOVERY_ATTEMPT_CONFLICT')
  const fixedRecoveryAttempt = 'fixed-recovery-attempt-user-01'
  const recoveredFixed = await call(baseUrl, '/api/v1/matches/recover', {
    method: 'POST', token: players[0].token, body: { recoveryAttemptId: fixedRecoveryAttempt },
  })
  assert.equal(recoveredFixed.status, 200)
  assert.equal(recoveredFixed.payload.data.entry.matchId, 'mat_recover_fixed')
  assert.equal(recoveredFixed.payload.data.entry.roomId, '810002')
  assert.equal(recoveredFixed.payload.data.entry.seat, 'p1')
  assert.equal(recoveredFixed.payload.data.entry.ticketPurpose, 'rejoin')
  const fixedRecoveryClaims = strictVerifier.inspect(recoveredFixed.payload.data.entry.gameTicket)
  assert.equal(fixedRecoveryClaims.sub, players[0].userId)
  assert.equal(fixedRecoveryClaims.purpose, 'rejoin')
  assert.equal(fixedRecoveryClaims.matchId, 'mat_recover_fixed')
  assert.equal(fixedRecoveryClaims.entryAttemptId, fixedRecoveryAttempt)
  await clearSyntheticMatch('mat_recover_fixed')
  const recoveredNothing = await call(baseUrl, '/api/v1/matches/recover', {
    method: 'POST', token: players[0].token, body: { recoveryAttemptId: 'nothing-recovery-attempt-001' },
  })
  assert.equal(recoveredNothing.payload.data.entry, null)

  const durableLifecycleCreated = await call(baseUrl, '/api/v1/friend-rooms/create', {
    method: 'POST', token: players[0].token,
    body: { entryAttemptId: 'durable-lifecycle-host-001', roomSettings: settings },
  })
  const durableLifecycleEntry = durableLifecycleCreated.payload.data.entry
  const durableLifecycleGuest = await call(baseUrl, '/api/v1/friend-rooms/join', {
    method: 'POST', token: players[1].token,
    body: {
      entryAttemptId: 'durable-lifecycle-guest-01',
      roomId: durableLifecycleEntry.roomId,
      inviteCode: durableLifecycleEntry.inviteCode,
    },
  })
  const durableLifecycleAt = platformNow
  const delayedSeatLeft = {
    eventId: `spectate:${durableLifecycleEntry.matchId}:1`,
    matchId: durableLifecycleEntry.matchId,
    roomId: durableLifecycleEntry.roomId,
    sequence: 1,
    at: durableLifecycleAt,
    type: 'seat-left',
    roundSequence: 1,
    playerId: durableLifecycleGuest.payload.data.entry.seat,
    reason: 'left',
    userId: players[1].userId,
  }
  const delayedRoomClosed = {
    eventId: `spectate:${durableLifecycleEntry.matchId}:2`,
    matchId: durableLifecycleEntry.matchId,
    roomId: durableLifecycleEntry.roomId,
    sequence: 2,
    at: durableLifecycleAt + 1_000,
    type: 'room-closed',
    roundSequence: 1,
    reason: 'host-left',
  }
  platformNow += 25 * 60 * 60_000
  const staleRequestBody = JSON.stringify(delayedSeatLeft)
  const staleRequestTimestamp = String(Date.now() - 5 * 60_000 - 1)
  const staleRequest = await fetch(`${baseUrl}/api/v1/game/spectator-events`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-spectator-event-id': delayedSeatLeft.eventId,
      'x-spectator-timestamp': staleRequestTimestamp,
      'x-spectator-signature': spectatorEventSignature(staleRequestBody, spectatorSecret, staleRequestTimestamp),
      'x-game-event-id': delayedSeatLeft.eventId,
      'x-game-timestamp': staleRequestTimestamp,
      'x-game-signature': gameResultSignature(staleRequestBody, resultSecret, staleRequestTimestamp),
    },
    body: staleRequestBody,
  })
  assert.equal(staleRequest.status, 401, '业务事件可补投不应放宽请求签名的5分钟新鲜度')
  assert.equal((await spectatorReporter.report(delayedSeatLeft)).accepted, true, '超过24小时的 seat-left durable 补投必须可恢复')
  assert.equal((await spectatorReporter.report(delayedRoomClosed)).accepted, true, '超过24小时的 room-closed durable 补投必须可恢复')
  assert.equal(
    await runtime.store.read(state => state.matches[durableLifecycleEntry.matchId].status),
    'aborted',
  )
  await assert.rejects(
    spectatorReporter.report({
      ...delayedRoomClosed,
      eventId: `spectate:${durableLifecycleEntry.matchId}:3`,
      sequence: 3,
      at: platformNow + 60_001,
    }),
    error => error?.status === 400 && error?.code === 'INVALID_SPECTATOR_TIME',
    '未来观战事件时间仍必须拒绝',
  )

  const durableMatchEndEntry = await createStartedFriendRoom('durable-match-end', { ...settings, spectator: 'live' })
  const durableMatchEndedAt = platformNow + 1_000
  const delayedMatchEnded = {
    eventId: `spectate:${durableMatchEndEntry.matchId}:2`,
    matchId: durableMatchEndEntry.matchId,
    roomId: durableMatchEndEntry.roomId,
    sequence: 2,
    at: durableMatchEndedAt,
    type: 'match-ended',
    roundSequence: settings.rounds,
    reason: 'round-limit',
    scores: { teamA: 9, teamB: 7 },
    roundsPlayed: settings.rounds,
    endedAt: durableMatchEndedAt,
    winnerTeam: 'teamA',
  }
  platformNow += 25 * 60 * 60_000
  await assert.rejects(
    spectatorReporter.report({
      ...delayedMatchEnded,
      at: platformNow,
      endedAt: platformNow + 60_001,
    }),
    error => error?.status === 400 && error?.code === 'INVALID_FRIEND_MATCH_ENDED_AT',
    '未来 match-ended.endedAt 仍必须拒绝',
  )
  assert.equal((await spectatorReporter.report(delayedMatchEnded)).accepted, true, '超过24小时的 match-ended durable 补投必须可恢复')
  assert.equal(
    await runtime.store.read(state => state.matches[durableMatchEndEntry.matchId].status),
    'completed',
  )

  const capacityCreated = await call(baseUrl, '/api/v1/friend-rooms/create', {
    method: 'POST',
    token: players[9].token,
    body: { entryAttemptId: 'friend-ticket-capacity-host', roomSettings: settings },
  })
  assert.equal(capacityCreated.status, 200)
  const capacityEntry = capacityCreated.payload.data.entry
  const capacityExpiry = Math.floor((platformNow + 5_000) / 1000)
  await runtime.store.transaction(state => {
    const participant = state.matches[capacityEntry.matchId].participants[0]
    participant.issuedTicketBindings = Array.from({ length: 255 }, (_, index) => ({
      jti: `capacity-live-ticket-${String(index).padStart(3, '0')}`,
      exp: capacityExpiry,
    }))
  })
  const capacityRejected = await call(baseUrl, '/api/v1/matches/recover', {
    method: 'POST', token: players[9].token, body: { recoveryAttemptId: 'friend-ticket-capacity-257' },
  })
  assert.equal(capacityRejected.status, 409, '第257张仍有效的同席票据必须拒签而不能淘汰最旧 JTI')
  assert.equal(capacityRejected.payload.error.code, 'FRIEND_TICKET_LIMIT_REACHED')
  platformNow += 6_000
  const capacityReleased = await call(baseUrl, '/api/v1/matches/recover', {
    method: 'POST', token: players[9].token, body: { recoveryAttemptId: 'friend-ticket-capacity-after-expiry' },
  })
  assert.equal(capacityReleased.status, 200, '旧票全部过期后必须释放签发容量')

  console.log('authenticated friend-room ticket tests passed')
} finally {
  await close(runtime)
}
