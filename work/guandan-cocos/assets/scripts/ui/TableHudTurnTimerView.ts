import { Color, Graphics, Label, Node, Vec3 } from 'cc'
import { clamp, configureTransform, createTableHudLabel, finiteOr, type TableGameHudState } from './TableGameHudFoundation'

export type TableHudTurnTimerState = Readonly<Pick<
  TableGameHudState,
  'turnVisible' | 'turnSeconds' | 'turnDurationSeconds'
>>

const DEFAULT_STATE: TableHudTurnTimerState = Object.freeze({
  turnVisible: true,
  turnSeconds: 15,
  turnDurationSeconds: 15,
})

/** Owns the complete node, artwork and drawing lifecycle of the table turn timer. */
export class TableHudTurnTimerView {
  private root: Node | null = null
  private graphics: Graphics | null = null
  private artwork: Node | null = null
  private label: Label | null = null
  private state: TableHudTurnTimerState = DEFAULT_STATE

  public get node (): Node | null { return this.root }

  public mount (parent: Node): Node {
    if (this.root) {
      this.root.parent = parent
      this.attachArtwork()
      this.renderView()
      return this.root
    }
    const node = new Node('CircularTurnTimer')
    node.parent = parent
    configureTransform(node, 112, 112)
    this.graphics = node.addComponent(Graphics)
    this.label = createTableHudLabel(node, 'TurnSeconds', 62, 48, 30, new Color(255, 255, 255), 0, 0)
    this.root = node
    this.attachArtwork()
    this.renderView()
    return node
  }

  public render (state: TableHudTurnTimerState): void {
    this.state = {
      turnVisible: state.turnVisible,
      turnSeconds: state.turnSeconds,
      turnDurationSeconds: state.turnDurationSeconds,
    }
    this.renderView()
  }

  public setArtwork (artwork: Node | null): void {
    if (this.artwork && this.artwork !== artwork) this.artwork.destroy()
    this.artwork = artwork
    this.attachArtwork()
    this.renderView()
  }

  public dispose (): void {
    if (this.root) this.root.destroy()
    else this.artwork?.destroy()
    this.root = null
    this.graphics = null
    this.artwork = null
    this.label = null
  }

  private attachArtwork (): void {
    if (!this.artwork || !this.root) return
    this.artwork.parent = this.root
    this.artwork.setPosition(new Vec3(0, 2, -2))
    this.artwork.setSiblingIndex(0)
  }

  private renderView (): void {
    if (!this.graphics || !this.label) return
    if (this.root) this.root.active = this.state.turnVisible
    if (!this.state.turnVisible) return
    const duration = Math.max(1, finiteOr(this.state.turnDurationSeconds, 15))
    const remaining = Math.max(0, finiteOr(this.state.turnSeconds, 0))
    const progressRemaining = clamp(remaining, 0, duration)
    const warning = remaining <= 5
    const graphics = this.graphics
    graphics.clear()
    if (!this.artwork) {
      graphics.fillColor = new Color(7, 31, 43, 238)
      graphics.strokeColor = new Color(105, 179, 191, 230)
      graphics.lineWidth = 3
      graphics.circle(0, 0, 37)
      graphics.fill()
      graphics.stroke()
      graphics.strokeColor = warning ? new Color(255, 95, 74, 255) : new Color(255, 206, 74, 255)
      graphics.lineWidth = 6
      graphics.arc(0, 0, 32, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * (progressRemaining / duration), false)
      graphics.stroke()
    }
    this.label.string = String(Math.ceil(remaining))
    this.label.color = warning ? new Color(255, 126, 105) : new Color(255, 255, 255)
  }
}
