import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { OperationsService } from './operations-service.js'
import { OPERATIONS_AUDIT_MAX_BYTES } from './operations-policy.js'
import { MemoryPlatformStore, JsonFilePlatformStore, createEmptyPlatformState } from './storage.js'

const initial = createEmptyPlatformState()
initial.users.u1 = { id: 'u1' }; initial.users.u2 = { id: 'u2' }
const store = new MemoryPlatformStore(initial)
let now = 1780000000000, sequence = 0
const options = { store, now: () => now, createId: () => `op-${++sequence}` }
const service = new OperationsService(options)
const admin = { id: 'owner', role: 'admin' }, operator = { id: 'operator', role: 'operator' }, support = { id: 'support', role: 'support' }
const rejects = (operation, code) => assert.rejects(operation, error => error.code === code)
const copyFields = item => ({ title: item.title, content: item.content, startsAt: item.startsAt, endsAt: item.endsAt, status: item.status, version: item.version })

assert.equal((await service.getFeature('messages')).status, 'open')
assert.equal((await service.getFeature('membership')).status, 'closed')
await rejects(service.getFeature('__proto__'), 'LOBBY_SERVICE_NOT_FOUND')
await rejects(service.createAnnouncement(support, { title: 'a', content: 'b' }), 'FORBIDDEN')
await rejects(service.createAnnouncement(admin, { title: 'a', content: 'b', injected: true }), 'UNKNOWN_FIELD')
await rejects(service.createAnnouncement(admin, { title: 'a', content: 'b', startsAt: 2, endsAt: 1 }), 'INVALID_TIME_RANGE')
let announcement = await service.createAnnouncement(operator, { title: '  更新公告 ', content: '<script>plain text only</script>', startsAt: null, endsAt: null })
assert.equal(announcement.title, '更新公告')
assert.equal((await service.listPlayerMessages('u1')).total, 0, 'drafts never reach players')
announcement = await service.updateAnnouncement(operator, announcement.id, { ...copyFields(announcement), status: 'published', startsAt: now + 1000 })
assert.equal((await service.listPlayerMessages('u1')).total, 0, 'scheduled publication is not early')
now += 1000
let messages = await service.listPlayerMessages('u1')
assert.equal(messages.total, 1); assert.equal(messages.unreadCount, 1)
assert.equal(messages.items[0].content, '<script>plain text only</script>', 'no HTML execution/interpretation in domain')
await service.readPlayerMessage('u1', messages.items[0].id)
assert.equal((await service.listPlayerMessages('u1')).unreadCount, 0)
assert.equal((await service.listPlayerMessages('u2')).unreadCount, 1, 'read receipts belong to one user')
await rejects(service.readPlayerMessage('u1', 'unknown'), 'MESSAGE_NOT_FOUND')
const edited = { ...copyFields(announcement), title: '新版公告' }
const race = await Promise.allSettled([service.updateAnnouncement(admin, announcement.id, edited), service.updateAnnouncement(admin, announcement.id, edited)])
assert.equal(race.filter(item => item.status === 'fulfilled').length, 1, 'concurrent version check is inside transaction')
assert.equal(race.find(item => item.status === 'rejected').reason.code, 'VERSION_CONFLICT')
announcement = race.find(item => item.status === 'fulfilled').value
assert.equal((await service.listPlayerMessages('u1')).unreadCount, 1, 'new publication version is unread')
announcement = await service.updateAnnouncement(admin, announcement.id, { ...copyFields(announcement), endsAt: now + 1 })
now += 1
assert.equal((await service.listPlayerMessages('u1')).total, 0, 'end boundary is exclusive')
announcement = await service.updateAnnouncement(admin, announcement.id, { ...copyFields(announcement), status: 'archived' })
assert.equal((await service.listAnnouncements()).total, 1, 'archive retains recoverable content')
await rejects(service.listAnnouncements({ pageSize: 999 }), 'INVALID_PAGE')
await rejects(service.listAudit(operator), 'FORBIDDEN')

const feedbackBody = { category: 'bug', content: '进入房间后出现断线提示' }
const [first, duplicate] = await Promise.all([service.submitFeedback('u1', feedbackBody, 'feedback-key-1'), service.submitFeedback('u1', feedbackBody, 'feedback-key-1')])
assert.equal(first.id, duplicate.id)
assert.equal((await service.listPlayerFeedback('u1')).total, 1)
assert.equal((await service.listPlayerFeedback('u2')).total, 0)
await rejects(service.submitFeedback('u1', { ...feedbackBody, content: 'different' }, 'feedback-key-1'), 'IDEMPOTENCY_CONFLICT')
await rejects(service.submitFeedback('u1', { ...feedbackBody, userId: 'u2' }, 'feedback-key-2'), 'UNKNOWN_FIELD')
await rejects(service.submitFeedback('u1', feedbackBody, 'x'), 'IDEMPOTENCY_KEY_REQUIRED')
await rejects(service.submitFeedback('unknown', feedbackBody, 'feedback-key-1'), 'RECORD_NOT_FOUND')
let feedback = await service.replyFeedback(support, first.id, { version: first.version, content: '已修复，请重试。' })
assert.equal(feedback.replies.length, 1)
messages = await service.listPlayerMessages('u1')
assert.equal(messages.total, 1); assert.equal(messages.items[0].kind, 'feedback')
assert.equal((await service.listPlayerMessages('u2')).total, 0, 'private feedback replies do not leak')
await rejects(service.readPlayerMessage('u2', messages.items[0].id), 'MESSAGE_NOT_FOUND')
await rejects(service.replyFeedback(support, first.id, { version: first.version, content: 'duplicate' }), 'VERSION_CONFLICT')
feedback = await service.updateFeedback(support, first.id, { version: feedback.version, status: 'resolved' })
assert.equal((await service.listFeedback(support, { status: 'resolved' })).total, 1)
assert.equal((await service.listFeedback(admin, { status: 'open' })).total, 0)
assert.ok(!JSON.stringify(await service.listPlayerFeedback('u1')).includes('actorId'))
for (let n = 2; n <= 5; n++) await service.submitFeedback('u1', feedbackBody, `feedback-key-${n}`)
await rejects(service.submitFeedback('u1', feedbackBody, 'feedback-key-6'), 'FEEDBACK_RATE_LIMIT')
assert.equal((await service.submitFeedback('u1', feedbackBody, 'feedback-key-1')).id, first.id, 'retry remains possible after rate limit')
now += 3600000
await service.submitFeedback('u1', feedbackBody, 'feedback-key-6')

let feature = await service.getFeature('feedback')
await rejects(service.updateFeature(support, feature.id, { version: feature.version, status: 'closed', title: '关闭', detail: '' }), 'FORBIDDEN')
feature = await service.updateFeature(admin, feature.id, { version: feature.version, status: 'maintenance', title: '反馈维护', detail: '维护中，请稍后重试' })
await rejects(service.submitFeedback('u2', feedbackBody, 'feedback-key-2'), 'FEATURE_UNAVAILABLE')
await rejects(service.listPlayerFeedback('u1'), 'FEATURE_UNAVAILABLE')
assert.equal((await service.listFeedback(support)).total, 6, 'staff can process tickets during maintenance')
await rejects(service.updateFeature(admin, 'membership', { version: 1, status: 'open', title: '会员', detail: '' }), 'FEATURE_NOT_IMPLEMENTED')
await service.updateFeature(admin, 'messages', { version: 1, status: 'closed', title: '暂停', detail: '' })
await rejects(service.listPlayerMessages('u1'), 'FEATURE_UNAVAILABLE')
await rejects(service.readPlayerMessage('u1', messages.items[0].id), 'FEATURE_UNAVAILABLE')

const audit = await service.listAudit(admin, { pageSize: 50 })
assert.ok(audit.items.some(item => item.action === 'feedback.reply' && item.actorId === 'support'))
assert.ok(audit.items.some(item => item.action === 'announcement.update' && item.before.status === 'draft' && item.after.status === 'published'))
const snapshot = await store.read(state => state)
assert.deepEqual(snapshot.wallets, (await new MemoryPlatformStore(initial).read(state => state)).wallets, 'operations cannot change balances')

const dir = await mkdtemp(join(tmpdir(), 'operations-persistence-'))
try {
  const persistent = await JsonFilePlatformStore.open(join(dir, 'state.json'), snapshot)
  const reopened = new OperationsService({ ...options, store: await JsonFilePlatformStore.open(persistent.filePath) })
  assert.equal((await reopened.listFeedback(admin)).total, 6)
  assert.equal((await reopened.getFeature('feedback')).status, 'maintenance')
  assert.equal((await reopened.listAudit(admin)).total, audit.total)
} finally { await rm(dir, { recursive: true, force: true }) }

// Persist failure must roll back both mutation and audit atomically.
class FailingStore extends MemoryPlatformStore { async persist () { throw Error('disk unavailable') } }
const failing = new FailingStore(snapshot), failingService = new OperationsService({ ...options, store: failing })
await assert.rejects(failingService.createAnnouncement(admin, { title: 'fail', content: 'fail' }), /disk unavailable/)
assert.deepEqual(await failing.read(state => state), snapshot)

// A long multibyte conversation must add only one new reply to each audit event.
const compactStore = new MemoryPlatformStore(initial)
const compactService = new OperationsService({ ...options, store: compactStore })
let conversation = await compactService.submitFeedback('u1', { category: 'bug', content: '原始问题不应被逐次复制。' }, 'compact-audit-ticket')
for (let index = 0; index < 100; index++) {
  const content = `${index}:` + '界'.repeat(1990)
  const previousVersion = conversation.version
  conversation = await compactService.replyFeedback(support, conversation.id, { version: previousVersion, content })
  const entry = await compactStore.read(state => state.operations.audit.at(-1))
  assert.equal(entry.before.version, previousVersion)
  assert.equal(entry.after.version, previousVersion + 1)
  assert.equal(entry.before.replyCount, index)
  assert.equal(entry.after.replyCount, index + 1)
  assert.equal(entry.before.id, conversation.id)
  assert.equal(entry.after.userId, 'u1')
  assert.deepEqual(entry.after.reply, conversation.replies.at(-1))
  assert.equal(entry.before.reply, undefined)
  assert.equal(entry.before.replies, undefined)
  assert.equal(entry.after.replies, undefined)
  assert.ok(Buffer.byteLength(JSON.stringify(entry), 'utf8') < 7000, 'audit size is independent of earlier replies')
}
conversation = await compactService.updateFeedback(support, conversation.id, { version: conversation.version, status: 'resolved' })
const compact = await compactStore.read(state => state.operations)
assert.equal(compact.audit.at(-1).before.status, 'open')
assert.equal(compact.audit.at(-1).after.status, 'resolved')
assert.equal(compact.audit.at(-1).after.replyCount, 100)
assert.equal(compact.audit.at(-1).after.reply, undefined, 'status edits do not repeat any reply content')
assert.equal(compact.auditBytes, Buffer.byteLength(JSON.stringify(compact.audit), 'utf8'))
assert.ok(compact.auditBytes < 700_000, '100 maximum-size Chinese replies remain below 700 KiB instead of quadratic history copies')
assert.ok(compact.auditBytes > JSON.stringify(compact.audit).length, 'multibyte bytes are not counted as JS characters')
await compactStore.transaction(state => { delete state.operations.auditBytes })
await compactService.updateFeedback(admin, conversation.id, { version: conversation.version, status: 'open' })
const upgradedAudit = await compactStore.read(state => state.operations)
assert.equal(upgradedAudit.auditBytes, Buffer.byteLength(JSON.stringify(upgradedAudit.audit), 'utf8'), 'old audit arrays lazily acquire accurate byte accounting')
assert.deepEqual(upgradedAudit.audit.slice(0, compact.audit.length), compact.audit, 'accounting upgrade never rewrites history')

// Seed the historical byte counter near its ceiling without allocating a 32 MiB test fixture.
const limitBody = { title: '上限', content: '界'.repeat(100) }
const limitRecord = { id: 'byte-limit-record', ...limitBody, startsAt: null, endsAt: null, status: 'draft', version: 1, createdAt: now, updatedAt: now }
const limitEntry = { id: 'byte-limit-record', actorId: admin.id, action: 'announcement.create', targetId: limitRecord.id, before: null, after: limitRecord, createdAt: now }
const exactAddedBytes = Buffer.byteLength(JSON.stringify(limitEntry), 'utf8') + 1
const undercountedChars = JSON.stringify(limitEntry).length + 1
assert.ok(exactAddedBytes > undercountedChars)
const atLimit = structuredClone(snapshot)
atLimit.operations.auditBytes = OPERATIONS_AUDIT_MAX_BYTES - undercountedChars
const limitStore = new MemoryPlatformStore(atLimit)
const limitService = new OperationsService({ store: limitStore, now: () => now, createId: () => 'byte-limit-record' })
await rejects(limitService.createAnnouncement(admin, limitBody), 'OPERATIONS_AUDIT_CAPACITY')
assert.deepEqual(await limitStore.read(state => state), atLimit, 'UTF-8 capacity failure rolls back both announcement and audit')
await limitStore.transaction(state => { state.operations.auditBytes = OPERATIONS_AUDIT_MAX_BYTES - exactAddedBytes })
await limitService.createAnnouncement(admin, limitBody)
assert.equal(await limitStore.read(state => state.operations.auditBytes), OPERATIONS_AUDIT_MAX_BYTES, 'exact byte boundary is accepted')
const fullSnapshot = await limitStore.read(state => state)
const currentFeedback = fullSnapshot.operations.feedback[first.id]
for (const action of [
  () => limitService.replyFeedback(support, first.id, { version: currentFeedback.version, content: '容量不足时不要留下回复。' }),
  () => limitService.updateFeedback(support, first.id, { version: currentFeedback.version, status: 'open' }),
  () => limitService.updateFeature(admin, 'membership', { version: 1, status: 'maintenance', title: '维护', detail: '' }),
]) {
  await rejects(action(), 'OPERATIONS_AUDIT_CAPACITY')
  assert.deepEqual(await limitStore.read(state => state), fullSnapshot, 'audit capacity failure rolls back every business mutation')
}
console.log('Operations authority passed: roles, version races, publication windows, private messages, receipts, feedback idempotency/rate, maintenance, audit and persistence rollback')
