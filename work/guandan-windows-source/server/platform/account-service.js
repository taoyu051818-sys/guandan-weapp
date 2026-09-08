import { randomInt } from 'node:crypto'
import { badRequest, conflict, notFound, unauthorized } from './errors.js'
import {
  calculateComprehensiveScore,
  createInitialRating,
  createRatingSnapshot,
  formatComprehensiveScore,
} from './rating.js'
import { findAvailableAccountId, normalizeAccountId } from './storage.js'

const normalizeText = (value, fallback, maxLength) => {
  const text = typeof value === 'string' ? value.trim() : ''
  return (text || fallback).slice(0, maxLength)
}

// Nickname limits count Unicode code points, matching validateProfilePatch; IDs/URLs are unchanged.
const normalizeNickname = (value, fallback) => Array.from(
  (typeof value === 'string' ? value.trim() : '') || fallback,
).slice(0, 24).join('')

const emptyStats = (userId) => ({
  userId,
  gamesPlayed: 0,
  wins: 0,
  firstPlaceFinishes: 0,
  bombsPlayed: 0,
  updatedAt: 0,
})

const ensureAccountCollections = (state) => {
  state.userByAccountId ||= {}
  state.userStats ||= {}
  state.playerRatings ||= {}
  state.matchHistoryByUser ||= {}
}

export class AccountService {
  constructor ({
    store,
    accessTokens,
    now = () => Date.now(),
    createId,
    createAccountId = () => String(randomInt(10_000_000, 100_000_000)),
  } = {}) {
    if (!store || !accessTokens || typeof createId !== 'function') throw new TypeError('AccountService 缺少 store/accessTokens/createId')
    this.store = store
    this.accessTokens = accessTokens
    this.now = now
    this.createId = createId
    this.createAccountId = createAccountId
  }

  accountIdIsAvailable (state, accountId, userId = null) {
    const indexedUserId = state.userByAccountId[accountId]
    if (indexedUserId && indexedUserId !== userId) return false
    return !Object.values(state.users).some(user => user.id !== userId && normalizeAccountId(user.accountId) === accountId)
  }

  allocateAccountId (state, userId) {
    state.userByAccountId ||= {}
    for (let attempt = 0; attempt < 128; attempt += 1) {
      const candidate = normalizeAccountId(this.createAccountId())
      if (candidate && this.accountIdIsAvailable(state, candidate, userId)) return candidate
    }
    const usedAccountIds = new Set([
      ...Object.keys(state.userByAccountId).map(normalizeAccountId).filter(Boolean),
      ...Object.values(state.users).map(user => normalizeAccountId(user.accountId)).filter(Boolean),
    ])
    try {
      return findAvailableAccountId(userId, usedAccountIds)
    } catch (error) {
      if (!(error instanceof RangeError)) throw error
      throw conflict('ACCOUNT_ID_EXHAUSTED', '暂时无法分配八位账号，请稍后重试')
    }
  }

  ensureUserAccountId (state, user) {
    state.userByAccountId ||= {}
    const current = normalizeAccountId(user.accountId)
    const accountId = current && this.accountIdIsAvailable(state, current, user.id)
      ? current
      : this.allocateAccountId(state, user.id)
    Object.entries(state.userByAccountId).forEach(([indexedAccountId, indexedUserId]) => {
      if (indexedUserId === user.id && indexedAccountId !== accountId) delete state.userByAccountId[indexedAccountId]
    })
    user.accountId = accountId
    state.userByAccountId[accountId] = user.id
    return accountId
  }

  ensurePlayerRating (state, userId) {
    state.playerRatings ||= {}
    const current = state.playerRatings[userId]
    if (!current) {
      const stats = state.userStats[userId] || emptyStats(userId)
      state.playerRatings[userId] = {
        ...createInitialRating(userId),
        games: Math.max(0, Number(stats.gamesPlayed) || 0),
        wins: Math.max(0, Math.min(Number(stats.wins) || 0, Number(stats.gamesPlayed) || 0)),
        updatedAt: Number(stats.updatedAt) || 0,
      }
    }
    return state.playerRatings[userId]
  }

  ratingView (rating) {
    const snapshot = createRatingSnapshot(rating)
    return {
      games: rating.games,
      wins: rating.wins,
      eloOffset: rating.eloOffset,
      baseScore: formatComprehensiveScore(snapshot.baseScore),
      comprehensiveScore: formatComprehensiveScore(snapshot.comprehensiveScore),
    }
  }

  publicUser (user, rating = createInitialRating(user.id)) {
    return {
      id: user.id,
      accountId: user.accountId,
      displayName: user.displayName,
      avatarUrl: user.avatarUrl || '',
      comprehensiveScore: formatComprehensiveScore(calculateComprehensiveScore(rating)),
      createdAt: user.createdAt,
    }
  }

  async loginExternal ({ externalId, displayName, avatarUrl }) {
    const safeExternalId = normalizeText(externalId, '', 180)
    if (!safeExternalId) throw badRequest('EXTERNAL_ID_REQUIRED', '外部用户标识不能为空')
    const safeName = normalizeNickname(displayName, '陵水牌友')
    const now = this.now()
    const result = await this.store.transaction(state => {
      ensureAccountCollections(state)
      const existingId = state.userByExternalId[safeExternalId]
      if (existingId) {
        const existing = state.users[existingId]
        this.ensureUserAccountId(state, existing)
        // Login refresh authenticates identity; it must not overwrite a saved profile.
        if (!existing.profileCustomizedAt) {
          existing.displayName = safeName
          if (typeof avatarUrl === 'string') existing.avatarUrl = avatarUrl.trim().slice(0, 500)
        }
        existing.updatedAt = now
        state.userStats[existingId] ||= emptyStats(existingId)
        state.matchHistoryByUser[existingId] ||= []
        return { user: existing, rating: this.ensurePlayerRating(state, existingId) }
      }
      const id = `usr_${this.createId()}`
      const accountId = this.allocateAccountId(state, id)
      const created = {
        id,
        accountId,
        externalId: safeExternalId,
        displayName: safeName,
        avatarUrl: typeof avatarUrl === 'string' ? avatarUrl.trim().slice(0, 500) : '',
        createdAt: now,
        updatedAt: now,
      }
      state.users[id] = created
      state.userByExternalId[safeExternalId] = id
      state.userByAccountId[accountId] = id
      state.userStats[id] = emptyStats(id)
      state.playerRatings[id] = createInitialRating(id)
      state.matchHistoryByUser[id] = []
      state.wallets[id] = { userId: id, balance: 10_000, currency: 'points', updatedAt: now }
      state.ledgerEntries.push({
        id: `led_${this.createId()}`,
        userId: id,
        amount: 10_000,
        balanceAfter: 10_000,
        type: 'welcome_bonus',
        referenceId: id,
        description: '开发账号初始积分',
        createdAt: now,
      })
      return { user: created, rating: state.playerRatings[id] }
    })
    return { ...this.accessTokens.issue(result.user.id), user: this.publicUser(result.user, result.rating) }
  }

  async devLogin ({ deviceId, externalId, displayName, avatarUrl } = {}) {
    const legacyIdentity = normalizeText(externalId, '', 80)
    const stableIdentity = normalizeText(deviceId, legacyIdentity || `guest-${this.createId()}`, 80)
    return this.loginExternal({ externalId: stableIdentity, displayName, avatarUrl })
  }

  async wxLogin ({ code, displayName, avatarUrl } = {}, wxCodeVerifier) {
    if (!wxCodeVerifier || typeof wxCodeVerifier.verify !== 'function') throw new TypeError('wxCodeVerifier 未配置')
    const identity = await wxCodeVerifier.verify(code)
    return this.loginExternal({ externalId: identity.externalId, displayName, avatarUrl })
  }

  async authenticate (token) {
    const claims = this.accessTokens.verify(token)
    const user = await this.store.read(state => state.users[claims.sub] || null)
    if (!user) throw unauthorized('登录用户不存在')
    return user
  }

  async getProfile (userId) {
    return this.store.read(state => {
      ensureAccountCollections(state)
      const user = state.users[userId]
      if (!user) throw notFound('USER_NOT_FOUND', '用户不存在')
      return this.publicUser(user, this.ensurePlayerRating(state, userId))
    })
  }

  async updateProfile (userId, { displayName, avatarUrl } = {}) {
    const now = this.now()
    return this.store.transaction(state => {
      ensureAccountCollections(state)
      const user = state.users[userId]
      if (!user) throw notFound('USER_NOT_FOUND', '用户不存在')
      if (displayName !== undefined) user.displayName = normalizeNickname(displayName, user.displayName)
      if (avatarUrl !== undefined) user.avatarUrl = normalizeText(avatarUrl, '', 500)
      if (displayName !== undefined || avatarUrl !== undefined) user.profileCustomizedAt = now || 1
      user.updatedAt = now
      return this.publicUser(user, this.ensurePlayerRating(state, userId))
    })
  }
}

export { emptyStats }
