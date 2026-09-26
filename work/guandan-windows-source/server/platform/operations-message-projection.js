import { newest } from './operations-policy.js'

/** Plain-text player projection; never includes drafts, other users or administrator identity. */
export function playerMessages (ops, userId, now) {
  const items = Object.values(ops.announcements).filter(item => item.status === 'published' &&
    (item.startsAt === null || item.startsAt <= now) && (item.endsAt === null || item.endsAt > now)).map(item => ({
    id: `announcement:${item.id}:${item.version}`, kind: 'announcement', title: item.title,
    content: item.content, createdAt: item.updatedAt,
  }))
  for (const feedback of Object.values(ops.feedback)) {
    if (feedback.userId !== userId) continue
    for (const reply of feedback.replies) items.push({ id: `feedback:${reply.id}`, kind: 'feedback',
      title: '你的反馈有新回复', content: `你的反馈：${feedback.content}\n\n回复：${reply.content}`, createdAt: reply.createdAt })
  }
  const receipts = ops.readReceipts[userId] || {}
  return newest(items).map(item => ({ ...item, read: Object.hasOwn(receipts, item.id) }))
}
