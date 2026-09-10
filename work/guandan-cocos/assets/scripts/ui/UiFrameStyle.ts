/** Shared frame geometry only: callers still own colors, layout and interaction. */
export const UI_FRAME_CORNERS = Object.freeze({
  panel: 8,
  control: 6,
  tag: 3,
  progress: 2,
  square: 0,
})

export type UiFrameKind = keyof typeof UI_FRAME_CORNERS

/** Compatible with Cocos Graphics and the layout simulator's Canvas context. */
export interface UiFramePath {
  rect: (x: number, y: number, width: number, height: number) => unknown
  roundRect: (x: number, y: number, width: number, height: number, radius: number) => unknown
}

export const uiFrameRadius = (
  width: number, height: number, kind: UiFrameKind = 'panel', scale = 1,
): number => {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return 0
  const safeScale = Number.isFinite(scale) && scale > 0 ? scale : 1
  // Tiny tags/progress fills must stay rectangular, never become half-height pills.
  return Math.min(UI_FRAME_CORNERS[kind] * safeScale, Math.min(width, height) * 0.2)
}

/** Adds one path; deliberately does not clear, fill, stroke, or alter hit bounds. */
export const drawUiFrame = (
  graphics: UiFramePath, x: number, y: number, width: number, height: number,
  kind: UiFrameKind = 'panel', scale = 1,
): void => {
  if (![x, y, width, height].every(Number.isFinite) || width <= 0 || height <= 0) return
  const radius = uiFrameRadius(width, height, kind, scale)
  if (radius === 0) graphics.rect(x, y, width, height)
  else graphics.roundRect(x, y, width, height, radius)
}
