import type { FeedbackDraft, MessagePage, OperationsGateway, OperationsPage, PlayerFeedback } from '../OperationsGatewayContracts'
import type { PlatformApiClient } from './client'
import { parseFeedback, parseMessage, parseOperationsPage } from './operationsValidation'
import { malformedResponse, nonNegativeInteger, requireRecord } from './validation'

const pageQuery = (page: number, pageSize: number): string => {
  if (!Number.isSafeInteger(page) || page < 1 || !Number.isSafeInteger(pageSize) || pageSize < 1 || pageSize > 50) throw new Error('分页参数无效')
  return `?page=${page}&pageSize=${pageSize}`
}
/** Shares the existing player client, including authentication refresh and sign-out guards. */
export class HttpOperationsGateway implements OperationsGateway {
  public constructor (private readonly client: PlatformApiClient) {}

  public async listMessages (page: number, pageSize: number): Promise<MessagePage> {
    const data = requireRecord(await this.client.request<unknown>('/api/v1/messages' + pageQuery(page, pageSize)), '消息列表')
    const parsed = parseOperationsPage(data, parseMessage)
    const unreadCount = nonNegativeInteger(data.unreadCount, '未读消息数')
    if (unreadCount > parsed.total) throw malformedResponse('未读消息数无效')
    return { ...parsed, unreadCount }
  }

  public async readMessage (id: string): Promise<void> {
    const data = requireRecord(await this.client.request<unknown>(`/api/v1/messages/${encodeURIComponent(id)}/read`, 'POST', {}), '消息已读')
    if (data.read !== true) throw malformedResponse('消息已读状态无效')
  }

  public async listFeedback (page: number, pageSize: number): Promise<OperationsPage<PlayerFeedback>> {
    return parseOperationsPage(await this.client.request<unknown>('/api/v1/feedback' + pageQuery(page, pageSize)), parseFeedback)
  }

  public async submitFeedback (draft: FeedbackDraft, key: string): Promise<PlayerFeedback> {
    const content = draft.content.trim()
    if (!['bug', 'suggestion', 'other'].includes(draft.category) || !content || content.length > 2000) throw new Error('请选择反馈类型，并填写 1–2000 字反馈内容')
    if (!/^[\w-]{8,128}$/.test(key)) throw new Error('反馈提交标识无效')
    const data = requireRecord(await this.client.request<unknown>('/api/v1/feedback', 'POST', { category: draft.category, content }, { 'Idempotency-Key': key }), '提交反馈')
    return parseFeedback(data.feedback)
  }
}
