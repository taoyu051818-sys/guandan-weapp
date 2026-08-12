import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import {
  durableReplaceFileSync,
  hardenPrivateFileSync,
  nodeSyncDurableFileOperations,
} from '../durable-file.js'
import { canonicalJsonFingerprint } from './canonical-json.js'

const schemaVersion = 1
const emptySnapshot = () => ({ schemaVersion, events: [] })

const clone = (value, label = '结算 outbox 事件') => {
  try {
    const serialized = JSON.stringify(value)
    if (serialized === undefined) throw new TypeError(`${label}无法序列化`)
    return JSON.parse(serialized)
  } catch (error) {
    if (error instanceof TypeError && error.message === `${label}无法序列化`) throw error
    throw new TypeError(`${label}必须是可序列化 JSON`)
  }
}

const validateEvent = (event, label = '结算 outbox 事件') => {
  if (!event || typeof event !== 'object' || Array.isArray(event)) throw new Error(`${label}无效`)
  if (typeof event.eventId !== 'string' || !event.eventId) throw new Error(`${label}缺少 eventId`)
}

const validateSnapshot = parsed => {
  if (parsed?.schemaVersion !== schemaVersion || !Array.isArray(parsed.events)) {
    throw new Error('结算 outbox 文件格式不受支持')
  }
  const eventIds = new Set()
  parsed.events.forEach((event, index) => {
    validateEvent(event, `结算 outbox 事件[${index}]`)
    if (eventIds.has(event.eventId)) throw new Error('结算 outbox 包含重复 eventId')
    eventIds.add(event.eventId)
  })
  return parsed
}

/**
 * Single-process durable queue for authoritative game results. Each mutation is
 * committed with an atomic file replacement before the in-memory view changes.
 */
export class JsonGameResultOutboxStore {
  constructor ({ filePath = '', durableFileOperations = nodeSyncDurableFileOperations } = {}) {
    this.filePath = filePath ? resolve(filePath) : ''
    this.durableFileOperations = durableFileOperations
    if (this.configured) hardenPrivateFileSync(this.filePath, this.durableFileOperations)
    this.events = this.configured ? this.load().events : []
  }

  get configured () { return Boolean(this.filePath) }

  load () {
    if (!this.configured) return emptySnapshot()
    try {
      return clone(validateSnapshot(JSON.parse(readFileSync(this.filePath, 'utf8'))), '结算 outbox 文件')
    } catch (error) {
      if (error?.code === 'ENOENT') return emptySnapshot()
      throw error
    }
  }

  pending () { return clone(this.events) }

  add (event) {
    validateEvent(event)
    const safeEvent = clone(event)
    const sameId = this.events.find(item => item.eventId === safeEvent.eventId)
    if (sameId) {
      if (canonicalJsonFingerprint(sameId) !== canonicalJsonFingerprint(safeEvent)) {
        throw new Error('同一个结算 outbox eventId 对应不同正文')
      }
      return false
    }
    const nextEvents = [...this.events, safeEvent]
    this.save(nextEvents)
    this.events = nextEvents
    return true
  }

  remove (eventId) {
    const index = this.events.findIndex(event => event.eventId === eventId)
    if (index < 0) return false
    const nextEvents = this.events.filter((_, itemIndex) => itemIndex !== index)
    this.save(nextEvents)
    this.events = nextEvents
    return true
  }

  save (events = this.events) {
    if (!this.configured) return
    const snapshot = { schemaVersion, savedAt: Date.now(), events }
    durableReplaceFileSync(this.filePath, `${JSON.stringify(snapshot)}\n`, this.durableFileOperations)
  }
}
