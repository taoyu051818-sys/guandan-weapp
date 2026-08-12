import assert from 'node:assert/strict'
import { COMMAND_HANDLED, createCommandRouter } from './weapp-command-router.js'

const calls = []
const router = createCommandRouter([
  { types: ['createRoom', 'joinRoom'], handle: context => { calls.push(['entry', context.type]) } },
  { types: ['play', 'pass'], handle: context => { calls.push(['game', context.type]) } },
])

assert.deepEqual(router.registeredTypes(), ['createRoom', 'joinRoom', 'play', 'pass'])
assert.equal(await router.dispatch({ type: 'play' }), COMMAND_HANDLED)
assert.equal(await router.dispatch({ type: 'unknown' }), false)
assert.deepEqual(calls, [['game', 'play']])
assert.throws(() => createCommandRouter([
  { types: ['play'], handle: () => {} },
  { types: ['play'], handle: () => {} },
]), /被重复注册/)

console.log('weapp command router tests passed')
