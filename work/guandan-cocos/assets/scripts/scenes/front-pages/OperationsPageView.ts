import { EditBox, Label } from 'cc'
import type { FeedbackCategory } from '../../services/OperationsGatewayContracts'
import type { RuntimeUiFactory } from '../../ui/RuntimeUiFactory'
import type { TableViewport } from '../../ui/ScreenAdapter'
import { feedbackCategories, feedbackCategoryLabel, feedbackDetail, operationsDate, operationsTextPages, type OperationsViewState } from './OperationsPageModel'
import { OperationsPageUi, operationsPalette as colors } from './OperationsPageUi'

export type OperationsPageActions = {
  back: () => void, retry: () => void, page: (delta: number) => void, select: (id: string) => void,
  detailPage: (delta: number) => void, compose: () => void, mine: () => void,
  category: (category: FeedbackCategory) => void, content: (text: string) => void,
  validate: () => string, submit: () => void,
}

export function renderOperationsPage (parent: RuntimeUiFactory, viewport: TableViewport, view: OperationsViewState, actions: OperationsPageActions): (() => void) | null {
  const ui = new OperationsPageUi(parent, viewport)
  ui.button('OperationsBack', view.selected || view.composing ? '返回列表' : '返回大厅', -476, 244, 200, actions.back)
  ui.text('OperationsTitle', view.mode === 'messages' ? '消息中心' : '意见反馈', -227, 244, 260, 72, 36)
  if (view.mode === 'feedback') {
    ui.button('FeedbackMine', '我的反馈', 258, 244, 204, actions.mine, !view.composing, view.loading)
    ui.button('FeedbackCompose', '写反馈', 482, 244, 204, actions.compose, view.composing, view.loading)
  } else ui.text('MessageUnread', `未读 ${view.messages.unreadCount} 条`, 385, 244, 350, 64, 26, colors.gold)
  if (view.composing) return renderForm(ui, view, actions)
  if (view.selected) renderDetail(ui, view, actions)
  else renderList(ui, view, actions)
  return null
}

function renderForm (ui: OperationsPageUi, view: OperationsViewState, actions: OperationsPageActions): () => void {
  ui.text('FeedbackCategoryLabel', '反馈类型（必选）', -429, 144, 270, 52, 26)
  feedbackCategories.forEach(([category, label], index) => ui.button('FeedbackCategory-' + category,
    (category === view.category ? '已选 · ' : '') + label, -149 + index * 282, 134, 268,
    () => actions.category(category), category === view.category, view.submitting))
  ui.text('FeedbackContentLabel', '反馈内容（必填，最多 2000 字）', -239, 63, 630, 46, 26)
  const edit = ui.ui.formInput('FeedbackContent', '请描述遇到的问题或建议，请勿填写密码等敏感信息', 0, -41, {
    width: 1080, height: 152, maxLength: 2000, fontSize: 26, inputMode: EditBox.InputMode.ANY, initialValue: view.content,
  })
  edit.enabled = !view.submitting
  if (edit.textLabel) {
    edit.textLabel.horizontalAlign = Label.HorizontalAlign.LEFT; edit.textLabel.verticalAlign = Label.VerticalAlign.TOP
    edit.textLabel.overflow = Label.Overflow.CLAMP
  }
  if (edit.placeholderLabel) { edit.placeholderLabel.horizontalAlign = Label.HorizontalAlign.LEFT; edit.placeholderLabel.verticalAlign = Label.VerticalAlign.TOP }
  const helper = ui.text('FeedbackFieldHint', view.error || '反馈仅你与授权运营人员可查看；回复见消息和“我的反馈”。', -67, -153, 912, 56, 24, view.error ? colors.gold : colors.muted)
  const count = ui.text('FeedbackCharacterCount', `${view.content.length}/2000`, 473, -153, 144, 46, 23, colors.muted)
  edit.node.on('text-changed', () => { actions.content(edit.string); count.string = `${edit.string.length}/2000` })
  edit.node.on('editing-did-ended', () => {
    const error = actions.validate()
    if (error) { helper.string = error; helper.color = colors.gold }
  })
  ui.text('FeedbackSubmitStatus', view.submitting ? '正在提交，请稍候…' : '内容会保留；网络失败可重试，不会重复提交。', -147, -248, 826, 66, 24, colors.muted)
  ui.button('FeedbackSubmit', view.submitting ? '提交中…' : '提交反馈', 447, -248, 264, actions.submit, true, view.submitting)
  return () => { if (edit.isValid) edit.blur() }
}

function renderList (ui: OperationsPageUi, view: OperationsViewState, actions: OperationsPageActions): void {
  const page = view.mode === 'messages' ? view.messages : view.feedback
  page.items.forEach((item, index) => {
    const feedback = 'replies' in item
    const title = feedback ? feedbackCategoryLabel(item.category) + ' · ' + item.content : item.title
    const state = feedback ? (item.status === 'resolved' ? '已处理' : '待处理') + ` · 回复 ${item.replies.length}` : item.read ? '已读' : '未读'
    const y = 140 - index * 92
    ui.button('OperationsItem-' + item.id, '查看', 465, y, 176, () => actions.select(item.id), false, view.loading)
    ui.text('OperationsItemTitle', Array.from(title).slice(0, 32).join('') + (Array.from(title).length > 32 ? '…' : ''), -109, y + 20, 914, 44, 27)
    ui.text('OperationsItemState', `${operationsDate(item.createdAt)} · ${state}`, -217, y - 27, 696, 36, 23, colors.muted)
  })
  if (!page.items.length) ui.text('OperationsEmpty', view.loading ? '正在加载…' : view.error ? '暂时无法加载，请点击重试。' : view.mode === 'messages' ? '暂无消息，有新公告或反馈回复时会在这里显示。' : '还没有反馈，点击“写反馈”告诉我们。', 0, 30, 990, 160, 30, colors.muted)
  ui.text('OperationsListStatus', view.error || (view.loading ? '正在加载…' : `共 ${page.total} 条 · 第 ${page.page} / ${Math.max(1, Math.ceil(page.total / page.pageSize))} 页`), -289, -248, 560, 68, 23, view.error ? colors.gold : colors.muted)
  ui.button('OperationsRefresh', view.error ? '重试' : '刷新', 68, -248, 156, actions.retry, false, view.loading)
  ui.button('OperationsPrevious', '上一页', 253, -248, 184, () => actions.page(-1), false, view.loading || page.page <= 1)
  ui.button('OperationsNext', '下一页', 467, -248, 184, () => actions.page(1), false, view.loading || page.page * page.pageSize >= page.total)
}

function renderDetail (ui: OperationsPageUi, view: OperationsViewState, actions: OperationsPageActions): void {
  const item = view.selected!
  const feedback = 'replies' in item
  const title = feedback ? feedbackCategoryLabel(item.category) + ' · ' + (item.status === 'resolved' ? '已处理' : '待处理') : item.title
  const pages = operationsTextPages(feedback ? feedbackDetail(item) : item.content)
  ui.text('OperationsDetailTitle', title, 0, 137, 1080, 82, 29, colors.gold)
  const body = ui.text('OperationsDetailContent', pages[view.detailPage] ?? pages[0], 0, -22, 1040, 240, 26)
  body.horizontalAlign = Label.HorizontalAlign.LEFT; body.verticalAlign = Label.VerticalAlign.TOP
  ui.text('OperationsDetailStatus', view.error || view.status || (view.reading ? '正在保存已读状态…' : `内容 ${view.detailPage + 1} / ${pages.length} 页`), -175, -166, 770, 60, 23, view.error ? colors.gold : colors.muted)
  if (!feedback && !item.read) ui.button('MessageReadRetry', view.reading ? '保存中…' : '保存已读', 452, -248, 244, actions.retry, false, view.reading)
  ui.button('DetailPrevious', '上页内容', -438, -248, 244, () => actions.detailPage(-1), false, view.detailPage <= 0)
  ui.button('DetailNext', '下页内容', -160, -248, 244, () => actions.detailPage(1), false, view.detailPage >= pages.length - 1)
}
