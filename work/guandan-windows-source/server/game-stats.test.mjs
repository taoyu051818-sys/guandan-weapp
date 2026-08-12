import assert from 'node:assert/strict'
import { buildGameResultEvent, createGameStatsBySeat, gameStatsForResult, recordAuthoritativeAction } from './game-stats.js'

const stats = createGameStatsBySeat()
recordAuthoritativeAction(stats, 'p1', { kind: 'play', playType: 'Bomb' })
recordAuthoritativeAction(stats, 'p1', { kind: 'play', playType: 'StraightFlush' })
recordAuthoritativeAction(stats, 'p1', { kind: 'play', playType: 'Rocket' })
recordAuthoritativeAction(stats, 'p1', { kind: 'pass' })
recordAuthoritativeAction(stats, 'p2', { kind: 'play', playType: 'Pair', timedOut: true, trustee: true })
recordAuthoritativeAction(stats, 'p2', { kind: 'tribute', timedOut: true, trustee: true })
recordAuthoritativeAction(stats, 'p3', { kind: 'returnTribute' })

assert.equal(stats.p1.bombsPlayed, 3, '炸弹、同花顺和天王炸都应累计为炸弹统计')
assert.equal(stats.p1.playsMade, 3)
assert.equal(stats.p1.passesMade, 1)
assert.deepEqual(stats.p1.playTypes, { Bomb: 1, StraightFlush: 1, Rocket: 1 })
assert.equal(stats.p2.timeoutActions, 2, '所有服务端 deadline 自动动作都应计入超时次数')
assert.equal(stats.p2.trusteeActions, 2, '托管生效后的自动动作都应计入托管动作次数')
assert.equal(stats.p2.playTypes.Pair, 1)
assert.equal(stats.p2.tributeActions, 1)
assert.equal(stats.p3.returnTributeActions, 1)

const tournamentStats = createGameStatsBySeat()
recordAuthoritativeAction(tournamentStats, 'p1', { kind: 'play', playType: 'StraightFlush' }, { straightFlushAsBomb: false })
assert.equal(tournamentStats.p1.bombsPlayed, 0, '赛事规则关闭同花顺炸弹时不得计入炸弹统计')

const resultStats = gameStatsForResult(stats)
stats.p1.playTypes.Bomb = 999
assert.equal(resultStats.p1.playTypes.Bomb, 1, '结算统计必须是有界克隆，不能被房间后续修改污染')

const room = {
  matchId: 'mat-stats',
  roomId: '135790',
  roundSequence: 7,
  spectatorSequence: 12,
  userIdsBySeat: { p1: 'u1', p2: 'u2', p3: 'u3', p4: 'u4' },
  statsBySeat: stats,
}
const result = {
  fullRank: ['p1', 'p3', 'p2', 'p4'],
  winnerTeam: 'teamA',
  teamLevels: { teamA: 'A', teamB: 10 },
}
const event = buildGameResultEvent(room, result, 123456789)
assert.equal(event.eventId, 'game:mat-stats:7')
assert.equal(event.finishedAt, 123456789)
assert.equal(event.finalSpectatorSequence, 12, '结算必须声明观战通道的最终序号，供平台等待尾事件')
assert.equal(event.statsBySeat.p1.bombsPlayed, 3, '签名结算事件必须携带服务端权威炸弹累计')
assert.equal(event.statsBySeat.p2.timeoutActions, 2)
assert.equal(event.statsBySeat.p2.trusteeActions, 2)
assert.equal(event.statsBySeat.p3.returnTributeActions, 1)

console.log('weapp authoritative game stats passed')
