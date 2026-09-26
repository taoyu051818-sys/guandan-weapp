/** Player-only operations; no admin identity, credentials or transport in page code. */
export type ServiceId = 'messages' | 'feedback' | 'membership'
export type ServiceNotice = {
  id: ServiceId, status: 'open' | 'closed' | 'maintenance', title: string, detail: string,
  version: number, updatedAt: number,
}
export interface LobbyServiceGateway { getNotice(id: ServiceId): Promise<ServiceNotice> }
export type OperationsPage<T> = { items: T[], page: number, pageSize: number, total: number }
export type PlayerMessage = { id: string, kind: 'announcement' | 'feedback', title: string, content: string, createdAt: number, read: boolean }
export type MessagePage = OperationsPage<PlayerMessage> & { unreadCount: number }
export type FeedbackCategory = 'bug' | 'suggestion' | 'other'
export type FeedbackDraft = { category: FeedbackCategory, content: string }
export type PlayerFeedback = FeedbackDraft & {
  id: string, userId: string, status: 'open' | 'resolved', version: number, createdAt: number, updatedAt: number,
  replies: Array<{ id: string, content: string, createdAt: number }>,
}
export interface OperationsGateway {
  listMessages(page: number, pageSize: number): Promise<MessagePage>
  readMessage(id: string): Promise<void>
  listFeedback(page: number, pageSize: number): Promise<OperationsPage<PlayerFeedback>>
  submitFeedback(draft: FeedbackDraft, idempotencyKey: string): Promise<PlayerFeedback>
}
