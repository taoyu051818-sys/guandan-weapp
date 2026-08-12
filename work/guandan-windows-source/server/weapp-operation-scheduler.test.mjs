import assert from 'node:assert/strict'
import { GLOBAL_OPERATION_KEY, createWeAppOperationScheduler, operationKeyForCommand } from './weapp-operation-scheduler.js'

const deferred = () => {
  let resolve
  const promise = new Promise(done => { resolve = done })
  return { promise, resolve }
}
const tick = () => new Promise(resolve => setImmediate(resolve))

const keyContext = {
  connection: { id: 'c1', roomId: '123456' },
  rooms: new Map([['123456', {}]]),
  entryTypes: ['createRoom', 'joinRoom', 'rejoinRoom'],
}
assert.equal(operationKeyForCommand({ ...keyContext, message: { type: 'play', payload: {} } }), 'room:123456')
assert.equal(operationKeyForCommand({ ...keyContext, message: { type: 'joinRoom', payload: { roomId: '123456' } } }), GLOBAL_OPERATION_KEY)
assert.equal(operationKeyForCommand({ ...keyContext, message: { type: 'listRooms' } }), GLOBAL_OPERATION_KEY)
assert.equal(operationKeyForCommand({ ...keyContext, connection: { id: 'new', roomId: null }, message: { type: 'play' } }), GLOBAL_OPERATION_KEY)

const errors = []
const scheduler = createWeAppOperationScheduler({ onError: (error, label) => errors.push([error.message, label]) })
const roomAGate = deferred()
const roomBGate = deferred()
const events = []
const roomAFirst = scheduler.enqueue('room:a', async () => {
  events.push('a1:start')
  await roomAGate.promise
  events.push('a1:end')
}, 'a1')
const roomASecond = scheduler.enqueue('room:a', () => { events.push('a2') }, 'a2')
const roomB = scheduler.enqueue('room:b', async () => {
  events.push('b:start')
  await roomBGate.promise
  events.push('b:end')
}, 'b')
await tick()
assert.deepEqual(events, ['a1:start', 'b:start'], 'different rooms run concurrently while one room remains FIFO')
roomBGate.resolve()
await roomB
assert.deepEqual(events, ['a1:start', 'b:start', 'b:end'])
roomAGate.resolve()
await Promise.all([roomAFirst, roomASecond])
assert.deepEqual(events.slice(-2), ['a1:end', 'a2'])

const beforeGlobal = deferred()
const globalGate = deferred()
const barrierEvents = []
const priorRoom = scheduler.enqueue('room:a', async () => {
  barrierEvents.push('room-before:start')
  await beforeGlobal.promise
  barrierEvents.push('room-before:end')
})
const global = scheduler.enqueueGlobal(async () => {
  barrierEvents.push('global:start')
  await globalGate.promise
  barrierEvents.push('global:end')
})
const laterRoom = scheduler.enqueue('room:b', () => { barrierEvents.push('room-after') })
await tick()
assert.deepEqual(barrierEvents, ['room-before:start'])
beforeGlobal.resolve()
await priorRoom
await tick()
assert.deepEqual(barrierEvents, ['room-before:start', 'room-before:end', 'global:start'])
globalGate.resolve()
await Promise.all([global, laterRoom])
assert.deepEqual(barrierEvents.slice(-2), ['global:end', 'room-after'])

await assert.rejects(scheduler.enqueue('room:failure', () => { throw new Error('boom') }, 'failure'), /boom/)
await scheduler.enqueue('room:failure', () => { events.push('recovered') })
assert.equal(events.at(-1), 'recovered', 'a rejection must not poison its room queue')
assert.deepEqual(errors, [['boom', 'failure']])

void scheduler.enqueue('room:drain-failure', () => { throw new Error('drain boom') }, 'drain-failure')
await scheduler.drain()
assert.deepEqual(errors.at(-1), ['drain boom', 'drain-failure'], 'drain waits through failed tasks')

const lateGate = deferred()
void scheduler.enqueue('room:drain', async () => {
  void scheduler.enqueue('room:late', () => { events.push('late') })
  await lateGate.promise
})
const drained = scheduler.drain().then(() => events.push('drained'))
await tick()
lateGate.resolve()
await drained
assert.deepEqual(events.slice(-2), ['late', 'drained'])
assert.equal(scheduler.pendingCount(), 0)

console.log('weapp operation scheduler tests passed')
