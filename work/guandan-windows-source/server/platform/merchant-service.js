import { badRequest, conflict, forbidden, notFound } from './errors.js'
import { canonicalJsonFingerprint, matchesJsonFingerprint } from './canonical-json.js'

const normalizeText = (value, fallback, maxLength) => {
  const text = typeof value === 'string' ? value.trim() : ''
  return (text || fallback).slice(0, maxLength)
}

const requireIdempotencyKey = (value) => {
  const key = typeof value === 'string' ? value.trim() : ''
  if (!key || key.length > 128) throw badRequest('IDEMPOTENCY_KEY_REQUIRED', 'Idempotency-Key 必填且不能超过128字符')
  return key
}

const requireGrantAmount = (value) => {
  const normalized = Number(value)
  if (!Number.isSafeInteger(normalized) || normalized < 1 || normalized > 1000) {
    throw badRequest('INVALID_GRANT_AMOUNT', '单次积分必须是1到1000的整数')
  }
  return normalized
}

const fingerprint = canonicalJsonFingerprint

const ensureMerchantCollections = (state) => {
  state.merchants ||= {}
  state.merchantByOwner ||= {}
  state.merchantStores ||= {}
  state.merchantEmployees ||= {}
  state.merchantPointGrants ||= {}
  state.merchantIdempotency ||= {}
}

export class MerchantService {
  constructor ({ store, now = () => Date.now(), createId } = {}) {
    if (!store || typeof createId !== 'function') throw new TypeError('MerchantService 缺少 store/createId')
    this.store = store
    this.now = now
    this.createId = createId
  }

  merchantContext (state, userId, { allowPending = false } = {}) {
    ensureMerchantCollections(state)
    const ownedId = state.merchantByOwner[userId]
    if (ownedId && state.merchants[ownedId]) {
      const merchant = state.merchants[ownedId]
      if (!allowPending && merchant.status !== 'active') throw forbidden('商户申请尚未审核通过')
      return { merchant, role: 'owner' }
    }
    const employee = Object.values(state.merchantEmployees).find(item => item.userId === userId && item.status === 'active')
    if (employee && state.merchants[employee.merchantId]) {
      const merchant = state.merchants[employee.merchantId]
      if (!allowPending && merchant.status !== 'active') throw forbidden('商户账户当前不可用')
      return { merchant, role: employee.role, employee }
    }
    throw forbidden('当前账号没有商户后台权限')
  }

  async apply (userId, { name, contactName } = {}) {
    const safeName = normalizeText(name, '', 60)
    if (!safeName) throw badRequest('MERCHANT_NAME_REQUIRED', '商户名称不能为空')
    const now = this.now()
    return this.store.transaction(state => {
      ensureMerchantCollections(state)
      const existingId = state.merchantByOwner[userId]
      if (existingId) return state.merchants[existingId]
      const merchant = {
        id: `mch_${this.createId()}`,
        ownerUserId: userId,
        name: safeName,
        contactName: normalizeText(contactName, state.users[userId]?.displayName || '负责人', 40),
        status: 'pending',
        dailyPointLimit: 5000,
        createdAt: now,
      }
      state.merchants[merchant.id] = merchant
      state.merchantByOwner[userId] = merchant.id
      return merchant
    })
  }

  async getConsole (userId) {
    return this.store.read(state => {
      const context = this.merchantContext(state, userId, { allowPending: true })
      const merchantId = context.merchant.id
      const stores = Object.values(state.merchantStores).filter(item => item.merchantId === merchantId)
      const employees = Object.values(state.merchantEmployees).filter(item => item.merchantId === merchantId)
      const grants = Object.values(state.merchantPointGrants).filter(item => item.merchantId === merchantId).sort((left, right) => right.createdAt - left.createdAt).slice(0, 50)
      return {
        merchant: context.merchant,
        role: context.role,
        stores,
        employees,
        grants,
        grantedPoints: grants.filter(item => item.status === 'posted').reduce((total, item) => total + item.amount, 0),
      }
    })
  }

  async createStore (userId, { name, address } = {}, idempotencyKey) {
    const key = requireIdempotencyKey(idempotencyKey)
    const safeName = normalizeText(name, '', 60)
    const safeAddress = normalizeText(address, '', 120)
    if (!safeName) throw badRequest('STORE_NAME_REQUIRED', '门店名称不能为空')
    const now = this.now()
    return this.store.transaction(state => {
      const context = this.merchantContext(state, userId)
      if (!['owner', 'manager'].includes(context.role)) throw forbidden('只有商户负责人或管理员可以创建门店')
      const idem = `${context.merchant.id}:store:${key}`
      const previous = state.merchantIdempotency[idem]
      if (previous) {
        const existing = Object.hasOwn(state.merchantStores, previous) ? state.merchantStores[previous] : null
        if (!existing || existing.merchantId !== context.merchant.id || existing.name !== safeName || (existing.address ?? '') !== safeAddress) {
          throw conflict('IDEMPOTENCY_CONFLICT', '同一个 Idempotency-Key 不能用于不同门店创建请求')
        }
        return existing
      }
      const store = {
        id: `str_${this.createId()}`,
        merchantId: context.merchant.id,
        name: safeName,
        address: safeAddress,
        status: 'active',
        createdAt: now,
      }
      state.merchantStores[store.id] = store
      state.merchantIdempotency[idem] = store.id
      return store
    })
  }

  async addEmployee (userId, { employeeUserId, role = 'cashier' } = {}) {
    const safeEmployeeId = normalizeText(employeeUserId, '', 100)
    if (!['cashier', 'manager'].includes(role)) throw badRequest('INVALID_EMPLOYEE_ROLE', '员工角色只能是 cashier 或 manager')
    return this.store.transaction(state => {
      const context = this.merchantContext(state, userId)
      if (context.role !== 'owner') throw forbidden('只有商户负责人可以管理员工')
      if (!state.users[safeEmployeeId]) throw notFound('EMPLOYEE_USER_NOT_FOUND', '员工用户不存在')
      const id = `${context.merchant.id}:${safeEmployeeId}`
      const employee = { id, merchantId: context.merchant.id, userId: safeEmployeeId, role, status: 'active', updatedAt: this.now() }
      state.merchantEmployees[id] = employee
      return employee
    })
  }

  async grantPoints (userId, { storeId, recipientUserId, amount, note } = {}, idempotencyKey) {
    const key = requireIdempotencyKey(idempotencyKey)
    const points = requireGrantAmount(amount)
    const now = this.now()
    return this.store.transaction(state => {
      const context = this.merchantContext(state, userId)
      const store = state.merchantStores[storeId]
      if (!store || store.merchantId !== context.merchant.id || store.status !== 'active') throw notFound('STORE_NOT_FOUND', '门店不存在或不可用')
      const recipient = state.users[recipientUserId]
      const wallet = state.wallets[recipientUserId]
      if (!recipient || !wallet) throw notFound('RECIPIENT_NOT_FOUND', '积分接收用户不存在')
      const recipientIsMerchantParty = recipientUserId === context.merchant.ownerUserId || Object.values(state.merchantEmployees).some(item => item.merchantId === context.merchant.id && item.userId === recipientUserId && item.status === 'active')
      if (recipientIsMerchantParty) throw forbidden('商户不能向负责人或员工账户发放积分')
      const normalizedNote = normalizeText(note, '', 80)
      const idem = `${context.merchant.id}:grant:${key}`
      const request = { storeId, recipientUserId, amount: points, note: normalizedNote }
      const requestFingerprint = fingerprint(request)
      const previous = state.merchantIdempotency[idem]
      if (previous) {
        const grant = state.merchantPointGrants[previous]
        if (!matchesJsonFingerprint(grant.fingerprint, request)) throw conflict('IDEMPOTENCY_CONFLICT', '同一个 Idempotency-Key 不能用于不同积分发放')
        return { ...grant, duplicate: true }
      }
      const dayStart = new Date(now).setHours(0, 0, 0, 0)
      const grantedToday = Object.values(state.merchantPointGrants).filter(item => item.merchantId === context.merchant.id && item.createdAt >= dayStart && item.status === 'posted').reduce((total, item) => total + item.amount, 0)
      if (grantedToday + points > context.merchant.dailyPointLimit) throw conflict('MERCHANT_DAILY_LIMIT', '商户今日积分发放额度不足', { grantedToday, dailyLimit: context.merchant.dailyPointLimit })
      wallet.balance += points
      wallet.updatedAt = now
      const grant = {
        id: `mgr_${this.createId()}`,
        merchantId: context.merchant.id,
        storeId,
        operatorUserId: userId,
        recipientUserId,
        amount: points,
        note: normalizedNote,
        status: 'posted',
        createdAt: now,
        fingerprint: requestFingerprint,
      }
      state.merchantPointGrants[grant.id] = grant
      state.merchantIdempotency[idem] = grant.id
      state.ledgerEntries.push({
        id: `led_${this.createId()}`,
        userId: recipientUserId,
        amount: points,
        balanceAfter: wallet.balance,
        type: 'merchant_grant',
        referenceId: grant.id,
        description: `商户积分：${context.merchant.name}`,
        createdAt: now,
      })
      return { ...grant, duplicate: false }
    })
  }
}
