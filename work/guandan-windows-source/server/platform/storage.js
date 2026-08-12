import { readFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { resolve } from 'node:path'
import {
  durableReplaceFile,
  hardenPrivateFile,
  nodeAsyncDurableFileOperations,
} from '../durable-file.js'

const clone = (value) => value === undefined ? undefined : structuredClone(value)
const seededCatalogKeys = ['products', 'tournaments', 'seasons', 'taskDefinitions']
const accountIdMinimum = 10_000_000
const accountIdCapacity = 90_000_000

const isRecord = value => Boolean(value) && typeof value === 'object' && !Array.isArray(value)

export const normalizeAccountId = value => {
  const accountId = typeof value === 'number' ? String(value) : value
  return typeof accountId === 'string' && /^\d{8}$/.test(accountId) && Number(accountId) >= accountIdMinimum
    ? accountId
    : null
}

const accountIdSeed = value => {
  let hash = 0x811c9dc5
  for (const character of String(value)) {
    hash ^= character.codePointAt(0)
    hash = Math.imul(hash, 0x01000193)
  }
  return hash >>> 0
}

/**
 * Migration fallback only. Normal account creation uses random candidates, while
 * this deterministic probe keeps an unpersisted legacy snapshot stable across reads.
 */
export const findAvailableAccountId = (stableKey, usedAccountIds) => {
  if (usedAccountIds.size >= accountIdCapacity) throw new RangeError('八位账号空间已耗尽')
  const initialOffset = accountIdSeed(stableKey) % accountIdCapacity
  for (let attempt = 0; attempt < accountIdCapacity; attempt += 1) {
    const value = accountIdMinimum + ((initialOffset + attempt) % accountIdCapacity)
    const candidate = String(value)
    if (!usedAccountIds.has(candidate)) return candidate
  }
  throw new RangeError('八位账号空间已耗尽')
}

const migrateUserAccountIds = state => {
  const users = isRecord(state.users) ? state.users : {}
  const previousIndex = isRecord(state.userByAccountId) ? state.userByAccountId : {}
  const indexedAccountIdsByUser = {}
  Object.entries(previousIndex).forEach(([accountId, userId]) => {
    const normalized = normalizeAccountId(accountId)
    if (!normalized || !users[userId]) return
    indexedAccountIdsByUser[userId] ||= []
    indexedAccountIdsByUser[userId].push(normalized)
  })

  const nextIndex = {}
  const usedAccountIds = new Set()
  let changed = !isRecord(state.userByAccountId)
  Object.keys(users).sort().forEach(userId => {
    const user = users[userId]
    const indexedAccountId = (indexedAccountIdsByUser[userId] || []).sort()[0]
    const requestedAccountId = normalizeAccountId(user.accountId) || indexedAccountId
    const accountId = requestedAccountId && !usedAccountIds.has(requestedAccountId)
      ? requestedAccountId
      : findAvailableAccountId(userId, usedAccountIds)
    if (user.accountId !== accountId) {
      user.accountId = accountId
      changed = true
    }
    usedAccountIds.add(accountId)
    nextIndex[accountId] = userId
  })

  const previousEntries = Object.entries(previousIndex)
  const nextEntries = Object.entries(nextIndex)
  if (previousEntries.length !== nextEntries.length || nextEntries.some(([accountId, userId]) => previousIndex[accountId] !== userId)) {
    changed = true
  }
  state.userByAccountId = nextIndex
  return changed
}

const migratePlayerRatings = state => {
  const users = isRecord(state.users) ? state.users : {}
  const ratings = isRecord(state.playerRatings) ? state.playerRatings : {}
  let changed = !isRecord(state.playerRatings)
  Object.keys(users).sort().forEach(userId => {
    const stats = isRecord(state.userStats?.[userId]) ? state.userStats[userId] : {}
    const current = isRecord(ratings[userId]) ? ratings[userId] : {}
    const fallbackGames = Number.isSafeInteger(stats.gamesPlayed) && stats.gamesPlayed >= 0 ? stats.gamesPlayed : 0
    const games = Number.isSafeInteger(current.games) && current.games >= 0 ? current.games : fallbackGames
    const fallbackWins = Number.isSafeInteger(stats.wins) && stats.wins >= 0 ? Math.min(stats.wins, games) : 0
    const wins = Number.isSafeInteger(current.wins) && current.wins >= 0 ? Math.min(current.wins, games) : fallbackWins
    const next = {
      id: userId,
      games,
      wins,
      eloOffset: Number.isFinite(current.eloOffset) ? current.eloOffset : 0,
      updatedAt: Number.isSafeInteger(current.updatedAt) && current.updatedAt >= 0 ? current.updatedAt : Number(stats.updatedAt) || 0,
    }
    if (
      current.id !== next.id || current.games !== next.games || current.wins !== next.wins ||
      current.eloOffset !== next.eloOffset || current.updatedAt !== next.updatedAt
    ) changed = true
    ratings[userId] = next
    if (Object.hasOwn(stats, 'elo')) {
      delete stats.elo
      changed = true
    }
  })
  state.playerRatings = ratings
  return changed
}

const migrateUserWallets = state => {
  const users = isRecord(state.users) ? state.users : {}
  let changed = false
  if (!isRecord(state.wallets)) {
    state.wallets = {}
    changed = true
  }
  if (!Array.isArray(state.ledgerEntries)) {
    state.ledgerEntries = []
    changed = true
  }
  const ledgerIds = new Set(state.ledgerEntries.map(entry => entry?.id).filter(id => typeof id === 'string'))
  Object.keys(users).sort().forEach(userId => {
    if (isRecord(state.wallets[userId])) return
    const createdAt = Number.isSafeInteger(users[userId]?.createdAt) && users[userId].createdAt >= 0
      ? users[userId].createdAt
      : 0
    state.wallets[userId] = { userId, balance: 10_000, currency: 'points', updatedAt: createdAt }
    const ledgerId = `led_wallet_migration_${userId}`
    if (!ledgerIds.has(ledgerId)) {
      state.ledgerEntries.push({
        id: ledgerId,
        userId,
        amount: 10_000,
        balanceAfter: 10_000,
        type: 'welcome_bonus',
        referenceId: userId,
        description: '旧账号初始积分',
        createdAt,
      })
      ledgerIds.add(ledgerId)
    }
    changed = true
  })
  return changed
}

const migrateMatchQueueIndexes = state => {
  if (!isRecord(state.matchQueues)) {
    state.matchQueues = {}
    return true
  }
  let changed = false
  Object.entries(state.matchQueues).forEach(([mode, value]) => {
    const normalized = Array.isArray(value)
      ? [...new Set(value.filter(matchId => typeof matchId === 'string' && matchId))]
      : (typeof value === 'string' && value ? [value] : [])
    if (!Array.isArray(value) || normalized.length !== value.length || normalized.some((matchId, index) => matchId !== value[index])) changed = true
    state.matchQueues[mode] = normalized
  })
  return changed
}

const stableEntryAttemptId = (matchId, userId, seat = '') => {
  const source = `${String(matchId)}\u0000${String(userId)}\u0000${String(seat)}`
  return `legacy_${createHash('sha256').update(source).digest('base64url').slice(0, 32)}`
}

const migrateParticipantEntryAttemptIds = state => {
  const matches = isRecord(state.matches) ? state.matches : {}
  let changed = false
  Object.keys(matches).sort().forEach(matchId => {
    const match = matches[matchId]
    if (!isRecord(match) || !Array.isArray(match.participants)) return
    match.participants.forEach(participant => {
      if (!isRecord(participant)) return
      const current = typeof participant.entryAttemptId === 'string' ? participant.entryAttemptId : ''
      if (/^[A-Za-z0-9_-]{22,128}$/.test(current)) return
      const userId = typeof participant.userId === 'string' ? participant.userId : ''
      if (!userId) return
      participant.entryAttemptId = stableEntryAttemptId(matchId, userId, participant.seat)
      changed = true
    })
  })
  return changed
}

const migrateActiveMatchIndex = state => {
  const matches = isRecord(state.matches) ? state.matches : {}
  const rebuilt = {}
  Object.keys(matches).sort().forEach(matchId => {
    const match = matches[matchId]
    if (!isRecord(match) || !['matching', 'matched', 'playing'].includes(match.status) || !Array.isArray(match.participants)) return
    match.participants.forEach(participant => {
      if (!isRecord(participant) || !['matching', 'matched', 'playing'].includes(participant.status)) return
      const userId = typeof participant.userId === 'string' ? participant.userId : ''
      if (!userId) return
      const previousMatchId = rebuilt[userId]
      if (previousMatchId && previousMatchId !== matchId) {
        throw new TypeError(`用户 ${userId} 同时存在多个活跃匹配：${previousMatchId}、${matchId}`)
      }
      rebuilt[userId] = matchId
    })
  })

  const previous = isRecord(state.activeMatchByUser) ? state.activeMatchByUser : {}
  const changed = !isRecord(state.activeMatchByUser) ||
    Object.keys(previous).length !== Object.keys(rebuilt).length ||
    Object.entries(rebuilt).some(([userId, matchId]) => previous[userId] !== matchId)
  state.activeMatchByUser = rebuilt
  return changed
}

/**
 * Existing local JSON snapshots predate newer collections and development
 * catalog entries. Upgrade them additively: user/runtime data always wins, while
 * missing top-level collections and missing seeded catalog records are restored
 * from the current fallback. This is deliberately not a general deep merge.
 */
const upgradeLoadedState = (loadedState, fallbackState) => {
  if (!isRecord(loadedState)) throw new TypeError('平台状态文件根节点必须是对象')
  const upgraded = clone(loadedState)
  let changed = false

  Object.entries(fallbackState).forEach(([key, fallbackValue]) => {
    if (key === 'schemaVersion') return
    if (upgraded[key] === undefined || upgraded[key] === null) {
      upgraded[key] = clone(fallbackValue)
      changed = true
    }
  })

  seededCatalogKeys.forEach(key => {
    const fallbackCatalog = fallbackState[key]
    if (!isRecord(fallbackCatalog) || !isRecord(upgraded[key])) return
    Object.entries(fallbackCatalog).forEach(([id, record]) => {
      if (upgraded[key][id] !== undefined) return
      upgraded[key][id] = clone(record)
      changed = true
    })
  })

  if (migrateUserAccountIds(upgraded)) changed = true
  if (migratePlayerRatings(upgraded)) changed = true
  if (migrateUserWallets(upgraded)) changed = true
  if (migrateMatchQueueIndexes(upgraded)) changed = true
  if (migrateParticipantEntryAttemptIds(upgraded)) changed = true
  if (migrateActiveMatchIndex(upgraded)) changed = true

  const loadedVersion = Number.isSafeInteger(upgraded.schemaVersion) ? upgraded.schemaVersion : 0
  const fallbackVersion = Number.isSafeInteger(fallbackState.schemaVersion) ? fallbackState.schemaVersion : 0
  if (loadedVersion < fallbackVersion) {
    upgraded.schemaVersion = fallbackVersion
    changed = true
  }
  return { state: upgraded, changed }
}

export const createEmptyPlatformState = () => ({
  schemaVersion: 9,
  users: {},
  userByExternalId: {},
  userByAccountId: {},
  userStats: {},
  playerRatings: {},
  matchHistoryByUser: {},
  wallets: {},
  ledgerEntries: [],
  products: {},
  orders: {},
  orderIdempotency: {},
  tournaments: {},
  enrollments: {},
  enrollmentIdempotency: {},
  tournamentStandings: {},
  tournamentRoundResults: {},
  tournamentRuns: {},
  tournamentPlayerRoundResults: {},
  matches: {},
  activeMatchByUser: {},
  matchQueues: {},
  gameResults: {},
  gameResultByMatch: {},
  replays: {},
  spectatorFeeds: {},
  spectatorEventReceipts: {},
  seasons: {},
  seasonProgress: {},
  taskDefinitions: {},
  taskProgress: {},
  taskClaimIdempotency: {},
  dailyStats: {},
  merchants: {},
  merchantByOwner: {},
  merchantStores: {},
  merchantEmployees: {},
  merchantPointGrants: {},
  merchantIdempotency: {},
})

export class PlatformStateStore {
  async read (_reader) { throw new Error('PlatformStateStore.read 尚未实现') }
  async transaction (_mutator) { throw new Error('PlatformStateStore.transaction 尚未实现') }
}

/**
 * 单进程内存存储。所有写入串行化，并把快照克隆后交给业务层，避免调用方
 * 在事务外修改账本。它是默认开发/测试实现，不是多实例生产数据库。
 */
export class MemoryPlatformStore extends PlatformStateStore {
  constructor (initialState = createEmptyPlatformState()) {
    super()
    this.state = upgradeLoadedState(initialState, createEmptyPlatformState()).state
    this.writeQueue = Promise.resolve()
  }

  async read (reader) {
    await this.writeQueue
    return clone(await reader(clone(this.state)))
  }

  async transaction (mutator) {
    const operation = this.writeQueue.then(async () => {
      const draft = clone(this.state)
      const result = await mutator(draft)
      await this.persist(draft)
      this.state = draft
      return clone(result)
    })
    this.writeQueue = operation.then(() => undefined, () => undefined)
    return operation
  }

  async persist (_state) {}
}

/**
 * 本地 JSON 持久化实现。它只提供单实例快照，不提供跨进程锁、自动备份或
 * 数据库级恢复；多实例部署必须替换为具备事务和唯一约束的正式 repository。
 */
export class JsonFilePlatformStore extends MemoryPlatformStore {
  constructor (filePath, initialState, { durableFileOperations = nodeAsyncDurableFileOperations } = {}) {
    super(initialState)
    this.filePath = resolve(filePath)
    this.durableFileOperations = durableFileOperations
  }

  static async open (filePath, fallbackState = createEmptyPlatformState(), options = {}) {
    const resolvedPath = resolve(filePath)
    const durableFileOperations = options.durableFileOperations || nodeAsyncDurableFileOperations
    await hardenPrivateFile(resolvedPath, durableFileOperations)
    let state = fallbackState
    let loadedFromDisk = false
    try {
      state = JSON.parse(await readFile(resolvedPath, 'utf8'))
      loadedFromDisk = true
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error
    }
    const upgraded = upgradeLoadedState(state, fallbackState)
    const store = new JsonFilePlatformStore(resolvedPath, upgraded.state, { durableFileOperations })
    if (!loadedFromDisk || upgraded.changed) await store.persist(upgraded.state)
    return store
  }

  async persist (state) {
    await durableReplaceFile(
      this.filePath,
      `${JSON.stringify(state, null, 2)}\n`,
      this.durableFileOperations,
    )
  }
}

/**
 * Redis 客户端适配接口原型。client 只需提供 get(key) / set(key, value)。本实现
 * 仅在当前 Node 进程内串行，未实现 Redis WATCH/MULTI 或分布式锁，供联调和
 * 后续替换正式 repository 使用，不能作为多实例生产承诺。
 */
export class RedisPlatformStorePrototype extends PlatformStateStore {
  constructor ({ client, key = 'guandan:platform:state', fallbackState = createEmptyPlatformState() }) {
    super()
    if (!client || typeof client.get !== 'function' || typeof client.set !== 'function') {
      throw new TypeError('RedisPlatformStorePrototype 需要 get/set 客户端')
    }
    this.client = client
    this.key = key
    this.fallbackState = clone(fallbackState)
    this.writeQueue = Promise.resolve()
  }

  async load () {
    const serialized = await this.client.get(this.key)
    const upgraded = upgradeLoadedState(serialized ? JSON.parse(serialized) : this.fallbackState, this.fallbackState)
    if (serialized && upgraded.changed) await this.client.set(this.key, JSON.stringify(upgraded.state))
    return upgraded.state
  }

  async read (reader) {
    await this.writeQueue
    return clone(await reader(await this.load()))
  }

  async transaction (mutator) {
    const operation = this.writeQueue.then(async () => {
      const draft = await this.load()
      const result = await mutator(draft)
      await this.client.set(this.key, JSON.stringify(draft))
      return clone(result)
    })
    this.writeQueue = operation.then(() => undefined, () => undefined)
    return operation
  }
}
