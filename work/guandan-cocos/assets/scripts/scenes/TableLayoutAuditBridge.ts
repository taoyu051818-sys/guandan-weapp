import { Node, sys, UITransform } from 'cc'
import type { PlayerId } from '../core/generated'
import type { PlayAreaController } from '../ui/PlayAreaController'
import {
  auditTableLayoutOverlaps,
  formatTableLayoutOverlapReport,
  type TableLayoutOverlapReport,
  type TableLayoutRegion,
  type TableLayoutRegionRole,
} from '../ui/TableLayoutOverlapAudit'
import type { TableViewport } from '../ui/ScreenAdapter'

export type TableLayoutAuditNode = Readonly<{
  id: string
  label: string
  role: TableLayoutRegionRole
  interactive: boolean
  node: Node | null | undefined
}>

export type TableLayoutAuditBridgeDependencies = Readonly<{
  viewport: () => TableViewport | null
  handNode: () => Node | null
  playArea: () => PlayAreaController | null
  humanId: () => PlayerId
  seatOrder?: () => readonly PlayerId[]
  hudRoot: () => Node | null
  auxiliaryNodes: () => readonly TableLayoutAuditNode[]
}>

type BrowserAuditBridge = Readonly<{
  snapshot: () => TableLayoutOverlapReport
  warn: () => TableLayoutOverlapReport
}>

type AuditHost = typeof globalThis & {
  location?: { search?: string }
  document?: Document
  __guandanLayoutAudit?: BrowserAuditBridge
}

const HUD_SURFACES: readonly Omit<TableLayoutAuditNode, 'node'>[] = [
  { id: 'table-back', label: '返回大厅', role: 'control', interactive: true },
  { id: 'match-summary', label: '级牌信息', role: 'information', interactive: false },
  { id: 'card-counter', label: '记牌器', role: 'control', interactive: true },
  { id: 'seat-bottom', label: '我方信息', role: 'information', interactive: false },
  { id: 'seat-right', label: '右家信息', role: 'information', interactive: false },
  { id: 'seat-top', label: '对家信息', role: 'information', interactive: false },
  { id: 'seat-left', label: '左家信息', role: 'information', interactive: false },
  { id: 'straight-flush-tools', label: '同花顺工具', role: 'control', interactive: true },
  { id: 'hand-tools', label: '理牌工具', role: 'control', interactive: true },
  { id: 'turn-actions', label: '回合操作按钮', role: 'control', interactive: true },
  { id: 'turn-timer', label: '回合倒计时', role: 'information', interactive: false },
]

const HUD_NODE_NAMES: Readonly<Record<string, string>> = Object.freeze({
  'table-back': 'TableBack', 'match-summary': 'MatchSummary', 'card-counter': 'CardCounter',
  'seat-bottom': 'Seat-bottom', 'seat-right': 'Seat-right', 'seat-top': 'Seat-top', 'seat-left': 'Seat-left',
  'straight-flush-tools': 'StraightFlushSuitBar', 'hand-tools': 'BottomTableToolbar',
  'turn-actions': 'FloatingOperationGroup', 'turn-timer': 'CircularTurnTimer',
})

const findDescendant = (root: Node, name: string): Node | null => {
  if (root.name === name) return root
  for (const child of root.children) {
    const found = findDescendant(child, name)
    if (found) return found
  }
  return null
}

/** Opt-in browser QA bridge. It observes layout and never mutates it. */
export class TableLayoutAuditBridge {
  private browserBridge: BrowserAuditBridge | null = null
  private reportControl: HTMLElement | null = null

  public constructor (private readonly dependencies: TableLayoutAuditBridgeDependencies) {}

  public install (): void {
    // Mini-game adapters may expose location/document without the browser APIs.
    // Optional QA must never stop the application from reaching the lobby.
    try {
      if (!sys.isBrowser || typeof URLSearchParams !== 'function') return
      const host = globalThis as AuditHost
      if (typeof host.document?.getElementById !== 'function') return
      if (!host.location?.search || !new URLSearchParams(host.location.search).has('layoutAudit')) return
      const bridge: BrowserAuditBridge = {
        snapshot: () => this.createReport(),
        warn: () => {
          const report = this.createReport()
          formatTableLayoutOverlapReport(report).forEach((line, index) => {
            if (index === 0 || line.startsWith('[warning]')) console.warn(`[layout] ${line}`)
            else console.info(`[layout] ${line}`)
          })
          return report
        },
      }
      host.__guandanLayoutAudit = bridge
      this.browserBridge = bridge
      this.installReportControl(host.document, bridge)
    } catch {
      console.warn('[layout] Optional browser layout audit unavailable; continuing startup.')
    }
  }

  public dispose (): void {
    const host = globalThis as AuditHost
    if (this.browserBridge && host.__guandanLayoutAudit === this.browserBridge) delete host.__guandanLayoutAudit
    this.browserBridge = null
    this.reportControl?.remove()
    this.reportControl = null
  }

  /** Opt-in QA UI exposes the same read-only report without console scripting. */
  private installReportControl (document: Document, bridge: BrowserAuditBridge): void {
    if (this.reportControl || typeof document.createElement !== 'function' || !document.body) return
    const root = document.createElement('div')
    root.id = 'GuandanLayoutAuditControl'
    root.style.cssText = 'position:fixed;right:8px;top:8px;z-index:10000;font:12px/1.5 sans-serif;'
    const button = document.createElement('button')
    button.textContent = '布局报告'
    button.style.cssText = 'min-height:28px;padding:3px 10px;border:1px solid #98c8cf;border-radius:6px;background:#173d4d;color:white;cursor:pointer;'
    const output = document.createElement('pre')
    output.hidden = true
    output.style.cssText = 'box-sizing:border-box;max-width:min(470px,90vw);max-height:55vh;overflow:auto;white-space:pre-wrap;padding:12px;background:#102b38;color:#fff;border:1px solid #98c8cf;'
    button.onclick = () => {
      output.hidden = !output.hidden
      button.textContent = output.hidden ? '布局报告' : '关闭报告'
      if (!output.hidden) output.textContent = formatTableLayoutOverlapReport(bridge.snapshot()).join('\n')
    }
    root.append(button, output)
    document.body.append(root)
    this.reportControl = root
  }

  private createReport (): TableLayoutOverlapReport {
    const viewport = this.dependencies.viewport() ?? { width: 1280, height: 720 } as TableViewport
    const canvas = (globalThis as AuditHost).document?.getElementById('GameCanvas') as HTMLCanvasElement | null | undefined
    const canvasRect = canvas?.getBoundingClientRect()
    return auditTableLayoutOverlaps(this.collectRegions(), viewport, {
      pixelScaleX: canvasRect?.width ? canvasRect.width / viewport.width : 1,
      pixelScaleY: canvasRect?.height ? canvasRect.height / viewport.height : 1,
      minimumAreaPx2: 4,
    })
  }

  private collectRegions (): TableLayoutRegion[] {
    const regions: TableLayoutRegion[] = []
    const appendNode = ({ id, label, role, interactive, node }: TableLayoutAuditNode): void => {
      if (!node?.isValid || !node.activeInHierarchy) return
      const rect = node.getComponent(UITransform)?.getBoundingBoxToWorld()
      // The operation row has symmetric clamp padding to centre its buttons.
      // Only its actual timer/buttons count as occupied, not that empty padding.
      const parts = id === 'turn-actions' ? node.children.flatMap(child => {
        const bounds = child.activeInHierarchy ? child.getComponent(UITransform)?.getBoundingBoxToWorld() : null
        return bounds ? [{ left: bounds.x, bottom: bounds.y, width: bounds.width, height: bounds.height }] : []
      }) : undefined
      if (rect) regions.push({ id, label, role, interactive, rect: { left: rect.x, bottom: rect.y, width: rect.width, height: rect.height }, ...(parts ? { parts } : {}) })
    }
    const hand = this.dependencies.handNode()
    if (hand?.isValid && hand.activeInHierarchy) {
      const rect = hand.getComponent(UITransform)?.getBoundingBoxToWorld()
      const parts = hand.children.flatMap(card => {
        const visual = findDescendant(card, 'CardVisual')
        const bounds = visual?.activeInHierarchy ? visual.getComponent(UITransform)?.getBoundingBoxToWorld() : null
        return bounds ? [{ left: bounds.x, bottom: bounds.y, width: bounds.width, height: bounds.height }] : []
      })
      if (rect && parts.length) regions.push({
        id: 'human-hand', label: '我方手牌区', role: 'cards', interactive: true,
        rect: { left: rect.x, bottom: rect.y, width: rect.width, height: rect.height }, parts,
      })
    }
    this.collectHudNodes().forEach(appendNode)
    this.dependencies.auxiliaryNodes().forEach(appendNode)
    this.collectPlayRegions().forEach(region => regions.push(region))
    return regions
  }

  private collectHudNodes (): TableLayoutAuditNode[] {
    const root = this.dependencies.hudRoot()
    if (!root) return []
    return HUD_SURFACES.flatMap(surface => {
      const node = findDescendant(root, HUD_NODE_NAMES[surface.id])
      if (!node || (surface.id === 'turn-timer' && node.parent !== root)) return []
      return [{ ...surface, node }]
    })
  }

  private collectPlayRegions (): TableLayoutRegion[] {
    const playArea = this.dependencies.playArea()
    if (!playArea?.node.activeInHierarchy) return []
    const players: readonly PlayerId[] = this.dependencies.seatOrder?.() ?? ['p1', 'p2', 'p3', 'p4']
    const labels = ['我方出牌区', '右家出牌区', '对家出牌区', '左家出牌区']
    const humanId = this.dependencies.humanId()
    const humanIndex = players.indexOf(humanId)
    return players.flatMap((playerId, playerIndex) => {
      const place = (playerIndex - humanIndex + players.length) % players.length
      const root = findDescendant(playArea.node, `play-${playerId}`)
      if (!root?.isValid || !root.activeInHierarchy) return []
      const rect = root.getComponent(UITransform)?.getBoundingBoxToWorld()
      const parts = root.children.flatMap(child => {
        const visual = child.name === 'PassText' ? child : findDescendant(child, 'CardVisual')
        const bounds = visual?.activeInHierarchy ? visual.getComponent(UITransform)?.getBoundingBoxToWorld() : null
        return bounds ? [{ left: bounds.x, bottom: bounds.y, width: bounds.width, height: bounds.height }] : []
      })
      if (!rect || !parts.length) return []
      return [{
        id: `play-${place}`, label: labels[place],
        role: root.children.some(child => child.name === 'PassText') ? 'information' as const : 'cards' as const,
        interactive: false, rect: { left: rect.x, bottom: rect.y, width: rect.width, height: rect.height }, parts,
      }]
    })
  }
}
