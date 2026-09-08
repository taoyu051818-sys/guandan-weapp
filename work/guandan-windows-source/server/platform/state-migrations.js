import { createHash } from 'node:crypto'

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
      if (!isRecord(participant) || participant.isBot || !['matching', 'matched', 'playing'].includes(participant.status)) return
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
export const upgradeLoadedState = (loadedState, fallbackState) => {
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
