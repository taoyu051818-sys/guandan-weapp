import { Color, type Label, type Node, Vec3 } from 'cc'
import type { Player, PlayerId, TributeState } from '../core/generated'
import { createTableHudLabel } from './TableGameHudFoundation'
import type { TableHudPlacement } from './TableHudLayoutPolicy'

const shortName = (name: string): string => Array.from(name).slice(0, 4).join('')
export const tributeInfoText = (tribute: TributeState | null, players: Record<PlayerId, Player>, phase: string): string => {
  if (phase !== 'tribute' || !tribute) return ''
  const title = tribute.isAntiTribute ? '抗贡成立' : tribute.phase === 'tributing' ? '进贡阶段' : tribute.phase === 'returning' ? '还牌阶段' : '贡还完成'
  if (tribute.isAntiTribute || tribute.phase === 'done') return title
  const returning = tribute.phase === 'returning'
  const rows = tribute.actions.map(action => {
    const from = players[returning ? action.to : action.from].name
    const to = players[returning ? action.from : action.to].name
    return `${shortName(from)} 给 ${shortName(to)}`
  })
  return [title, ...rows].join('\n')
}

/** Non-interactive tribute information anchored beneath the partner, away from the operation lane. */
export class TableTributeInfoView {
  private label: Label | null = null
  public mount (parent: Node): void {
    this.label = createTableHudLabel(parent, 'TributeInfo', 240, 78, 20, new Color(249, 236, 191))
    this.label.lineHeight = 24
    this.label.node.active = false
  }
  public render (text: string): void {
    if (!this.label) return
    this.label.string = text
    this.label.node.active = Boolean(text)
  }
  public layout (partner: TableHudPlacement): void {
    this.label?.node.setPosition(new Vec3(partner.x, partner.y - 98 * partner.scale, 12))
    this.label?.node.setScale(new Vec3(partner.scale, partner.scale, 1))
  }
  public dispose (): void { this.label?.node.destroy(); this.label = null }
}
