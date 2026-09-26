import { badRequest, conflict, forbidden, notFound, serviceUnavailable } from './errors.js'

export const OPERATIONS_ROLES = ['admin', 'operator', 'support']
export const OPERATIONS_AUDIT_MAX_BYTES = 32 * 1024 * 1024
export function requireRole (actor, roles = OPERATIONS_ROLES) {
  if (!actor || typeof actor.id !== 'string' || !actor.id || !roles.includes(actor.role)) throw forbidden('没有此项运营权限')
}
export function fields (body, allowed) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw badRequest('INVALID_BODY', '请求内容必须是对象')
  if (Object.keys(body).some(key => !allowed.includes(key))) throw badRequest('UNKNOWN_FIELD', '请求包含不支持的字段')
}
export function text (value, label, max, min = 1) {
  if (typeof value !== 'string' || value.trim().length < min || value.trim().length > max || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value)) {
    throw badRequest('INVALID_TEXT', `${label}长度应为${min}—${max}字，且不能包含控制字符`)
  }
  return value.trim()
}
export function oneOf (value, values, label) {
  if (!values.includes(value)) throw badRequest('INVALID_OPTION', `${label}无效`)
  return value
}
export function timestamp (value) {
  if (value === null || value === undefined) return null
  if (!Number.isSafeInteger(value) || value < 0 || value > 8_640_000_000_000_000) throw badRequest('INVALID_TIME', '时间必须是有效毫秒时间戳')
  return value
}
export function versionMatches (record, version) {
  if (!Number.isSafeInteger(version) || version !== record.version) throw conflict('VERSION_CONFLICT', '内容已更新，请刷新后重试')
}
export function pagination (items, query = {}) {
  const page = Number(query.page ?? 1), pageSize = Number(query.pageSize ?? 20)
  if (!Number.isSafeInteger(page) || page < 1 || page > 100000 || !Number.isSafeInteger(pageSize) || pageSize < 1 || pageSize > 50) throw badRequest('INVALID_PAGE', '分页参数无效')
  return { items: items.slice((page - 1) * pageSize, page * pageSize), page, pageSize, total: items.length }
}
export function newest (items) { return items.sort((a, b) => b.createdAt - a.createdAt || b.id.localeCompare(a.id)) }
export function recordAt (records, id, label) {
  if (typeof id !== 'string' || !Object.hasOwn(records, id)) throw notFound('RECORD_NOT_FOUND', `${label}不存在`)
  return records[id]
}
export function operationsState (state) {
  state.operations ||= { announcements: {}, feedback: {}, features: {}, readReceipts: {}, audit: [], idempotency: {} }
  return state.operations
}
export function capacity (length, max) {
  if (length >= max) throw serviceUnavailable('OPERATIONS_CAPACITY', '运营记录容量已满，请联系管理员归档后重试')
}
export function audit (ops, actor, action, before, after, now, createId) {
  capacity(ops.audit.length, 100000)
  const entry = { id: createId(), actorId: actor.id, action, targetId: after.id,
    before: before ? structuredClone(before) : null, after: structuredClone(after), createdAt: now }
  // Lazily account for pre-existing entries without rewriting the append-only audit.
  // Count UTF-8 JSON bytes (including array delimiters), not UTF-16 string length.
  const currentBytes = Number.isSafeInteger(ops.auditBytes) && ops.auditBytes >= 2
    ? ops.auditBytes : Buffer.byteLength(JSON.stringify(ops.audit), 'utf8')
  const nextBytes = currentBytes + Buffer.byteLength(JSON.stringify(entry), 'utf8') + (ops.audit.length ? 1 : 0)
  if (nextBytes > OPERATIONS_AUDIT_MAX_BYTES) throw serviceUnavailable('OPERATIONS_AUDIT_CAPACITY', '审计存储容量已满，请联系管理员处理后重试')
  ops.audit.push(entry)
  ops.auditBytes = nextBytes
}

const defaults = {
  messages: { status: 'open', title: '消息中心', detail: '查看系统公告和反馈回复。' },
  feedback: { status: 'open', title: '意见反馈', detail: '提交问题并查看处理回复。' },
  membership: { status: 'closed', title: '会员服务筹备中', detail: '目前不提供开通或付费服务。' },
}
export function featureRecord (ops, id) {
  if (!Object.hasOwn(defaults, id)) throw notFound('LOBBY_SERVICE_NOT_FOUND', '服务入口不存在')
  return Object.hasOwn(ops.features, id) ? ops.features[id] : { id, ...defaults[id], version: 1, updatedAt: 0 }
}
export const featureIds = Object.keys(defaults)
export function requireFeature (ops, id) {
  const feature = featureRecord(ops, id)
  if (feature.status !== 'open') throw serviceUnavailable('FEATURE_UNAVAILABLE', feature.detail || feature.title)
}
