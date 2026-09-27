import { EditBox, Label } from 'cc'
import type { FeedbackCategory } from '../../services/OperationsGatewayContracts'
import type { RuntimeUiFactory } from '../../ui/RuntimeUiFactory'
import type { TableViewport } from '../../ui/ScreenAdapter'
import { secondaryErrorText } from '../../ui/SecondaryPagePolicy'
import { feedbackCategories, feedbackCategoryLabel, feedbackDetail, operationsDate, operationsTextLines, type OperationsViewState } from './OperationsPageModel'
import { OperationsPageUi, operationsPalette as colors } from './OperationsPageUi'

export type OperationsPageActions = {
  back: () => void, retry: () => void, page: (delta: number) => void, select: (id: string) => void,
  compose: () => void, mine: () => void,
  category: (category: FeedbackCategory) => void, content: (text: string) => void,
  validate: () => string, submit: () => void,
  scrollDetail: (offset: number) => void,
}

export function renderOperationsPage (parent: RuntimeUiFactory, viewport: TableViewport, view: OperationsViewState, actions: OperationsPageActions): (() => void) | null {
  const ui = new OperationsPageUi(parent, viewport, view.mode === 'messages' ? '消息中心' : '意见反馈', actions.back)
  if (view.mode === 'feedback') {
    ui.button('FeedbackMine', '我的反馈', 282, 212, 168, actions.mine, !view.composing, view.loading)
    ui.button('FeedbackCompose', '写反馈', 464, 212, 168, actions.compose, view.composing, view.loading)
  } else ui.text('MessageUnread', `${view.messages.unreadCount} 条未读`, 362, 212, 310, 42, 22, colors.muted, false)
  if (view.composing) return renderForm(ui, view, actions)
  if (view.selected) renderDetail(ui, view, actions)
  else renderList(ui, view, actions)
  return null
}

function renderForm (ui: OperationsPageUi, view: OperationsViewState, actions: OperationsPageActions): () => void {
  ui.text('FeedbackCategoryLabel', '反馈类型', -438, 126, 160, 42, 23, colors.muted)
  feedbackCategories.forEach(([category, label], index) => ui.button('FeedbackCategory-' + category,
    label + (category === view.category ? ' · 已选' : ''), -210 + index * 294, 126, 268,
    () => actions.category(category), category === view.category, view.submitting, 56))
  ui.text('FeedbackContentLabel', '反馈内容（必填）', -282, 61, 472, 36, 23, colors.muted)
  const count = ui.text('FeedbackCharacterCount', `${view.content.length}/2000`, 434, 61, 170, 36, 21, colors.muted, false)
  const edit = ui.input('FeedbackContent', '请描述问题或建议，勿填写密码等敏感信息', 0, -33, {
    width: 1036, height: 136, maxLength: 2000, fontSize: 25, inputMode: EditBox.InputMode.ANY, initialValue: view.content,
  })
  edit.enabled = !view.submitting
  if (edit.textLabel) { edit.textLabel.verticalAlign = Label.VerticalAlign.TOP; edit.textLabel.overflow = Label.Overflow.CLAMP }
  if (edit.placeholderLabel) edit.placeholderLabel.verticalAlign = Label.VerticalAlign.TOP
  const helper = ui.text('FeedbackFieldHint', view.error ? secondaryErrorText(view.error) : '仅你与授权运营人员可查看；回复会显示在消息和“我的反馈”中。',
    0, -139, 1036, 56, 21, view.error ? colors.gold : colors.muted)
  edit.node.on('text-changed', () => { actions.content(edit.string); count.string = `${edit.string.length}/2000` })
  edit.node.on('editing-did-ended', () => {
    const error = actions.validate()
    if (error) { helper.string = secondaryErrorText(error); helper.color = colors.gold }
  })
  ui.text('FeedbackSubmitStatus', view.submitting ? '正在提交，请稍候…' : '提交失败会保留内容，可直接重试。', -150, -218, 716, 44, 21, colors.muted)
  ui.button('FeedbackSubmit', view.submitting ? '提交中…' : '提交反馈', 424, -218, 200, actions.submit, true, view.submitting)
  return () => { if (edit.isValid) edit.blur() }
}

function renderList (ui: OperationsPageUi, view: OperationsViewState, actions: OperationsPageActions): void {
  const page = view.mode === 'messages' ? view.messages : view.feedback
  page.items.forEach((item, index) => {
    const feedback = 'replies' in item
    const title = (feedback ? item.content : item.title).replace(/\s+/g, ' ').trim()
    const state = feedback ? item.status === 'resolved' ? '已处理' : '待处理' : item.read ? '已读' : '未读'
    const meta = feedback ? `${feedbackCategoryLabel(item.category)}  ·  ${operationsDate(item.createdAt)}  ·  ${item.replies.length} 条回复` : operationsDate(item.createdAt)
    const y = 122 - index * 84
    ui.button('OperationsItem-' + item.id, '', 0, y, 1052, () => actions.select(item.id), false, view.loading, 76)
    ui.text('OperationsItemTitle', Array.from(title).slice(0, 32).join('') + (Array.from(title).length > 32 ? '…' : ''), -81, y + 17, 826, 36, 25, colors.text, true, true)
    ui.text('OperationsItemState', meta, -81, y - 20, 826, 30, 20, colors.muted)
    ui.text('OperationsReadState', `${state}  ›`, 430, y, 152, 44, 22, state === '未读' ? colors.gold : colors.muted, false)
  })
  if (!page.items.length) ui.empty(view.loading ? '正在加载' : view.error ? '暂时无法加载' : view.mode === 'messages' ? '暂时没有新消息' : '还没有反馈记录',
    view.error ? secondaryErrorText(view.error) : view.loading ? '请稍候…' : view.mode === 'messages' ? '游戏公告和反馈回复会在这里通知你。' : '点击右上角“写反馈”，告诉我们你的问题或建议。',
    view.error ? actions.retry : undefined)
  ui.text('OperationsListStatus', view.error ? secondaryErrorText(view.error) : view.loading ? '正在更新…' : `共 ${page.total} 条`, -309, -218, 418, 48, 20, view.error ? colors.gold : colors.muted)
  const count = Math.ceil(page.total / page.pageSize)
  if (page.items.length || !view.error) ui.button('OperationsRefresh', view.error ? '重试' : '刷新', count > 1 ? 68 : 459, -218, 130, actions.retry, false, view.loading)
  if (count > 1) {
    ui.button('OperationsPrevious', '上一页', 239, -218, 142, () => actions.page(-1), false, view.loading || page.page <= 1)
    ui.text('OperationsPageNumber', `${page.page}/${count}`, 349, -218, 66, 44, 20, colors.muted, false)
    ui.button('OperationsNext', '下一页', 459, -218, 142, () => actions.page(1), false, view.loading || page.page >= count)
  }
}

function renderDetail (ui: OperationsPageUi, view: OperationsViewState, actions: OperationsPageActions): void {
  const item = view.selected!
  const feedback = 'replies' in item
  const title = feedback ? feedbackCategoryLabel(item.category) + ' · ' + (item.status === 'resolved' ? '已处理' : '待处理') : item.title
  ui.text('OperationsDetailTitle', title, 0, 124, 1036, 66, 29, colors.gold, true, true)
  const lines = operationsTextLines(feedback ? feedbackDetail(item) : item.content)
  const height = lines.length * 36 + 24
  const body = ui.scroll('OperationsDetailScroll', 0, 77, -172, 1036, height, { offsetY: view.detailOffset, changed: actions.scrollDetail })
  const label = body.text('OperationsDetailContent', lines.join('\n'), 0, -height / 2, 1016, height, 26)
  label.lineHeight = 36; label.verticalAlign = Label.VerticalAlign.TOP; label.overflow = Label.Overflow.CLAMP
  ui.text('OperationsDetailStatus', view.error ? secondaryErrorText(view.error, '已读状态未保存，请重试。') : view.status || (view.reading ? '正在保存已读状态…' : `${operationsDate(item.createdAt)}${height > 249 ? '  ·  上下滑动查看完整内容' : ''}`),
    -105, -218, 820, 50, 21, view.error ? colors.gold : colors.muted)
  if (!feedback && !item.read) ui.button('MessageReadRetry', view.reading ? '保存中…' : '重试', 434, -218, 180, actions.retry, false, view.reading)
}
