import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'

const clone = (value) => JSON.parse(JSON.stringify(value))

/**
 * Single-process atomic room snapshot store. It is deliberately not presented
 * as a distributed lock: multi-instance ownership still needs Redis/Postgres
 * leases before production horizontal scaling.
 */
export class JsonRoomStateStore {
  constructor ({ filePath = '' } = {}) {
    this.filePath = filePath ? resolve(filePath) : ''
  }

  get configured () { return Boolean(this.filePath) }

  load () {
    if (!this.configured) return { schemaVersion: 1, rooms: [], acceptedActions: [] }
    try {
      const parsed = JSON.parse(readFileSync(this.filePath, 'utf8'))
      if (parsed?.schemaVersion !== 1 || !Array.isArray(parsed.rooms) || !Array.isArray(parsed.acceptedActions)) {
        throw new Error('牌局恢复文件格式不受支持')
      }
      return clone(parsed)
    } catch (error) {
      if (error?.code === 'ENOENT') return { schemaVersion: 1, rooms: [], acceptedActions: [] }
      throw error
    }
  }

  save (snapshot) {
    if (!this.configured) return
    const safe = {
      schemaVersion: 1,
      savedAt: Date.now(),
      rooms: Array.isArray(snapshot?.rooms) ? snapshot.rooms : [],
      acceptedActions: Array.isArray(snapshot?.acceptedActions) ? snapshot.acceptedActions : [],
    }
    mkdirSync(dirname(this.filePath), { recursive: true, mode: 0o700 })
    const temporaryPath = `${this.filePath}.${process.pid}.tmp`
    writeFileSync(temporaryPath, `${JSON.stringify(safe)}\n`, { mode: 0o600 })
    renameSync(temporaryPath, this.filePath)
  }
}

const emptySeats = () => ({ p1: null, p2: null, p3: null, p4: null })

/** Socket ids are process-local and must never survive a restart. */
export const roomForPersistence = (room) => ({ ...clone(room), seats: emptySeats() })

export const roomFromPersistence = (stored) => ({ ...clone(stored), seats: emptySeats() })
