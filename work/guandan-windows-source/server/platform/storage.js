import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import {
  durableReplaceFile,
  hardenPrivateFile,
  nodeAsyncDurableFileOperations,
} from '../durable-file.js'
import { upgradeLoadedState } from './state-migrations.js'
export { normalizeAccountId, findAvailableAccountId } from './state-migrations.js'

const clone = (value) => value === undefined ? undefined : structuredClone(value)

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
