import assert from 'node:assert/strict'
import { createRoomActionExecutor } from './weapp-room-action-executor.js'

function harness ({ final = false, reject = false, persistFails = false, publishFails = false } = {}) {
  const calls = []
  const room = { state: { revision: 0 }, version: 1, roundSequence: 0, consecutiveTimeouts: { p1: 2 } }
  const executor = createRoomActionExecutor({
    dispatch: (state, command) => reject ? { ok: false, reason: 'NOT_PLAYER_TURN' } : {
      ok: true, state: { revision: state.revision + 1 },
      events: [
        ...(command.type === 'PLAY_CARDS' ? [{ type: 'CARDS_PLAYED', action: { type: 'Pair', cards: ['a', 'b'] } }] : []),
        ...(final ? [{ type: 'ROUND_SETTLED', settlement: { winnerTeam: 'teamA' } }] : []),
      ],
    },
    applyRoomSettlementPolicy: (room, previous, result) => { calls.push('policy'); return result },
    syncRoomFromMatchState: () => calls.push('sync'),
    recordRoomAction: (room, id, record) => calls.push(['record', id, record]),
    reportSpectatorAction: (room, event) => calls.push(['action', event]),
    reportSpectatorEvent: (room, event) => calls.push(['event', event]),
    consumeRoundSettlement: (room, result) => { calls.push('consume'); if (result) room.roundSequence++ },
    armTurnDeadline: () => calls.push('arm'),
    commitRuntimeState: async () => { calls.push('persist'); if (persistFails) throw new Error('disk') },
    stagePendingSideEffects: () => calls.push('stage'),
    finalizePendingRound: async () => { calls.push('finalize'); if (persistFails) throw new Error('disk') },
    publishState: () => { calls.push('state'); if (publishFails) throw new Error('socket') },
    publishTribute: () => calls.push('tribute'),
    broadcast: () => calls.push('broadcast'),
  })
  return { executor, room, calls }
}
for (const automatic of [false, true]) {
  for (const type of ['PLAY_CARDS', 'PASS', 'SELECT_TRIBUTE_CARD', 'SELECT_RETURN_CARD', 'BEGIN_PLAY_AFTER_TRIBUTE']) {
    const { executor, room, calls } = harness()
    const result = executor.apply(room, { type, playerId: 'p1', cardIds: ['a', 'b'], cardId: 'a' }, { automatic })
    assert.equal(room.state.revision, 1)
    assert.equal(room.version, 2)
    assert.equal(room.consecutiveTimeouts.p1, automatic ? 2 : 0)
    assert.equal(calls.filter(c => c === 'consume').length, 1)
    assert.equal(calls.filter(c => Array.isArray(c) && c[0] === 'record').length, 1)
    const acceptance = automatic ? null : {
      accept: async () => calls.push('accepted-durably'),
      remember: () => ({ requestId: 1 }), playerId: 'p1', cacheKey: '1',
    }
    await executor.commit(room, result, { acceptance })
    assert.equal(calls.at(-1), ['SELECT_TRIBUTE_CARD', 'SELECT_RETURN_CARD'].includes(type) ? 'tribute' : 'state')
    assert.ok(calls.indexOf(automatic ? 'persist' : 'accepted-durably') < calls.length - 1)
  }
}
{
  const { executor, room, calls } = harness({ reject: true })
  assert.throws(() => executor.apply(room, { type: 'PASS', playerId: 'p1' }))
  assert.equal(room.version, 1)
  assert.deepEqual(calls, [])
}
for (const final of [false, true]) {
  const { executor, room, calls } = harness({ final, persistFails: true })
  const outcome = executor.apply(room, { type: 'PASS', playerId: 'p1' }, { automatic: true })
  await assert.rejects(executor.commit(room, outcome), /disk/)
  assert.ok(!calls.includes('state') && !calls.includes('broadcast'))
  assert.equal(room.roundSequence, final ? 1 : 0)
  if (final) assert.equal(room.pendingRoundFinalization.result.winnerTeam, 'teamA', 'durable finalization retry retains its outcome')
}
{
  const { executor, room } = harness({ publishFails: true })
  const outcome = executor.apply(room, { type: 'PASS', playerId: 'p1' })
  await assert.rejects(executor.commit(room, outcome), error => error.actionCommitted === true)
}
console.log('shared human/automatic application, commit ordering and durability failure boundaries passed')
