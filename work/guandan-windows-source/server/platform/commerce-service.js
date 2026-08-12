import { classicStakeForMode } from './classic-stakes.js'
import { canonicalJsonFingerprint, matchesJsonFingerprint } from './canonical-json.js'
import { badRequest, conflict, notFound } from './errors.js'

const normalizeText = (value, fallback, maxLength) => {
  const text = typeof value === 'string' ? value.trim() : ''
  return (text || fallback).slice(0, maxLength)
}

const requireIdempotencyKey = (value) => {
  const key = typeof value === 'string' ? value.trim() : ''
  if (!key || key.length > 128) throw badRequest('IDEMPOTENCY_KEY_REQUIRED', 'Idempotency-Key 必填且不能超过128字符')
  return key
}

const fingerprint = canonicalJsonFingerprint

export const reservedClassicStakeForUser = (state, userId) => {
  const activeMatchId = state.activeMatchByUser?.[userId]
  const match = activeMatchId ? state.matches?.[activeMatchId] : null
  if (!match || !['matching', 'matched', 'playing'].includes(match.status)) return 0
  const participant = Array.isArray(match.participants)
    ? match.participants.find(item => item.userId === userId)
    : null
  if (!participant || !['matching', 'matched', 'playing'].includes(participant.status)) return 0
  return classicStakeForMode(match.mode) || 0
}

export const walletAvailability = (state, userId, wallet) => {
  const reserved = reservedClassicStakeForUser(state, userId)
  return {
    balance: wallet.balance,
    reserved,
    available: Math.max(0, wallet.balance - reserved),
  }
}

export class CommerceService {
  constructor ({ store, now = () => Date.now(), createId } = {}) {
    if (!store || typeof createId !== 'function') throw new TypeError('CommerceService 缺少 store/createId')
    this.store = store
    this.now = now
    this.createId = createId
  }

  async getWallet (userId, limit = 20) {
    return this.store.read(state => {
      const wallet = state.wallets[userId]
      if (!wallet) throw notFound('WALLET_NOT_FOUND', '积分账户不存在')
      const ledgerEntries = state.ledgerEntries.filter(entry => entry.userId === userId).slice(-Math.max(1, Math.min(100, limit))).reverse()
      return { wallet: { ...wallet, ...walletAvailability(state, userId, wallet) }, ledgerEntries }
    })
  }

  async listProducts () {
    return this.store.read(state => Object.values(state.products).sort((left, right) => left.pointsPrice - right.pointsPrice))
  }

  async redeem (userId, { productId, quantity = 1, expectedPointsPrice } = {}, idempotencyKey) {
    const key = requireIdempotencyKey(idempotencyKey)
    const safeQuantity = Number(quantity)
    if (!Number.isSafeInteger(safeQuantity) || safeQuantity < 1 || safeQuantity > 99) throw badRequest('INVALID_QUANTITY', '兑换数量必须是1到99的整数')
    const safeProductId = normalizeText(productId, '', 80)
    if (!safeProductId) throw badRequest('PRODUCT_ID_REQUIRED', 'productId 必填')
    const normalizedExpectedPrice = expectedPointsPrice === undefined ? null : Number(expectedPointsPrice)
    if (normalizedExpectedPrice !== null && (!Number.isSafeInteger(normalizedExpectedPrice) || normalizedExpectedPrice < 0)) {
      throw badRequest('INVALID_EXPECTED_PRICE', 'expectedPointsPrice 必须是非负整数')
    }
    const request = { productId: safeProductId, quantity: safeQuantity, expectedPointsPrice: normalizedExpectedPrice }
    const requestFingerprint = fingerprint(request)
    const now = this.now()
    return this.store.transaction(state => {
      const idempotencyId = `${userId}:${key}`
      const previous = state.orderIdempotency[idempotencyId]
      if (previous) {
        if (!matchesJsonFingerprint(previous.fingerprint, request)) throw conflict('IDEMPOTENCY_CONFLICT', '同一个 Idempotency-Key 不能用于不同兑换请求')
        return state.orders[previous.orderId]
      }
      const product = state.products[safeProductId]
      if (!product) throw notFound('PRODUCT_NOT_FOUND', '商品不存在')
      if (normalizedExpectedPrice !== null && product.pointsPrice !== normalizedExpectedPrice) {
        throw conflict('PRODUCT_PRICE_CHANGED', '商品兑换价已变更，请刷新后确认', { expected: normalizedExpectedPrice, current: product.pointsPrice })
      }
      if (product.stock < safeQuantity) throw conflict('OUT_OF_STOCK', '商品库存不足', { stock: product.stock })
      const wallet = state.wallets[userId]
      if (!wallet) throw notFound('WALLET_NOT_FOUND', '积分账户不存在')
      const totalPoints = product.pointsPrice * safeQuantity
      const availability = walletAvailability(state, userId, wallet)
      if (availability.available < totalPoints) throw conflict('INSUFFICIENT_POINTS', '可用积分不足', { ...availability, required: totalPoints })
      const order = {
        orderId: `ord_${this.createId()}`,
        userId,
        productId: product.id,
        quantity: safeQuantity,
        totalPoints,
        status: 'paid',
        createdAt: now,
      }
      product.stock -= safeQuantity
      wallet.balance -= totalPoints
      wallet.updatedAt = now
      state.orders[order.orderId] = order
      state.orderIdempotency[idempotencyId] = { fingerprint: requestFingerprint, orderId: order.orderId }
      state.ledgerEntries.push({
        id: `led_${this.createId()}`,
        userId,
        amount: -totalPoints,
        balanceAfter: wallet.balance,
        type: 'shop_redeem',
        referenceId: order.orderId,
        description: `兑换商品：${product.name}`,
        createdAt: now,
      })
      return order
    })
  }
}
