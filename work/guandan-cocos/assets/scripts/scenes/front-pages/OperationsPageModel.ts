import type { FeedbackCategory, MessagePage, OperationsPage, PlayerFeedback, PlayerMessage } from '../../services/OperationsGatewayContracts'

export type OperationsMode = 'messages' | 'feedback'
export type OperationsViewState = {
  mode: OperationsMode, messages: MessagePage, feedback: OperationsPage<PlayerFeedback>,
  selected: PlayerMessage | PlayerFeedback | null, detailPage: number, composing: boolean,
  loading: boolean, reading: boolean, submitting: boolean, error: string, status: string,
  category: FeedbackCategory, content: string,
}
export const OPERATIONS_PAGE_SIZE = 4
export const feedbackCategories: Array<[FeedbackCategory, string]> = [['bug', '问题故障'], ['suggestion', '意见建议'], ['other', '其他反馈']]
export const feedbackCategoryLabel = (category: FeedbackCategory): string => feedbackCategories.find(entry => entry[0] === category)?.[1] ?? '反馈'
export const operationsDate = (time: number): string => {
  const date = new Date(time)
  return `${date.getFullYear()}/${date.getMonth() + 1}/${date.getDate()}`
}
export const feedbackDetail = (item: PlayerFeedback): string => [
  `我的反馈 · ${operationsDate(item.createdAt)}\n${item.content}`,
  ...item.replies.map(reply => `客服回复 · ${operationsDate(reply.createdAt)}\n${reply.content}`),
  item.replies.length ? '' : '暂未收到回复，可稍后返回查看。',
].filter(Boolean).join('\n\n')

/** Explicit text pages keep all long announcements/replies readable, including hard line breaks. */
export function operationsTextPages (text: string, columns = 38, rows = 6): string[] {
  const lines: string[] = []
  for (const paragraph of text.replace(/\r\n?/g, '\n').split('\n')) {
    let line = '', width = 0
    for (const char of Array.from(paragraph)) {
      const next = /[^\x00-\xff]/.test(char) ? 1 : 0.6
      if (width + next > columns) { lines.push(line); line = ''; width = 0 }
      line += char; width += next
    }
    lines.push(line)
  }
  const pages: string[] = []
  for (let index = 0; index < lines.length; index += rows) pages.push(lines.slice(index, index + rows).join('\n'))
  return pages.length ? pages : ['']
}
