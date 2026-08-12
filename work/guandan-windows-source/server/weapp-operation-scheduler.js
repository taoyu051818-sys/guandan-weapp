export const GLOBAL_OPERATION_KEY = 'global'

export const operationKeyForCommand = ({ connection, message, rooms, entryTypes }) => {
  const type = typeof message?.type === 'string' ? message.type : ''
  if (entryTypes.includes(type) || type === 'listRooms') return GLOBAL_OPERATION_KEY
  const roomId = String(connection.roomId || '')
  return /^\d{6}$/.test(roomId) && rooms.has(roomId) ? `room:${roomId}` : GLOBAL_OPERATION_KEY
}

/** Serializes one room without making unrelated rooms wait; global work is an exclusive barrier. */
export const createWeAppOperationScheduler = ({ onError = () => {} } = {}) => {
  const keyedTails = new Map()
  const active = new Set()
  let globalTail = Promise.resolve()

  const track = (operation, settled) => {
    active.add(settled)
    void settled.then(() => active.delete(settled))
    return operation
  }

  const enqueue = (key, task, label = 'operation') => {
    if (key === GLOBAL_OPERATION_KEY) {
      const predecessors = [...active, globalTail]
      const operation = Promise.all(predecessors).then(task)
      globalTail = operation.catch(error => { onError(error, label) })
      return track(operation, globalTail)
    }
    if (typeof key !== 'string' || !key) throw new Error('operation key is required')
    const previous = keyedTails.get(key) || Promise.resolve()
    const barrier = globalTail
    const operation = Promise.all([barrier, previous]).then(task)
    const tail = operation.catch(error => { onError(error, label) })
    keyedTails.set(key, tail)
    void tail.then(() => { if (keyedTails.get(key) === tail) keyedTails.delete(key) })
    return track(operation, tail)
  }

  const drain = async () => {
    while (active.size) await Promise.allSettled([...active])
  }

  return {
    enqueue,
    enqueueGlobal: (task, label) => enqueue(GLOBAL_OPERATION_KEY, task, label),
    drain,
    pendingCount: () => active.size,
  }
}
