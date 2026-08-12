import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import {
  durableReplaceFile,
  hardenPrivateFileSync,
  nodeAsyncDurableFileOperations,
  nodeSyncDurableFileOperations,
} from './durable-file.js'

const clone = (value) => JSON.parse(JSON.stringify(value))

/**
 * Single-process atomic room snapshot store. It is deliberately not presented
 * as a distributed lock: multi-instance ownership still needs Redis/Postgres
 * leases before production horizontal scaling.
 */
export class JsonRoomStateStore {
  constructor ({
    filePath = '',
    durableFileOperations = nodeAsyncDurableFileOperations,
    syncFileOperations = nodeSyncDurableFileOperations,
  } = {}) {
    this.filePath = filePath ? resolve(filePath) : ''
    this.durableFileOperations = durableFileOperations
    this.writeQueue = Promise.resolve()
    if (this.configured) hardenPrivateFileSync(this.filePath, syncFileOperations)
  }

  get configured () { return Boolean(this.filePath) }

  load () {
    if (!this.configured) return { schemaVersion: 1, rooms: [], acceptedActions: [], closedRoomTombstones: [] }
    try {
      const parsed = JSON.parse(readFileSync(this.filePath, 'utf8'))
      if (parsed?.schemaVersion !== 1 || !Array.isArray(parsed.rooms) || !Array.isArray(parsed.acceptedActions)) {
        throw new Error('牌局恢复文件格式不受支持')
      }
      if (parsed.closedRoomTombstones !== undefined && !Array.isArray(parsed.closedRoomTombstones)) throw new Error('牌局恢复文件的关闭房间索引无效')
      parsed.closedRoomTombstones ||= []
      return clone(parsed)
    } catch (error) {
      if (error?.code === 'ENOENT') return { schemaVersion: 1, rooms: [], acceptedActions: [], closedRoomTombstones: [] }
      throw error
    }
  }

  save (snapshot) {
    if (!this.configured) return Promise.resolve()
    const safe = {
      schemaVersion: 1,
      savedAt: Date.now(),
      rooms: clone(Array.isArray(snapshot?.rooms) ? snapshot.rooms : []),
      acceptedActions: clone(Array.isArray(snapshot?.acceptedActions) ? snapshot.acceptedActions : []),
      closedRoomTombstones: clone(Array.isArray(snapshot?.closedRoomTombstones) ? snapshot.closedRoomTombstones : []),
    }
    const operation = this.writeQueue.then(async () => {
      await durableReplaceFile(this.filePath, `${JSON.stringify(safe)}\n`, this.durableFileOperations)
    })
    this.writeQueue = operation.catch(() => undefined)
    return operation
  }

  whenIdle () { return this.writeQueue }
}

const emptySeats = () => ({ p1: null, p2: null, p3: null, p4: null })

/** Socket ids are process-local and must never survive a restart. */
export const roomForPersistence = (room) => ({ ...clone(room), seats: emptySeats() })

export const roomFromPersistence = (stored) => ({ ...clone(stored), seats: emptySeats() })

/** Mark only the exact acceptance objects captured by one successful snapshot. */
export const markSnapshotAcceptancesDurable = (acceptedActions, writtenAcceptances) => {
  for (const [key, written] of writtenAcceptances) {
    const current = acceptedActions.get(key)
    if (current === written) acceptedActions.set(key, { ...current, pendingDurability: false })
  }
}
