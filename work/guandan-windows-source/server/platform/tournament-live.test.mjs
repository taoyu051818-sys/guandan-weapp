import assert from 'node:assert/strict'
import { createPlatformRuntime } from '../platform-server.js'
import { GameTicketService, GameTicketVerifier } from './crypto.js'
import { GameResultReporter } from './result-reporter.js'
import { SpectatorEventReporter } from './spectator-event-reporter.js'
import { formatForNewRoom } from '../match-format-policy.js'

const accessSecret = 'tournament-access-secret-with-at-least-thirty-two-characters'
const ticketSecret = 'tournament-ticket-secret-with-at-least-thirty-two-characters'
const resultSecret = 'tournament-result-secret-with-at-least-thirty-two-characters'
const spectatorSecret = 'tournament-spectator-secret-with-at-least-thirty-two-characters'
const tournamentId = 'lingshui-16-cup'
const queueId = 'lingshui_16_cup'

const listen = async (runtime) => {
  await new Promise(resolve => runtime.server.listen(0, '127.0.0.1', resolve))
  const { port } = runtime.server.address()
  return `http://127.0.0.1:${port}`
}
const close = runtime => new Promise(resolve => runtime.server.close(resolve))
const call = async (baseUrl, path, { method = 'GET', token, body, headers = {} } = {}) => {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...headers,
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
    GAME_ENDPOINT: 'ws://127.0.0.1:39999/weapp',
  },
  wxCodeVerifier: { async verify () { throw new Error('本测试不使用微信登录') } },
  logger: { error () {} },
})
let platformNow = Date.now()
runtime.service.now = () => platformNow
runtime.service.gameTickets = new GameTicketService({
  secret: ticketSecret,
  gameEndpoint: 'ws://127.0.0.1:39999/weapp',
  ttlMs: 1_000,
  now: () => platformNow,
})
const baseUrl = await listen(runtime)

try {
  assert.equal((await call(baseUrl, `/api/v1/tournaments/${tournamentId}/state`)).status, 401, '赛事状态必须登录后读取')
  assert.equal((await call(baseUrl, `/api/v1/tournaments/${tournamentId}/withdraw`, { method: 'POST' })).status, 401)

  const players = []
  for (let index = 1; index <= 16; index += 1) {
    const login = await call(baseUrl, '/api/v1/auth/dev-login', {
      method: 'POST',
      body: { deviceId: `tournament-device-${index}`, displayName: `赛事玩家${String(index).padStart(2, '0')}` },
    })
    assert.equal(login.status, 200)
    const player = { token: login.payload.data.accessToken, userId: login.payload.data.user.id }
    players.push(player)
    const enrollment = await call(baseUrl, `/api/v1/tournaments/${tournamentId}/enroll`, {
      method: 'POST',
      token: player.token,
      body: { expectedEntryPoints: 0 },
      headers: { 'idempotency-key': `enroll-${index}` },
    })
    assert.equal(enrollment.status, 200)
    const checkedIn = await call(baseUrl, `/api/v1/tournaments/${tournamentId}/check-in`, { method: 'POST', token: player.token })
    assert.equal(checkedIn.status, 200)
    assert.equal(checkedIn.payload.data.checkedInCount, index)
    if (index === 1) {
      const withdrawal = await call(baseUrl, `/api/v1/tournaments/${tournamentId}/withdraw`, { method: 'POST', token: player.token, headers: { 'idempotency-key': 'withdraw-first' } })
      assert.equal(withdrawal.status, 200)
      assert.equal(withdrawal.payload.data.checkedInCount, 0)
      assert.equal(withdrawal.payload.data.viewerEntry.enrolled, false)
      assert.equal((await call(baseUrl, `/api/v1/tournaments/${tournamentId}/check-in`, { method: 'POST', token: player.token })).status, 403)
      await call(baseUrl, `/api/v1/tournaments/${tournamentId}/enroll`, { method: 'POST', token: player.token, body: { expectedEntryPoints: 0 }, headers: { 'idempotency-key': 're-enroll-first' } })
      assert.equal((await call(baseUrl, `/api/v1/tournaments/${tournamentId}/check-in`, { method: 'POST', token: player.token })).payload.data.checkedInCount, 1)
    }
    if (index < 16) {
      assert.equal(checkedIn.payload.data.phase, 'check-in')
      assert.equal(checkedIn.payload.data.roundNumber, 0)
    } else {
      assert.equal(checkedIn.payload.data.phase, 'round-active')
      assert.equal(checkedIn.payload.data.roundNumber, 1)
    }
  }

  const duplicateCheckIn = await call(baseUrl, `/api/v1/tournaments/${tournamentId}/check-in`, { method: 'POST', token: players[0].token })
  const lockedWithdrawal = await call(baseUrl, `/api/v1/tournaments/${tournamentId}/withdraw`, { method: 'POST', token: players[0].token, headers: { 'idempotency-key': 'withdraw-after-lock' } })
  assert.equal(lockedWithdrawal.status, 409)
  assert.equal(lockedWithdrawal.payload.error.code, 'ROSTER_LOCKED')
  assert.equal(duplicateCheckIn.payload.data.checkedInCount, 16, '重复检录必须幂等')

  const unassignedJoin = await call(baseUrl, '/api/v1/match/join', {
    method: 'POST', token: players[0].token, body: { mode: queueId },
  })
  assert.equal(unassignedJoin.status, 409)
  assert.equal(unassignedJoin.payload.error.code, 'TOURNAMENT_ASSIGNMENT_REQUIRED')

  const reporter = new GameResultReporter({ endpoint: `${baseUrl}/api/v1/game/results`, secret: resultSecret, maxAttempts: 1 })
  const spectatorReporter = new SpectatorEventReporter({
    endpoint: `${baseUrl}/api/v1/game/spectator-events`,
    secret: spectatorSecret,
    lifecycleSecret: resultSecret,
    maxAttempts: 1,
  })
  let verifiedExpiredTicketRecovery = false
  const playRound = async (roundNumber) => {
    const entries = []
    for (const player of players) {
      const state = await call(baseUrl, `/api/v1/tournaments/${tournamentId}/state`, { token: player.token })
      assert.equal(state.status, 200)
      assert.equal(state.payload.data.phase, 'round-active')
      assert.equal(state.payload.data.roundNumber, roundNumber)
      entries.push({ ...player, assignment: state.payload.data.assignment })
    }

    const groups = new Map()
    entries.forEach(entry => {
      assert.equal(entry.assignment.roundNumber, roundNumber)
      const group = groups.get(entry.assignment.assignmentId) || []
      group.push(entry)
      groups.set(entry.assignment.assignmentId, group)
    })
    assert.equal(groups.size, 4)
    assert.ok([...groups.values()].every(group => group.length === 4))

    const tableResults = []
    for (const [assignmentId, group] of groups) {
      const wrongAssignment = await call(baseUrl, '/api/v1/match/join', {
        method: 'POST',
        token: group[0].token,
        body: { mode: queueId, tournamentId, assignmentId: `${assignmentId}-wrong` },
      })
      assert.equal(wrongAssignment.status, 409)
      assert.equal(wrongAssignment.payload.error.code, 'TOURNAMENT_ASSIGNMENT_MISMATCH')

      let matchId = ''
      for (const player of group) {
        const joined = await call(baseUrl, '/api/v1/match/join', {
          method: 'POST',
          token: player.token,
          body: { mode: queueId, tournamentId, assignmentId },
        })
        assert.equal(joined.status, 200)
        matchId = joined.payload.data.match.matchId
      }
      const views = []
      for (const player of group) {
        const status = await call(baseUrl, `/api/v1/match/status?matchId=${encodeURIComponent(matchId)}`, { token: player.token })
        assert.equal(status.payload.data.match.status, 'matched')
        assert.equal(status.payload.data.match.assignmentId, assignmentId)
        assert.equal(status.payload.data.match.roundNumber, roundNumber)
        views.push(status.payload.data.match)
      }
      const fixedTicketVerifier = new GameTicketVerifier({ secret: ticketSecret, required: true, now: () => platformNow })
      for (const view of views) {
        assert.match(view.entryAttemptId, /^[A-Za-z0-9_-]{22,128}$/)
        const claims = fixedTicketVerifier.inspect(view.gameTicket)
        assert.equal(claims.roomKind, 'match')
        assert.equal(claims.matchMode, queueId, '固定赛事签名票据必须传递单副赛制，不能退回传统升级')
        assert.equal(formatForNewRoom({ entryKind: claims.roomKind, matchMode: claims.matchMode }).kind, 'independent')
        assert.equal(formatForNewRoom({ entryKind: claims.roomKind, matchMode: claims.matchMode }).individualRanking, true)
        assert.equal(claims.purpose, 'entry')
        assert.equal(claims.entryAttemptId, view.entryAttemptId, '固定赛票据必须绑定平台持久的原席位 attempt')
      }
      if (!verifiedExpiredTicketRecovery) {
        const original = views[0]
        platformNow += 1_100
        const forbiddenCancellation = await call(baseUrl, '/api/v1/match/cancel', {
          method: 'POST',
          token: group[0].token,
          body: { matchId: original.matchId },
        })
        assert.equal(forbiddenCancellation.status, 409)
        assert.equal(forbiddenCancellation.payload.error.code, 'MATCH_ALREADY_ASSIGNED', '固定赛事 assignment 不能被通用票据过期取消')
        const retainedAssignment = await runtime.store.read(state => {
          const run = state.tournamentRuns[tournamentId]
          return run.rounds.flatMap(round => round.assignments).find(item => item.assignmentId === assignmentId)
        })
        assert.equal(retainedAssignment.status, 'matched')
        assert.equal(retainedAssignment.matchId, original.matchId)
        const retainedCloseEvent = {
          eventId: `spectate:${original.matchId}:1`,
          matchId: original.matchId,
          roomId: original.roomId,
          sequence: 1,
          at: platformNow,
          type: 'room-closed',
          roundSequence: 1,
          reason: 'entry-timeout',
        }
        const retainedLocalExpiry = await spectatorReporter.report(retainedCloseEvent)
        assert.equal(retainedLocalExpiry.ignored, true)
        assert.equal(retainedLocalExpiry.assignmentRetained, true, '固定赛本地等待房间过期不能阻断平台 assignment')
        const retainedMatch = await runtime.store.read(state => ({
          status: state.matches[original.matchId].status,
          feed: state.spectatorFeeds[original.matchId],
          receipt: state.spectatorEventReceipts[`spectate:${original.matchId}:1`],
        }))
        assert.equal(retainedMatch.status, 'matched')
        assert.equal(retainedMatch.feed.abortedAt, undefined)
        assert.equal(retainedMatch.feed.events.length, 0)
        assert.equal(retainedMatch.receipt, undefined, '被丢弃的本地等待超时不能占用重建房间的 sequence')
        const recovered = await call(baseUrl, '/api/v1/match/join', {
          method: 'POST',
          token: group[0].token,
          body: { mode: queueId, tournamentId, assignmentId },
        })
        assert.equal(recovered.status, 200)
        assert.equal(recovered.payload.data.match.status, 'matched')
        assert.equal(recovered.payload.data.match.matchId, original.matchId, '门票过期后必须回到同一赛事牌桌')
        assert.equal(recovered.payload.data.match.roomId, original.roomId)
        assert.equal(recovered.payload.data.match.seat, original.seat)
        assert.notEqual(recovered.payload.data.match.gameTicket, original.gameTicket, '门票过期后必须签发新票')
        assert.equal(fixedTicketVerifier.inspect(recovered.payload.data.match.gameTicket).matchMode, queueId, '重签不能丢失赛事赛制')
        assert.ok(recovered.payload.data.match.expiresAt > original.expiresAt)
        assert.equal(recovered.payload.data.match.entryAttemptId, original.entryAttemptId, '固定 assignment 重签必须保留稳定 attempt')
        assert.equal(
          fixedTicketVerifier.inspect(recovered.payload.data.match.gameTicket).entryAttemptId,
          original.entryAttemptId,
        )
        const claimedAfterRecreate = await spectatorReporter.claimStart({
          eventId: `spectate:${original.matchId}:1`,
          matchId: original.matchId,
          roomId: original.roomId,
          sequence: 1,
          at: platformNow,
          type: 'game-start',
          roundSequence: 1,
        })
        assert.equal(claimedAfterRecreate.lifecycleClaim.status, 'playing', '重建同一固定赛牌桌后必须能从 sequence 1 正常 claim')
        const staleCloseRetry = await spectatorReporter.report(retainedCloseEvent)
        assert.equal(staleCloseRetry.ignored, true)
        assert.equal(staleCloseRetry.assignmentRetained, true, '旧等待房间回调重试不得覆盖新房间已经成功的开局 claim')
        assert.equal((await runtime.store.read(state => state.matches[original.matchId].status)), 'playing')
        views[0] = recovered.payload.data.match
        verifiedExpiredTicketRecovery = true
      }
      tableResults.push({
        matchId,
        roomId: views[0].roomId,
        usersBySeat: Object.fromEntries(views.map((view, index) => [view.seat, group[index].userId])),
      })
    }

    for (let index = 0; index < tableResults.length; index += 1) {
      const table = tableResults[index]
      await reporter.report({
        eventId: `game:${table.matchId}:1`,
        matchId: table.matchId,
        roomId: table.roomId,
        ranking: ['p1', 'p2', 'p3', 'p4'],
        userIdsBySeat: table.usersBySeat,
        winnerTeam: 'teamA',
        finishedAt: Date.now(),
      })
      const state = await call(baseUrl, `/api/v1/tournaments/${tournamentId}/state`, { token: players[0].token })
      if (index < 3) {
        assert.equal(state.payload.data.roundNumber, roundNumber, '前三桌结算不得提前推进轮次')
        assert.equal(state.payload.data.tablesSettled, index + 1)
      } else if (roundNumber < 3) {
        assert.equal(state.payload.data.roundNumber, roundNumber + 1, '第四桌结算后必须推进一次')
        assert.equal(state.payload.data.tablesSettled, 0)
      } else {
        assert.equal(state.payload.data.phase, 'finished')
        assert.equal(state.payload.data.roundNumber, 3)
      }
    }
  }

  await playRound(1)
  await playRound(2)
  await playRound(3)

  const finalState = await call(baseUrl, `/api/v1/tournaments/${tournamentId}/state`, { token: players[15].token })
  assert.equal(finalState.payload.data.phase, 'finished')
  assert.equal(finalState.payload.data.assignment, null)
  assert.equal(finalState.payload.data.viewerStanding.userId, players[15].userId)

  const standings = await call(baseUrl, `/api/v1/tournaments/${tournamentId}/standings`, { token: players[15].token })
  assert.equal(standings.payload.data.provisional, false)
  assert.equal(standings.payload.data.cutoffRank, 8)
  assert.equal(standings.payload.data.standings.length, 16)
  assert.equal(standings.payload.data.standings.filter(item => item.qualificationStatus === 'qualified').length, 8)
  assert.equal(standings.payload.data.standings.filter(item => item.advanced).length, 8)
  assert.equal(standings.payload.data.viewerStanding.userId, players[15].userId)

  const snapshot = await runtime.store.read(state => state)
  for (const standing of standings.payload.data.standings) {
    const persisted = snapshot.tournamentStandings[`${tournamentId}:${standing.userId}`]
    assert.equal(persisted.rank, standing.rank, 'settlement must persist projected ranks within its transaction')
    assert.equal(persisted.opponentPoints, standing.opponentPoints)
    assert.equal(persisted.advanced, standing.advanced, 'qualification must be durable, not a side effect of reading standings')
  }
  assert.equal(Object.keys(snapshot.tournamentPlayerRoundResults).length, 48, '每名玩家每轮只能有一条赛事结果')
  assert.equal(snapshot.tournamentRuns[tournamentId].rounds.flatMap(round => round.assignments).filter(item => item.status === 'completed').length, 12)
} finally {
  await close(runtime)
}

console.log('fixed 16-player tournament live contract passed')
