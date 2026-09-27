/** Only secondary player pages opt into this frame; lobby/table styles stay untouched. */
export const SECONDARY_FRAME = Object.freeze({ width: 1120, height: 520, headerY: 212, footerY: -218 })

export function secondaryPagePlacement (viewport: {
  width: number, height: number, safeLeft?: number, safeRight?: number, safeTop?: number, safeBottom?: number,
  nativeCapsule?: { left: number, right: number, top: number, bottom: number },
}, width: number = SECONDARY_FRAME.width, height: number = SECONDARY_FRAME.height) {
  const left = viewport.safeLeft || 0, right = viewport.safeRight || 0, bottom = viewport.safeBottom || 0
  // The full panel clears native WeChat chrome, including close/back controls.
  const capsule = viewport.nativeCapsule
  const top = Math.max(viewport.safeTop || 0, capsule ? viewport.height / 2 - capsule.bottom + 8 : 0)
  return { x: (left - right) / 2, y: (bottom - top) / 2,
    scale: Math.max(0.1, Math.min(1, (viewport.width - left - right - 40) / width, (viewport.height - top - bottom - 28) / height)) }
}

/** Never expose transport URLs, stack traces or English server internals in player UI. */
export function secondaryErrorText (error: unknown, fallback = '暂时无法加载，请稍后重试。'): string {
  const text = error instanceof Error ? error.message : typeof error === 'string' ? error : ''
  if (!/[\u4e00-\u9fff]/.test(text) || /https?:|127\.0\.0\.1|localhost|\bat\s+\w|[A-Za-z_]{20}/.test(text)) return fallback
  return Array.from(text).slice(0, 90).join('') || fallback
}
