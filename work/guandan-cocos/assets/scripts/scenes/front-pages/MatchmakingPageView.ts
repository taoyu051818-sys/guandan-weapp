import { Color, Graphics, type Label, Node, UITransform, Vec3, tween } from 'cc'
import type { RuntimeUiFactory } from '../../ui/RuntimeUiFactory'
import type { MatchWaitingStage } from '../../services/MatchWaitingPresentation'

/** A small waiting overlay on the real table backdrop, never a separate lobby card. */
export const renderMatchmakingPage = (
  ui: RuntimeUiFactory, stage: MatchWaitingStage, error: string | null,
  cancel: () => void, retry: () => void, defer: () => void,
  animate = true,
): Label => {
  const needsAction = stage === 'failed' || stage === 'cancel-uncertain'
  const title = stage === 'failed' ? '暂时无法匹配' : stage === 'cancel-uncertain' ? '取消未完成' : stage === 'cancelling' ? '正在取消…' : '匹配中'
  ui.outlinedLabel(title, 0, needsAction ? 90 : -46, 28, { width: 680, height: 48 })
  const status = ui.outlinedLabel(error ?? '', 0, needsAction ? -12 : -88, 23, { width: 740, height: needsAction ? 116 : 38 })
  const button = (text: string, x: number, action: () => void): void => {
    const node = ui.button('MatchingAction', text, x, 220, 58, 24)
    node.setPosition(new Vec3(x, -154, 0))
    node.on(Node.EventType.TOUCH_END, action)
  }
  if (!needsAction) createMatchingShuffle(ui, animate && stage !== 'cancelling')
  if (stage === 'failed') {
    button('返回', -130, cancel)
    button('重新匹配', 130, retry)
  } else if (stage === 'cancel-uncertain') {
    button('稍后确认', -130, defer)
    button('重新确认', 130, cancel)
  } else if (stage !== 'cancelling' && stage !== 'entering') button('取消匹配', 0, cancel)
  return status
}

/** Restored from the first matching animation (8880316), centered on the table. */
const createMatchingShuffle = (ui: RuntimeUiFactory, animate: boolean): void => {
  const reduced = typeof globalThis.matchMedia === 'function' && globalThis.matchMedia('(prefers-reduced-motion: reduce)').matches
  ;[-1, 0, 1].forEach((slot, index) => {
    const node = new Node(`MatchingCard-${index}`)
    node.parent = ui.parent
    node.setPosition(new Vec3(slot * 42, 38 + Math.abs(slot) * 4, index))
    node.addComponent(UITransform).setContentSize(58, 82)
    const graphics = node.addComponent(Graphics)
    graphics.fillColor = new Color(17, 82, 61, 255)
    graphics.strokeColor = new Color(239, 201, 90, 255)
    graphics.lineWidth = 3
    graphics.roundRect(-29, -41, 58, 82, 8)
    graphics.fill()
    graphics.stroke()
    graphics.strokeColor = new Color(108, 225, 204, 190)
    graphics.lineWidth = 2
    graphics.roundRect(-19, -31, 38, 62, 6)
    graphics.stroke()
    if (animate && !reduced) tween(node).delay(index * 0.12).repeatForever(
      tween().to(0.46, { position: new Vec3(-slot * 48, 51 + index * 3, index), angle: slot * 7 }, { easing: 'sineInOut' })
        .to(0.46, { position: new Vec3(slot * 42, 38 + Math.abs(slot) * 4, index), angle: -slot * 5 }, { easing: 'sineInOut' }),
    ).start()
  })
}
