export type TableLayoutRegionRole = 'cards' | 'control' | 'information' | 'decoration'

export type TableLayoutRect = Readonly<{
  left: number
  bottom: number
  width: number
  height: number
}>

export type TableLayoutRegion = Readonly<{
  id: string
  label: string
  role: TableLayoutRegionRole
  rect: TableLayoutRect
  /** Visible pieces inside the safe region; empty space between stacks is not content. */
  parts?: readonly TableLayoutRect[]
  interactive?: boolean
}>

export type TableLayoutOverlapSeverity = 'allowed' | 'notice' | 'warning'

export type TableLayoutOverlap = Readonly<{
  firstId: string
  firstLabel: string
  secondId: string
  secondLabel: string
  severity: TableLayoutOverlapSeverity
  widthPx: number
  heightPx: number
  areaPx2: number
  firstAreaRatio: number
  secondAreaRatio: number
  /** For outlines, width×height is the envelope, not the union area. */
  measurement?: 'outline'
}>

export type TableLayoutOverlapReport = Readonly<{
  viewportPx: Readonly<{ width: number, height: number }>
  regionCount: number
  overlaps: readonly TableLayoutOverlap[]
  warningCount: number
}>

export type TableLayoutOverlapAuditOptions = Readonly<{
  pixelScaleX?: number
  pixelScaleY?: number
  minimumAreaPx2?: number
  informationWarningRatio?: number
  cardsWarningRatio?: number
}>

const positive = (value: number | undefined, fallback: number): number =>
  Number.isFinite(value) && Number(value) > 0 ? Number(value) : fallback

const round = (value: number, digits = 2): number => {
  const factor = 10 ** digits
  return Math.round(value * factor) / factor
}

const normalizedRect = (rect: TableLayoutRect): TableLayoutRect => ({
  left: Number.isFinite(rect.left) ? rect.left : 0,
  bottom: Number.isFinite(rect.bottom) ? rect.bottom : 0,
  width: Math.max(0, Number.isFinite(rect.width) ? rect.width : 0),
  height: Math.max(0, Number.isFinite(rect.height) ? rect.height : 0),
})

const intersectRect = (first: TableLayoutRect, second: TableLayoutRect): TableLayoutRect | null => {
  const left = Math.max(first.left, second.left)
  const bottom = Math.max(first.bottom, second.bottom)
  const width = Math.min(first.left + first.width, second.left + second.width) - left
  const height = Math.min(first.bottom + first.height, second.bottom + second.height) - bottom
  return width > 0 && height > 0 ? { left, bottom, width, height } : null
}

/** Rectangle-union sweep prevents counting the same layered card pixels twice. */
const unionArea = (rects: readonly TableLayoutRect[]): number => {
  const xs = Array.from(new Set(rects.flatMap(rect => [rect.left, rect.left + rect.width]))).sort((a, b) => a - b)
  let area = 0
  for (let i = 1; i < xs.length; i += 1) {
    const left = xs[i - 1], right = xs[i]
    const spans = rects.filter(rect => rect.left < right && rect.left + rect.width > left)
      .map(rect => [rect.bottom, rect.bottom + rect.height]).sort((a, b) => a[0] - b[0])
    let bottom = 0, top = 0, height = 0
    spans.forEach((span, index) => {
      if (!index || span[0] > top) {
        height += top - bottom
        bottom = span[0]
        top = span[1]
      } else top = Math.max(top, span[1])
    })
    height += top - bottom
    area += (right - left) * height
  }
  return area
}

const visibleParts = (region: TableLayoutRegion): TableLayoutRect[] =>
  (region.parts ?? [region.rect]).map(normalizedRect)
    .map(rect => intersectRect(rect, region.rect)).filter((rect): rect is TableLayoutRect => rect !== null)

const overlapSeverity = (
  first: TableLayoutRegion,
  second: TableLayoutRegion,
  firstRatio: number,
  secondRatio: number,
  informationWarningRatio: number,
  cardsWarningRatio: number,
): TableLayoutOverlapSeverity => {
  const largestRatio = Math.max(firstRatio, secondRatio)
  if (first.interactive && second.interactive) return 'warning'
  if (first.role === 'decoration' || second.role === 'decoration') return 'allowed'
  if (first.role === 'cards' && second.role === 'cards') {
    return largestRatio >= cardsWarningRatio ? 'notice' : 'allowed'
  }
  if (first.role === 'information' || second.role === 'information') {
    return largestRatio >= informationWarningRatio ? 'warning' : 'notice'
  }
  return 'notice'
}

/**
 * Measures visual overlap without moving, hiding or resizing either region.
 * Ratios are intentionally reported against both regions because a small
 * badge can be fully covered while occupying only a tiny part of a card lane.
 */
export const auditTableLayoutOverlaps = (
  regions: readonly TableLayoutRegion[],
  viewport: Readonly<{ width: number, height: number }>,
  options: TableLayoutOverlapAuditOptions = {},
): TableLayoutOverlapReport => {
  const scaleX = positive(options.pixelScaleX, 1)
  const scaleY = positive(options.pixelScaleY, 1)
  const minimumArea = Math.max(0, options.minimumAreaPx2 ?? 1)
  const informationWarningRatio = positive(options.informationWarningRatio, 0.18)
  const cardsWarningRatio = positive(options.cardsWarningRatio, 0.45)
  const active = regions
    .filter(region => Boolean(region.id && region.label))
    .map(region => ({ ...region, rect: normalizedRect(region.rect) }))
    .filter(region => region.rect.width > 0 && region.rect.height > 0)
  const overlaps: TableLayoutOverlap[] = []

  for (let firstIndex = 0; firstIndex < active.length; firstIndex += 1) {
    const first = active[firstIndex]
    for (let secondIndex = firstIndex + 1; secondIndex < active.length; secondIndex += 1) {
      const second = active[secondIndex]
      if (!intersectRect(first.rect, second.rect)) continue
      const fragments = visibleParts(first).flatMap(firstPart => visibleParts(second)
        .map(secondPart => intersectRect(firstPart, secondPart)).filter((rect): rect is TableLayoutRect => rect !== null))
      if (!fragments.length) continue
      const widthPx = (Math.max(...fragments.map(rect => rect.left + rect.width)) - Math.min(...fragments.map(rect => rect.left))) * scaleX
      const heightPx = (Math.max(...fragments.map(rect => rect.bottom + rect.height)) - Math.min(...fragments.map(rect => rect.bottom))) * scaleY
      const areaPx2 = unionArea(fragments) * scaleX * scaleY
      if (areaPx2 < minimumArea) continue
      const firstAreaPx2 = first.rect.width * scaleX * first.rect.height * scaleY
      const secondAreaPx2 = second.rect.width * scaleX * second.rect.height * scaleY
      const firstAreaRatio = firstAreaPx2 > 0 ? areaPx2 / firstAreaPx2 : 0
      const secondAreaRatio = secondAreaPx2 > 0 ? areaPx2 / secondAreaPx2 : 0
      overlaps.push({
        firstId: first.id,
        firstLabel: first.label,
        secondId: second.id,
        secondLabel: second.label,
        severity: overlapSeverity(first, second, firstAreaRatio, secondAreaRatio, informationWarningRatio, cardsWarningRatio),
        widthPx: round(widthPx, 1),
        heightPx: round(heightPx, 1),
        areaPx2: round(areaPx2, 1),
        firstAreaRatio: round(firstAreaRatio, 4),
        secondAreaRatio: round(secondAreaRatio, 4),
        ...(first.parts || second.parts ? { measurement: 'outline' as const } : {}),
      })
    }
  }

  overlaps.sort((left, right) => {
    const severityOrder = { warning: 2, notice: 1, allowed: 0 }
    return severityOrder[right.severity] - severityOrder[left.severity] || right.areaPx2 - left.areaPx2
  })
  return {
    viewportPx: { width: round(viewport.width * scaleX, 1), height: round(viewport.height * scaleY, 1) },
    regionCount: active.length,
    overlaps,
    warningCount: overlaps.filter(overlap => overlap.severity === 'warning').length,
  }
}

const percent = (ratio: number): string => `${round(ratio * 100, 1).toFixed(1)}%`

export const formatTableLayoutOverlap = (overlap: TableLayoutOverlap): string =>
  `[${overlap.severity}] ${overlap.firstLabel} × ${overlap.secondLabel}: ` +
  (overlap.measurement === 'outline'
    ? `交叠外框 ${overlap.widthPx}×${overlap.heightPx}px，实际交叠 ${overlap.areaPx2}px²；`
    : `${overlap.widthPx}×${overlap.heightPx}px = ${overlap.areaPx2}px²；`) +
  `占${overlap.firstLabel} ${percent(overlap.firstAreaRatio)}，占${overlap.secondLabel} ${percent(overlap.secondAreaRatio)}`

export const formatTableLayoutOverlapReport = (report: TableLayoutOverlapReport): string[] => [
  `牌桌布局 ${report.viewportPx.width}×${report.viewportPx.height}px：${report.regionCount} 个区域，${report.warningCount} 条告警`,
  ...report.overlaps.map(formatTableLayoutOverlap),
]
