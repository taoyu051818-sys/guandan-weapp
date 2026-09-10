import { BlockInputEvents, Color, Label, Node, Tween, UITransform } from 'cc'
import { RuntimeUiFactory } from '../../ui/RuntimeUiFactory'
import type { ScreenAdapter } from '../../ui/ScreenAdapter'
import { createFriendFormScroll, friendFormAction } from './FriendRoomFormUi'
import { FRIEND_RULE_TOPICS, friendRuleSections, type FriendRuleTopic } from './FriendRoomRuleContent'

/** Rules stay in the room workflow, not on the lobby; closing preserves the form draft. */
export const showFriendRoomRulesModal = (parent: Node, screen: ScreenAdapter, initial: FriendRuleTopic = 'rounds'): void => {
  if (parent.getChildByName('FriendRoomRulesModal')) return
  const root = new Node('FriendRoomRulesModal')
  root.parent = parent
  root.addComponent(UITransform).setContentSize(screen.viewport.width, screen.viewport.height)
  root.addComponent(BlockInputEvents)
  const ui = new RuntimeUiFactory(root)
  ui.panel('RulesShade', 0, 0, screen.viewport.width, screen.viewport.height, { fill: new Color(2, 12, 14, 195), frame: 'square', lineWidth: 0 })
  const width = Math.min(1080, screen.safeSize().x - 32)
  const height = Math.min(590, screen.safeSize().y - 36)
  const panel = ui.panel('RulesPanel', 0, 0, width, height, { fill: new Color(24, 53, 43), stroke: new Color(163, 169, 126), frame: 'panel' })
  const face = new RuntimeUiFactory(panel)
  face.outlinedLabel('玩法规则', -width / 2 + 130, height / 2 - 36, 28, { width: 218, height: 40, color: new Color(255, 231, 162), outlineWidth: 0 })
  face.outlinedLabel('上下滑动查看完整规则', 60, -height / 2 + 13, 18, { width: width - 240, height: 24, color: new Color(193, 209, 192), outlineWidth: 0 })
  let closed = false
  let body: Node | null = null
  const stop = (node: Node): void => { Tween.stopAllByTarget(node); node.children.forEach(stop) }
  const dispose = (node: Node): void => { stop(node); node.active = false; node.removeFromParent(); node.destroy() }
  const close = (): void => { if (!closed && root.isValid) { closed = true; dispose(root) } }
  friendFormAction(face, '关闭', width / 2 - 66, height / 2 - 36, 96, 48, 22, new Color(52, 91, 74), close)
  const buttons = new Map<FriendRuleTopic, Node>()
  const render = (topic: FriendRuleTopic): void => {
    if (closed || !root.isValid) return
    if (body?.isValid) dispose(body)
    const left = -width / 2 + 182
    const contentWidth = width - 214
    const sections = friendRuleSections(topic)
    const font = 22
    const lineHeight = 34
    const charsPerLine = Math.max(12, Math.floor((contentWidth - 24) / font))
    const paragraphHeight = (text: string): number => Math.ceil(Array.from(text).length / charsPerLine) * lineHeight + 12
    const contentHeight = sections.reduce((sum, section) => sum + 62 + (section.paragraphs ?? []).reduce((n, text) => n + paragraphHeight(text), 0) + (section.columns ? ((section.rows?.length ?? 0) + 1) * 44 : 0), 40)
    body = new Node('RulesBody')
    body.parent = panel
    const scroll = createFriendFormScroll(body, left + contentWidth / 2, height / 2 - 76, -height / 2 + 28, contentWidth, contentHeight)
    const textUi = new RuntimeUiFactory(scroll.content!)
    let y = -16
    sections.forEach(section => {
      const title = textUi.outlinedLabel(section.title, 0, y - 17, 24, { width: contentWidth - 24, height: 38, color: new Color(255, 223, 148), outlineWidth: 0 })
      title.horizontalAlign = Label.HorizontalAlign.LEFT
      y -= 50
      section.paragraphs?.forEach(text => {
        const h = paragraphHeight(text) - 12
        const label = textUi.outlinedLabel(text, 0, y - h / 2, font, { width: contentWidth - 24, height: h, color: new Color(232, 240, 229), outlineWidth: 0 })
        label.horizontalAlign = Label.HorizontalAlign.LEFT
        label.enableWrapText = true
        label.lineHeight = lineHeight
        label.verticalAlign = Label.VerticalAlign.TOP
        y -= h + 12
      })
      if (section.columns) [section.columns, ...(section.rows ?? [])].forEach((row, index) => {
        textUi.panel('RulesScoreRow', 0, y - 22, contentWidth - 24, 42, { fill: index === 0 ? new Color(51, 90, 71) : new Color(34, 68, 54), frame: 'square', lineWidth: 0 })
        const cellWidth = (contentWidth - 24) / row.length
        row.forEach((value, col) => textUi.outlinedLabel(value, -(contentWidth - 24) / 2 + cellWidth * (col + 0.5), y - 22, 22, { width: cellWidth - 8, height: 36, color: new Color(240, 241, 222), outlineWidth: 0 }))
        y -= 44
      })
      y -= 12
    })
    buttons.forEach((node, id) => { node.getComponentInChildren(Label)!.string = `${id === topic ? '当前 · ' : ''}${FRIEND_RULE_TOPICS.find(item => item.id === id)!.label}` })
    scroll.scrollToTop(0)
  }
  FRIEND_RULE_TOPICS.forEach((topic, index) => {
    const node = friendFormAction(face, topic.label, -width / 2 + 89, height / 2 - 112 - index * 62, 146, 50, 22, new Color(42, 83, 63), () => render(topic.id))
    buttons.set(topic.id, node)
  })
  render(initial)
}
