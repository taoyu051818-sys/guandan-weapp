import type {
  MerchantApplication,
  MerchantConsole,
  MerchantEmployee,
  MerchantEmployeeDraft,
  MerchantEmployeeStatus,
  MerchantGateway,
  MerchantGrantStatus,
  MerchantPointGrant,
  MerchantPointGrantDraft,
  MerchantProfile,
  MerchantRole,
  MerchantStatus,
  MerchantStore,
  MerchantStoreDraft,
  MerchantStoreStatus,
} from '../FrontPageGatewayContracts'
import { PlatformApiClient } from './client'
import { PlatformApiError } from './contracts'
import { idempotencyKey, malformedResponse, nonNegativeInteger, positiveInteger, requireArray, requireNonEmptyString, requireRecord } from './validation'

const merchantStatuses: MerchantStatus[] = ['pending', 'active', 'suspended', 'rejected']
const merchantRoles: MerchantRole[] = ['owner', 'manager', 'cashier']
const merchantStoreStatuses: MerchantStoreStatus[] = ['active', 'inactive']
const merchantEmployeeStatuses: MerchantEmployeeStatus[] = ['active', 'inactive']
const merchantGrantStatuses: MerchantGrantStatus[] = ['posted', 'reversed']

const requireMerchantStatus = (value: unknown, context: string): MerchantStatus => {
  if (!merchantStatuses.includes(value as MerchantStatus)) throw malformedResponse(`${context}不合法`, { value })
  return value as MerchantStatus
}

const requireMerchantRole = (value: unknown, context: string): MerchantRole => {
  if (!merchantRoles.includes(value as MerchantRole)) throw malformedResponse(`${context}不合法`, { value })
  return value as MerchantRole
}

const normalizeMerchantProfile = (value: unknown, context: string): MerchantProfile => {
  const merchant = requireRecord(value, context)
  return {
    id: requireNonEmptyString(merchant.id, `${context} ID`),
    ownerUserId: requireNonEmptyString(merchant.ownerUserId, `${context}负责人 ID`),
    name: requireNonEmptyString(merchant.name, `${context}名称`),
    contactName: requireNonEmptyString(merchant.contactName, `${context}联系人`),
    status: requireMerchantStatus(merchant.status, `${context}状态`),
    dailyPointLimit: nonNegativeInteger(merchant.dailyPointLimit, `${context}日发放限额`),
    createdAt: nonNegativeInteger(merchant.createdAt, `${context}创建时间`),
  }
}

const normalizeMerchantStore = (value: unknown, context: string): MerchantStore => {
  const store = requireRecord(value, context)
  if (!merchantStoreStatuses.includes(store.status as MerchantStoreStatus)) throw malformedResponse(`${context}状态不合法`, { value: store.status })
  return {
    id: requireNonEmptyString(store.id, `${context} ID`),
    merchantId: requireNonEmptyString(store.merchantId, `${context}商户 ID`),
    name: requireNonEmptyString(store.name, `${context}名称`),
    address: typeof store.address === 'string' ? store.address : (() => { throw malformedResponse(`${context}地址格式不正确`) })(),
    status: store.status as MerchantStoreStatus,
    createdAt: nonNegativeInteger(store.createdAt, `${context}创建时间`),
  }
}

const normalizeMerchantEmployee = (value: unknown, context: string): MerchantEmployee => {
  const employee = requireRecord(value, context)
  if (!['manager', 'cashier'].includes(String(employee.role))) throw malformedResponse(`${context}角色不合法`, { value: employee.role })
  if (!merchantEmployeeStatuses.includes(employee.status as MerchantEmployeeStatus)) throw malformedResponse(`${context}状态不合法`, { value: employee.status })
  return {
    id: requireNonEmptyString(employee.id, `${context} ID`),
    merchantId: requireNonEmptyString(employee.merchantId, `${context}商户 ID`),
    userId: requireNonEmptyString(employee.userId, `${context}用户 ID`),
    role: employee.role as MerchantEmployee['role'],
    status: employee.status as MerchantEmployeeStatus,
    updatedAt: nonNegativeInteger(employee.updatedAt, `${context}更新时间`),
  }
}

const normalizeMerchantPointGrant = (value: unknown, context: string): MerchantPointGrant => {
  const grant = requireRecord(value, context)
  if (!merchantGrantStatuses.includes(grant.status as MerchantGrantStatus)) throw malformedResponse(`${context}状态不合法`, { value: grant.status })
  if (grant.duplicate !== undefined && typeof grant.duplicate !== 'boolean') throw malformedResponse(`${context}重复标记不合法`, { value: grant.duplicate })
  const amount = positiveInteger(grant.amount, `${context}积分数量`)
  if (amount > 1000) throw malformedResponse(`${context}积分数量超过单次上限`, { value: grant.amount })
  return {
    id: requireNonEmptyString(grant.id, `${context} ID`),
    merchantId: requireNonEmptyString(grant.merchantId, `${context}商户 ID`),
    storeId: requireNonEmptyString(grant.storeId, `${context}门店 ID`),
    operatorUserId: requireNonEmptyString(grant.operatorUserId, `${context}操作员 ID`),
    recipientUserId: requireNonEmptyString(grant.recipientUserId, `${context}接收用户 ID`),
    amount,
    note: typeof grant.note === 'string' ? grant.note : (() => { throw malformedResponse(`${context}备注格式不正确`) })(),
    status: grant.status as MerchantGrantStatus,
    createdAt: nonNegativeInteger(grant.createdAt, `${context}创建时间`),
    ...(typeof grant.duplicate === 'boolean' ? { duplicate: grant.duplicate } : {}),
  }
}

const normalizeMerchantConsole = (value: unknown): MerchantConsole => {
  const payload = requireRecord(value, '商户后台响应')
  const merchant = normalizeMerchantProfile(payload.merchant, '商户资料')
  const role = requireMerchantRole(payload.role, '商户角色')
  const stores = requireArray(payload.stores, '商户门店列表').map((item, index) => normalizeMerchantStore(item, `第 ${index + 1} 个商户门店`))
  const employees = requireArray(payload.employees, '商户员工列表').map((item, index) => normalizeMerchantEmployee(item, `第 ${index + 1} 个商户员工`))
  const grants = requireArray(payload.grants, '商户积分发放列表').map((item, index) => normalizeMerchantPointGrant(item, `第 ${index + 1} 条积分发放`))
  const foreignRecord = [...stores, ...employees, ...grants].find(item => item.merchantId !== merchant.id)
  if (foreignRecord) throw malformedResponse('商户后台响应包含其他商户的数据', { recordId: foreignRecord.id })
  return { merchant, role, stores, employees, grants, grantedPoints: nonNegativeInteger(payload.grantedPoints, '商户累计发放积分') }
}

const invalidMerchantInput = (message: string): PlatformApiError => new PlatformApiError(message, {
  code: 'INVALID_MERCHANT_INPUT',
  retryable: false,
})

export class HttpMerchantGateway implements MerchantGateway {
  private readonly uncertainMutationKeys = new Map<string, string>()

  public constructor (private readonly client: PlatformApiClient) {}

  public async getConsole (): Promise<MerchantConsole> {
    return normalizeMerchantConsole(await this.client.request<unknown>('/api/v1/merchants/me'))
  }

  public async apply (application: MerchantApplication): Promise<MerchantProfile> {
    const name = application.name.trim()
    const contactName = application.contactName?.trim() ?? ''
    if (!name || name.length > 60) throw invalidMerchantInput('商户名称必须为 1 到 60 个字符')
    if (contactName.length > 40) throw invalidMerchantInput('联系人姓名不能超过 40 个字符')
    return this.mutate(`apply\u0000${name}\u0000${contactName}`, 'merchant-apply', async key => {
      const payload = requireRecord(await this.client.request<unknown>('/api/v1/merchants/apply', 'POST', {
        name,
        ...(contactName ? { contactName } : {}),
      }, { 'Idempotency-Key': key }), '商户申请响应')
      return normalizeMerchantProfile(payload.merchant, '商户申请')
    })
  }

  public async createStore (draft: MerchantStoreDraft): Promise<MerchantStore> {
    const name = draft.name.trim()
    const address = draft.address?.trim() ?? ''
    if (!name || name.length > 60) throw invalidMerchantInput('门店名称必须为 1 到 60 个字符')
    if (address.length > 120) throw invalidMerchantInput('门店地址不能超过 120 个字符')
    return this.mutate(`store\u0000${name}\u0000${address}`, 'merchant-store', async key => {
      const payload = requireRecord(await this.client.request<unknown>('/api/v1/merchants/stores', 'POST', {
        name,
        ...(address ? { address } : {}),
      }, { 'Idempotency-Key': key }), '创建门店响应')
      return normalizeMerchantStore(payload.store, '创建的门店')
    })
  }

  public async addEmployee (draft: MerchantEmployeeDraft): Promise<MerchantEmployee> {
    const employeeUserId = draft.employeeUserId.trim()
    if (!employeeUserId || employeeUserId.length > 100) throw invalidMerchantInput('员工用户 ID 必须为 1 到 100 个字符')
    if (!['manager', 'cashier'].includes(draft.role)) throw invalidMerchantInput('员工角色只能是管理员或收银员')
    return this.mutate(`employee\u0000${employeeUserId}\u0000${draft.role}`, 'merchant-employee', async key => {
      const payload = requireRecord(await this.client.request<unknown>('/api/v1/merchants/employees', 'POST', {
        employeeUserId,
        role: draft.role,
      }, { 'Idempotency-Key': key }), '添加员工响应')
      return normalizeMerchantEmployee(payload.employee, '添加的员工')
    })
  }

  public async grantPoints (draft: MerchantPointGrantDraft): Promise<MerchantPointGrant> {
    const storeId = draft.storeId.trim()
    const recipientUserId = draft.recipientUserId.trim()
    const note = draft.note?.trim() ?? ''
    if (!storeId) throw invalidMerchantInput('请选择有效门店')
    if (!recipientUserId || recipientUserId.length > 100) throw invalidMerchantInput('积分接收用户 ID 必须为 1 到 100 个字符')
    if (!Number.isSafeInteger(draft.amount) || draft.amount < 1 || draft.amount > 1000) throw invalidMerchantInput('单次积分必须是 1 到 1000 的整数')
    if (note.length > 80) throw invalidMerchantInput('积分发放备注不能超过 80 个字符')
    return this.mutate(`grant\u0000${storeId}\u0000${recipientUserId}\u0000${draft.amount}\u0000${note}`, 'merchant-grant', async key => {
      const payload = requireRecord(await this.client.request<unknown>('/api/v1/merchants/points/grant', 'POST', {
        storeId,
        recipientUserId,
        amount: draft.amount,
        ...(note ? { note } : {}),
      }, { 'Idempotency-Key': key }), '积分发放响应')
      return normalizeMerchantPointGrant(payload.grant, '积分发放记录')
    })
  }

  private async mutate<T> (operation: string, prefix: string, request: (key: string) => Promise<T>): Promise<T> {
    const key = this.uncertainMutationKeys.get(operation) ?? idempotencyKey(prefix)
    this.uncertainMutationKeys.set(operation, key)
    try {
      const result = await request(key)
      if (this.uncertainMutationKeys.get(operation) === key) this.uncertainMutationKeys.delete(operation)
      return result
    } catch (error) {
      if (error instanceof PlatformApiError && error.status >= 400 && error.status < 500 && this.uncertainMutationKeys.get(operation) === key) {
        this.uncertainMutationKeys.delete(operation)
      }
      throw error
    }
  }
}
