/** Native WeChat coordinates are CSS pixels, not device pixels or Cocos units. */
export type NativeScreenRect = Readonly<{ left: number, top: number, width: number, height: number }>
export type SceneExclusionRect = Readonly<{ left: number, right: number, top: number, bottom: number }>
export type WechatWindowApi = {
  getWindowInfo?: () => { windowWidth: number, windowHeight: number }
  getSystemInfoSync?: () => { windowWidth: number, windowHeight: number }
  getMenuButtonBoundingClientRect?: () => NativeScreenRect
}

export function readWechatCapsule (width: number, height: number, api?: WechatWindowApi): SceneExclusionRect | undefined {
  if (!api) return undefined
  try {
    const window = api.getWindowInfo?.() ?? api.getSystemInfoSync?.()
    const rect = api.getMenuButtonBoundingClientRect?.()
    if (window && rect && [window.windowWidth, window.windowHeight, rect.width, rect.height].every(value => Number.isFinite(value) && value > 0)
      && Number.isFinite(rect.left) && Number.isFinite(rect.top)) {
      const sx = width / window.windowWidth
      const sy = height / window.windowHeight
      return { left: rect.left * sx - width / 2, right: (rect.left + rect.width) * sx - width / 2,
        top: height / 2 - rect.top * sy, bottom: height / 2 - (rect.top + rect.height) * sy }
    }
  } catch { /* Older base libraries: reserve a conservative capsule footprint. */ }
  return { left: width / 2 - 180, right: width / 2, top: height / 2, bottom: height / 2 - 100 }
}

/** Avoid system chrome only. Ordinary card/table overlaps remain advisory. */
export function avoidNativeCapsule (point: Readonly<{ x: number, y: number }>, width: number, height: number,
  capsule: SceneExclusionRect | undefined, leftBound: number): { x: number, y: number } {
  if (!capsule || point.x + width / 2 <= capsule.left - 12 || point.x - width / 2 >= capsule.right + 12
    || point.y + height / 2 <= capsule.bottom - 12 || point.y - height / 2 >= capsule.top + 12) return { ...point }
  const x = capsule.left - 12 - width / 2
  return x - width / 2 >= leftBound + 8 ? { x, y: point.y } : { x: point.x, y: capsule.bottom - 12 - height / 2 }
}
