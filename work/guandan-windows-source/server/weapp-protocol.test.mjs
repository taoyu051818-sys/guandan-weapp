import assert from 'node:assert/strict'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const {
  commandRequiresExpectedVersion,
  commandRequiresRequestId,
  validateCommandRequestId,
  validateExpectedVersion,
} = require('../../../shared-core/dist/protocol')

assert.equal(commandRequiresRequestId('play'), true)
assert.equal(commandRequiresRequestId('leaveRoom'), true)
assert.equal(validateCommandRequestId('play', undefined)?.code, 'invalid-request-id')
assert.equal(validateCommandRequestId('play', 1), null)

for (const type of ['startGame', 'play', 'pass', 'tribute', 'returnTribute', 'finishTribute']) {
  assert.equal(commandRequiresExpectedVersion(type), true, `${type} 必须受权威牌局版本保护`)
  assert.equal(validateExpectedVersion(type, undefined, 4)?.code, 'missing-version')
  assert.equal(validateExpectedVersion(type, 3, 4)?.code, 'stale-version')
  assert.equal(validateExpectedVersion(type, 4, 4), null)
}

for (const type of ['leaveRoom', 'safeExit', 'chat', 'setTrustee', 'cancelTrustee', 'setLobbyReady', 'kickMember', 'proposeDissolve', 'nextRound', 'readyNextRound', 'roundReady', 'ready', 'cancelRoundReady', 'cancelReady']) {
  assert.equal(commandRequiresExpectedVersion(type), false, `${type} 不应因牌局版本推进而被阻塞`)
  assert.equal(validateExpectedVersion(type, 1, 4), null)
}

process.stdout.write('weapp protocol validation tests passed\n')
