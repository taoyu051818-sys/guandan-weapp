import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'

const schemaVersion = 1
const emptySnapshot = () => ({ schemaVersion, events: [] })
const clone = value => JSON.parse(JSON.stringify(value))

const validateEvent = (event, label = '观战 outbox 事件') => {
  if (!event || typeof event !== 'object' || Array.isArray(event)) throw new Error(`${label}无效`)
  if (typeof event.eventId !== 'string' || !event.eventId) throw new Error(`${label}缺少 eventId`)
  if (typeof event.matchId !== 'string' || !event.matchId) throw new Error(`${label}缺少 matchId`)
  if (!Number.isSafeInteger(event.sequence) || event.sequence < 1) throw new Error(`${label} sequence 无效`)
}

const validateSnapshot = parsed => {
  if (parsed?.schemaVersion !== schemaVersion || !Array.isArray(parsed.events)) {
    throw new Error('观战 outbox 文件格式不受支持')
  }
  const eventIds = new Set()
  const matchSequences = new Set()
  parsed.events.forEach((event, index) => {
    validateEvent(event, `观战 outbox 事件[${index}]`)
    if (eventIds.has(event.eventId)) throw new Error('观战 outbox 包含重复 eventId')
    eventIds.add(event.eventId)
    const sequenceKey = `${event.matchId}\u0000${event.sequence}`
    if (matchSequences.has(sequenceKey)) throw new Error('观战 outbox 包含重复 match/sequence')
    matchSequences.add(sequenceKey)
  })
  return parsed
}

/**
 * Single-process JSON outbox. Atomic replacement prevents partial JSON, but
 * this is intentionally not a multi-instance queue or a dead-letter store.
 */
export class JsonSpectatorOutboxStore {
  constructor ({ filePath = '' } = {}) {
    this.filePath = filePath ? resolve(filePath) : ''
    this.events = this.configured ? this.load().events : []
  }

  get configured () { return Boolean(this.filePath) }

  load () {
    if (!this.configured) return emptySnapshot()
    try {
      return clone(validateSnapshot(JSON.parse(readFileSync(this.filePath, 'utf8'))))
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
      if (JSON.stringify(sameId) !== JSON.stringify(safeEvent)) throw new Error('同一个观战 outbox eventId 对应不同正文')
      return false
    }
    if (this.events.some(item => item.matchId === safeEvent.matchId && item.sequence === safeEvent.sequence)) {
      throw new Error('同一个观战 outbox match/sequence 对应不同事件')
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
    mkdirSync(dirname(this.filePath), { recursive: true, mode: 0o700 })
    const temporaryPath = `${this.filePath}.${process.pid}.tmp`
    writeFileSync(temporaryPath, `${JSON.stringify(snapshot)}\n`, { mode: 0o600 })
    renameSync(temporaryPath, this.filePath)
  }
}
