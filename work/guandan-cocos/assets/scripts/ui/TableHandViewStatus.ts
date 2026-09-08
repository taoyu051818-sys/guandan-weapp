import { Color, type Label, type Node, Vec3 } from 'cc'
import { createTableHudLabel } from './TableGameHudFoundation'
import type { TableHudBounds } from './TableHudLayoutPolicy'

/** Bottom-lane viewing label, separate from cards and from playable hand controls. */
export class TableHandViewStatus {
  private label: Label | null = null
  private tools: readonly (Node | undefined)[] = []

  public mount (root: Node, lock?: Node, arrange?: Node): void {
    this.tools = [lock, arrange]
    this.label = createTableHudLabel(root, 'HandViewStatus', 460, 42, 26, new Color(255, 225, 148))
    this.label.node.active = false
  }

  public render (text: string, toolsVisible: boolean): void {
    this.tools.forEach(node => { if (node) node.active = toolsVisible })
    if (!this.label) return
    this.label.string = text
    this.label.node.active = Boolean(text)
  }

  public layout (bounds: TableHudBounds): void {
    this.label?.node.setPosition(new Vec3((bounds.left + bounds.right) / 2, bounds.bottom + 42 * bounds.scale, 30))
    this.label?.node.setScale(new Vec3(bounds.scale, bounds.scale, 1))
  }

  public dispose (): void { this.label?.node.destroy(); this.label = null; this.tools = [] }
}
