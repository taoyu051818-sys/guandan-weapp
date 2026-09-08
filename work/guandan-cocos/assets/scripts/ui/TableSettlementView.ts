import { Color, Label, Node, UITransform } from 'cc'
import { RuntimeUiFactory } from './RuntimeUiFactory'
import { coastalText } from './CoastalUi'

export type TableSettlementContent = Readonly<{
  title: string
  summary: string
  footer: string
  players: readonly Readonly<{ name: string, team: string, ready: string }>[]
}>

/** Presentation-only settlement; authoritative preparation still belongs to the coordinator. */
export class TableSettlementView {
  private root: Node | null = null
  private key = ''

  public render (overlay: Label, content: TableSettlementContent): void {
    // A phase panel must cover landed cards/effects, while the coordinator keeps its action above it.
    if (overlay.node.parent) overlay.node.setSiblingIndex(overlay.node.parent.children.length - 1)
    const key = JSON.stringify(content)
    if (!this.root?.isValid || this.key !== key) {
      this.clear()
      const ui = new RuntimeUiFactory(overlay.node)
      this.root = ui.panel('SettlementSurface', 0, 10, 760, 420, {
        fill: new Color(17, 52, 72, 250), stroke: new Color(180, 196, 155), lineWidth: 2, radius: 26,
      })
      const face = new RuntimeUiFactory(this.root)
      coastalText(face, content.title, 0, 163, 700, 48, 36, { bold: true, color: new Color(255, 224, 141) })
      coastalText(face, content.summary, 0, 122, 704, 32, 22)
      content.players.slice(0, 4).forEach((player, index) => {
        const card = face.panel(`SettlementRank-${index + 1}`, 0, 74 - index * 48, 700, 42, {
          fill: player.team === '我' ? new Color(52, 85, 98) : new Color(29, 65, 85), lineWidth: 0, radius: 8,
        })
        coastalText(face, ['头游', '二游', '三游', '末游'][index], -290, 0, 82, 30, 22, { parent: card, color: index === 0 ? new Color(255, 224, 141) : new Color(179, 207, 219) })
        coastalText(face, player.team, -198, 0, 82, 30, 20, { parent: card, color: new Color(164, 204, 216) })
        const name = Array.from(player.name).length > 10 ? `${Array.from(player.name).slice(0, 10).join('')}…` : player.name
        coastalText(face, name, 6, 0, 292, 30, 23, { parent: card, bold: true })
        coastalText(face, player.ready, 261, 0, 152, 30, 20, { parent: card, color: player.ready === '已准备' ? new Color(158, 232, 182) : new Color(182, 202, 207) })
      })
      coastalText(face, content.footer, 0, -124, 702, 48, 21, { color: new Color(179, 212, 222) })
      this.key = key
    }
    const width = overlay.node.getComponent(UITransform)?.contentSize.width ?? 760
    const scale = Math.min(1, width / 760)
    this.root.setScale(scale, scale, 1)
    overlay.string = ''
  }

  public clear (): void {
    if (this.root?.isValid) { this.root.active = false; this.root.destroy() }
    this.root = null
    this.key = ''
  }
}
