import { type Node, Vec3 } from 'cc'
import { configureTransform, configureLabelMetrics, drawTableHudButton, type ButtonView } from './TableGameHudFoundation'
import { TABLE_BUTTON_HEIGHT, TABLE_BUTTON_FONT, TABLE_BUTTON_GAP, tableButtonWidth } from './TableButtonMetrics'

/** Text-driven widths, one shared height and a stable baseline for the bottom toolbar. */
export const layoutTableToolbar = (toolbar: Node | null, candidates: readonly (ButtonView | null)[]): void => {
  const buttons = candidates.filter((view): view is ButtonView => Boolean(view))
  const widths = buttons.map(view => tableButtonWidth(view.label.string))
  const width = widths.reduce((sum, value) => sum + value, 0) + TABLE_BUTTON_GAP * Math.max(0, widths.length - 1)
  if (toolbar) configureTransform(toolbar, width, TABLE_BUTTON_HEIGHT)
  let cursor = -width / 2
  buttons.forEach((view, index) => {
    configureTransform(view.node, widths[index], TABLE_BUTTON_HEIGHT)
    view.node.setPosition(new Vec3(cursor + widths[index] / 2, 0, 1))
    configureLabelMetrics(view.label, widths[index] - 12, TABLE_BUTTON_HEIGHT - 6, TABLE_BUTTON_FONT, 0, 0)
    drawTableHudButton(view, false, false)
    cursor += widths[index] + TABLE_BUTTON_GAP
  })
}
