import { createHash } from 'node:crypto'
import { badRequest, conflict, PlatformError } from './errors.js'
import { audit, capacity, fields, newest, oneOf, operationsState, pagination, recordAt, requireFeature, requireRole, text, versionMatches } from './operations-policy.js'

// Each newly added reply is audited once. Repeating the full reply history in
// before/after snapshots would turn one ticket's audit growth into O(replies²).
const feedbackAuditSnapshot = (item, reply) => ({
  id: item.id, userId: item.userId, version: item.version, status: item.status,
  replyCount: item.replies.length, updatedAt: item.updatedAt,
  ...(reply ? { reply } : {}),
})

/** Player submissions and staff responses share the platform transaction queue. */
export class OperationsFeedbackService {
  constructor ({ store, now, createId }) { Object.assign(this, { store, now, createId }) }
  async list (actor, query = {}) {
    requireRole(actor)
    if (query.status !== undefined) oneOf(query.status, ['open', 'resolved'], '反馈状态')
    return this.store.read(state => pagination(newest(Object.values(operationsState(state).feedback)
      .filter(item => !query.status || item.status === query.status)), query))
  }
  async listMine (userId, query) {
    return this.store.read(state => {
      const ops = operationsState(state); requireFeature(ops, 'feedback')
      return pagination(newest(Object.values(ops.feedback).filter(item => item.userId === userId)), query)
    })
  }
  async submit (userId, body, key) {
    fields(body, ['category', 'content'])
    const category = oneOf(body.category, ['bug', 'suggestion', 'other'], '反馈分类')
    const content = text(body.content, '反馈内容', 2000)
    if (typeof key !== 'string' || !/^[\w-]{8,128}$/.test(key)) throw badRequest('IDEMPOTENCY_KEY_REQUIRED', '请提供有效的重复提交保护标识')
    const receiptId = createHash('sha256').update(`${userId}\0${key}`).digest('hex')
    const signature = createHash('sha256').update(JSON.stringify({ category, content })).digest('hex')
    return this.store.transaction(state => {
      const ops = operationsState(state); requireFeature(ops, 'feedback')
      recordAt(state.users, userId, '用户')
      const previous = ops.idempotency[receiptId]
      if (previous) {
        if (previous.signature !== signature) throw conflict('IDEMPOTENCY_CONFLICT', '同一提交标识不能用于不同内容')
        return recordAt(ops.feedback, previous.id, '反馈')
      }
      const now = this.now(), mine = Object.values(ops.feedback).filter(item => item.userId === userId)
      if (mine.filter(item => now - item.createdAt < 3600000).length >= 5) throw new PlatformError(429, 'FEEDBACK_RATE_LIMIT', '一小时最多提交5条反馈，请稍后重试')
      capacity(mine.length, 1000); capacity(Object.keys(ops.feedback).length, 50000)
      const item = { id: this.createId(), userId, category, content, status: 'open', version: 1, createdAt: now, updatedAt: now, replies: [] }
      ops.feedback[item.id] = item
      ops.idempotency[receiptId] = { id: item.id, signature }
      return item
    })
  }
  async reply (actor, id, body) {
    requireRole(actor); fields(body, ['version', 'content'])
    const content = text(body.content, '回复内容', 2000)
    return this.store.transaction(state => {
      const ops = operationsState(state), item = recordAt(ops.feedback, id, '反馈')
      versionMatches(item, body.version); capacity(item.replies.length, 100)
      const before = feedbackAuditSnapshot(item), now = this.now()
      const reply = { id: this.createId(), content, createdAt: now }
      item.replies.push(reply)
      item.version++; item.updatedAt = now
      audit(ops, actor, 'feedback.reply', before, feedbackAuditSnapshot(item, reply), now, this.createId)
      return item
    })
  }
  async update (actor, id, body) {
    requireRole(actor); fields(body, ['version', 'status'])
    const status = oneOf(body.status, ['open', 'resolved'], '反馈状态')
    return this.store.transaction(state => {
      const ops = operationsState(state), item = recordAt(ops.feedback, id, '反馈')
      versionMatches(item, body.version)
      const before = feedbackAuditSnapshot(item), now = this.now()
      item.status = status; item.version++; item.updatedAt = now
      audit(ops, actor, 'feedback.status', before, feedbackAuditSnapshot(item), now, this.createId)
      return item
    })
  }
}
