import { randomUUID } from 'node:crypto'
import { badRequest, notFound } from './errors.js'
import { OperationsFeedbackService } from './operations-feedback-service.js'
import { playerMessages } from './operations-message-projection.js'
import { audit, capacity, featureIds, featureRecord, fields, newest, oneOf, operationsState, pagination, recordAt, requireFeature, requireRole, text, timestamp, versionMatches } from './operations-policy.js'

function announcementFields (body, updating) {
  fields(body, updating ? ['title', 'content', 'startsAt', 'endsAt', 'status', 'version'] : ['title', 'content', 'startsAt', 'endsAt'])
  const startsAt = timestamp(body.startsAt), endsAt = timestamp(body.endsAt)
  if (startsAt !== null && endsAt !== null && endsAt <= startsAt) throw badRequest('INVALID_TIME_RANGE', '结束时间必须晚于开始时间')
  return { title: text(body.title, '公告标题', 80), content: text(body.content, '公告内容', 4000), startsAt, endsAt,
    status: updating ? oneOf(body.status, ['draft', 'published', 'archived'], '公告状态') : 'draft' }
}

/** Operations authority, separate from match rules and ordinary player permissions. */
export class OperationsService {
  constructor ({ store, now = () => Date.now(), createId = randomUUID }) {
    Object.assign(this, { store, now, createId })
    this.feedback = new OperationsFeedbackService({ store, now, createId })
  }
  async getFeature (id) { return this.store.read(state => featureRecord(operationsState(state), id)) }
  async listFeatures () { return this.store.read(state => featureIds.map(id => featureRecord(operationsState(state), id))) }
  async updateFeature (actor, id, body) {
    requireRole(actor, ['admin', 'operator']); fields(body, ['version', 'status', 'title', 'detail'])
    const status = oneOf(body.status, ['open', 'closed', 'maintenance'], '服务状态')
    const title = text(body.title, '提示标题', 40), detail = text(body.detail, '提示内容', 300, 0)
    if (id === 'membership' && status === 'open') throw badRequest('FEATURE_NOT_IMPLEMENTED', '会员服务尚未实现，不能开放')
    return this.store.transaction(state => {
      const ops = operationsState(state), previous = featureRecord(ops, id)
      versionMatches(previous, body.version)
      const item = { id, status, title, detail, version: previous.version + 1, updatedAt: this.now() }
      ops.features[id] = item
      audit(ops, actor, 'feature.update', previous, item, this.now(), this.createId)
      return item
    })
  }
  async listAnnouncements (query) {
    return this.store.read(state => pagination(newest(Object.values(operationsState(state).announcements)), query))
  }
  async createAnnouncement (actor, body) {
    requireRole(actor, ['admin', 'operator'])
    const values = announcementFields(body, false)
    return this.store.transaction(state => {
      const ops = operationsState(state), now = this.now()
      capacity(Object.keys(ops.announcements).length, 10000)
      const item = { id: this.createId(), ...values, version: 1, createdAt: now, updatedAt: now }
      ops.announcements[item.id] = item
      audit(ops, actor, 'announcement.create', null, item, now, this.createId)
      return item
    })
  }
  async updateAnnouncement (actor, id, body) {
    requireRole(actor, ['admin', 'operator'])
    const values = announcementFields(body, true)
    return this.store.transaction(state => {
      const ops = operationsState(state), previous = recordAt(ops.announcements, id, '公告')
      versionMatches(previous, body.version)
      const item = { ...previous, ...values, version: previous.version + 1, updatedAt: this.now() }
      ops.announcements[id] = item
      audit(ops, actor, 'announcement.update', previous, item, this.now(), this.createId)
      return item
    })
  }
  async listAudit (actor, query) {
    requireRole(actor, ['admin'])
    return this.store.read(state => pagination(newest(operationsState(state).audit), query))
  }
  async listPlayerMessages (userId, query) {
    return this.store.read(state => {
      const ops = operationsState(state); requireFeature(ops, 'messages')
      const items = playerMessages(ops, userId, this.now())
      return { ...pagination(items, query), unreadCount: items.filter(item => !item.read).length }
    })
  }
  async readPlayerMessage (userId, id) {
    return this.store.transaction(state => {
      const ops = operationsState(state); requireFeature(ops, 'messages')
      recordAt(state.users, userId, '用户')
      if (!playerMessages(ops, userId, this.now()).some(item => item.id === id)) throw notFound('MESSAGE_NOT_FOUND', '消息不存在或已下架')
      ops.readReceipts[userId] ||= {}
      const receipts = ops.readReceipts[userId]
      if (!Object.hasOwn(receipts, id)) { capacity(Object.keys(receipts).length, 100000); receipts[id] = this.now() }
      return { read: true }
    })
  }
  listFeedback (actor, query) { return this.feedback.list(actor, query) }
  replyFeedback (actor, id, body) { return this.feedback.reply(actor, id, body) }
  updateFeedback (actor, id, body) { return this.feedback.update(actor, id, body) }
  listPlayerFeedback (userId, query) { return this.feedback.listMine(userId, query) }
  submitFeedback (userId, body, key) { return this.feedback.submit(userId, body, key) }
}
