import type { OperationsPage, PlayerFeedback, PlayerMessage } from '../OperationsGatewayContracts'
import { malformedResponse, nonNegativeInteger, positiveInteger, requireArray, requireBoolean, requireNonEmptyString, requireRecord } from './validation'

const plain = (value: unknown, limit: number): string => {
  if (typeof value !== 'string' || !value.trim() || value.length > limit) throw malformedResponse('运营内容格式无效')
  return value
}
export const parseMessage = (value: unknown): PlayerMessage => {
  const row = requireRecord(value, '消息')
  if (row.kind !== 'announcement' && row.kind !== 'feedback') throw malformedResponse('消息类型无效')
  return { id: requireNonEmptyString(row.id, '消息编号'), kind: row.kind, title: plain(row.title, 80),
    content: plain(row.content, 5000), createdAt: nonNegativeInteger(row.createdAt, '消息时间'), read: requireBoolean(row.read, '已读状态') }
}
export const parseFeedback = (value: unknown): PlayerFeedback => {
  const row = requireRecord(value, '反馈')
  if (typeof row.category !== 'string' || !['bug', 'suggestion', 'other'].includes(row.category) ||
    typeof row.status !== 'string' || !['open', 'resolved'].includes(row.status)) throw malformedResponse('反馈状态无效')
  return { id: requireNonEmptyString(row.id, '反馈编号'), userId: requireNonEmptyString(row.userId, '反馈用户'),
    category: row.category as PlayerFeedback['category'], status: row.status as PlayerFeedback['status'], content: plain(row.content, 2000),
    version: positiveInteger(row.version, '反馈版本'), createdAt: nonNegativeInteger(row.createdAt, '反馈时间'), updatedAt: nonNegativeInteger(row.updatedAt, '反馈更新时间'),
    replies: requireArray(row.replies, '反馈回复').map(value => {
      const reply = requireRecord(value, '回复')
      return { id: requireNonEmptyString(reply.id, '回复编号'), content: plain(reply.content, 2000), createdAt: nonNegativeInteger(reply.createdAt, '回复时间') }
    }) }
}
export const parseOperationsPage = <T>(value: unknown, parse: (item: unknown) => T): OperationsPage<T> => {
  const data = requireRecord(value, '运营列表')
  const page = positiveInteger(data.page, '列表页码'), pageSize = positiveInteger(data.pageSize, '每页数量')
  const total = nonNegativeInteger(data.total, '总数'), items = requireArray(data.items, '列表').map(parse)
  if (pageSize > 50 || items.length > pageSize || items.length > total) throw malformedResponse('运营分页格式无效')
  return { items, page, pageSize, total }
}
