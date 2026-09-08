import { Color, Graphics, Label, Node, Sprite, SpriteFrame, UITransform, Vec3 } from 'cc'
import type { PlayerId } from '../core/generated'
import { applyForegroundTextStyle } from './RuntimeUiFactory'
import {
  TABLE_HUD_SEAT_PLACES,
  type TableHudPlacement,
  type TableHudSeatPlace,
  type TableHudSize,
} from './TableHudLayoutPolicy'

export type TableHudSeatState = Readonly<{
  playerId?: PlayerId
  place: TableHudSeatPlace
  name: string
  status: string
  avatarText?: string
  active?: boolean
  offline?: boolean
}>

type SeatView = {
  node: Node
  graphics: Graphics
  avatarSprite: Sprite
  nameLabel: Label
  rankLabel: Label
}

const SEAT_WIDTH = 280
const SEAT_HEIGHT = 100
const MIN_HUD_FONT_SIZE = 20

export const TABLE_HUD_DEFAULT_SEAT_NAMES: Readonly<Record<TableHudSeatPlace, string>> = Object.freeze({
  bottom: '我',
  right: '下家',
  top: '对家',
  left: '上家',
})

const AVATAR_COLORS: Readonly<Record<TableHudSeatPlace, Color>> = Object.freeze({
  bottom: new Color(64, 168, 177),
  right: new Color(211, 117, 72),
  top: new Color(124, 119, 201),
  left: new Color(91, 157, 105),
})

export const createDefaultTableHudSeats = (): readonly TableHudSeatState[] => TABLE_HUD_SEAT_PLACES.map(place => ({
  place,
  name: TABLE_HUD_DEFAULT_SEAT_NAMES[place],
  status: '',
}))

const compactHudText = (value: string, maximumCharacters: number): string => {
  const characters = Array.from(value.trim())
  return characters.length <= maximumCharacters ? characters.join('') : `${characters.slice(0, maximumCharacters - 1).join('')}…`
}

const configureTransform = (node: Node, width: number, height: number): UITransform => {
  const transform = node.getComponent(UITransform) ?? node.addComponent(UITransform)
  transform.setContentSize(width, height)
  return transform
}

const configureLabelMetrics = (label: Label, width: number, height: number, fontSize: number, x: number, y: number): void => {
  configureTransform(label.node, width, height)
  label.node.setPosition(new Vec3(x, y, 1))
  label.fontSize = Math.max(MIN_HUD_FONT_SIZE, Math.round(fontSize))
  label.lineHeight = label.fontSize + 6
  applyForegroundTextStyle(label, new Color(18, 38, 43, 255), label.fontSize >= 30 ? 4 : 3)
}

const createLabel = (parent: Node, name: string, width: number, height: number, fontSize: number, color: Color): Label => {
  const node = new Node(name)
  node.parent = parent
  configureTransform(node, width, height)
  const label = node.addComponent(Label)
  label.fontSize = Math.max(MIN_HUD_FONT_SIZE, Math.round(fontSize))
  label.lineHeight = label.fontSize + 5
  label.overflow = Label.Overflow.SHRINK
  label.horizontalAlign = Label.HorizontalAlign.CENTER
  label.verticalAlign = Label.VerticalAlign.CENTER
  label.color = color
  return applyForegroundTextStyle(label, new Color(18, 38, 43, 255), label.fontSize >= 24 ? 3 : 2)
}

/** Owns the complete lifecycle of the four viewer-relative table seats. */
export class TableHudSeatViewGroup {
  private readonly views = new Map<TableHudSeatPlace, SeatView>()
  private seats: readonly TableHudSeatState[] = createDefaultTableHudSeats()
  private defaultAvatarFrame: SpriteFrame | null = null
  private ownAvatarFrame: SpriteFrame | null = null
  public ownAvatarHitNode: Node | null = null
  public onSeatAvatar: ((playerId: PlayerId) => void) | undefined

  public bindOwnAvatar (callback: () => void): void {
    const parent = this.views.get('bottom')?.node
    if (!parent || this.ownAvatarHitNode) return
    const hit = new Node('EditOwnAvatar')
    hit.parent = parent
    configureTransform(hit, 80, 80)
    hit.setPosition(new Vec3(-96, 0, 3))
    hit.on(Node.EventType.TOUCH_END, callback)
    this.ownAvatarHitNode = hit
  }

  public setOwnAvatarFrame (frame: SpriteFrame | null): void { this.ownAvatarFrame = frame; this.renderViews() }

  public mount (parent: Node): void {
    if (this.views.size === 0) {
      TABLE_HUD_SEAT_PLACES.forEach(place => this.views.set(place, this.createSeat(parent, place)))
    } else {
      this.views.forEach(view => { view.node.parent = parent })
    }
    this.renderViews()
  }

  public render (seats: readonly TableHudSeatState[]): void {
    this.seats = seats.map(seat => ({ ...seat }))
    this.renderViews()
  }

  public layout (placements: Readonly<Record<TableHudSeatPlace, TableHudPlacement>>, z = 10): void {
    TABLE_HUD_SEAT_PLACES.forEach(place => {
      const node = this.views.get(place)?.node
      const placement = placements[place]
      if (!node) return
      node.setPosition(new Vec3(placement.x, placement.y, z))
      node.setScale(new Vec3(placement.scale, placement.scale, 1))
    })
  }

  public getContentSize (): TableHudSize {
    const contentSize = this.views.get('bottom')?.node.getComponent(UITransform)?.contentSize
    return { width: Math.max(1, contentSize?.width ?? SEAT_WIDTH), height: Math.max(1, contentSize?.height ?? SEAT_HEIGHT) }
  }

  public setDefaultAvatarFrame (frame: SpriteFrame | null): void {
    this.defaultAvatarFrame = frame
    this.views.forEach(view => {
      view.avatarSprite.spriteFrame = frame
      view.avatarSprite.node.active = Boolean(frame)
    })
    this.renderViews()
  }

  public dispose (): void {
    this.views.forEach(view => view.node.destroy())
    this.views.clear()
  }

  private createSeat (parent: Node, place: TableHudSeatPlace): SeatView {
    const node = new Node(`Seat-${place}`)
    node.parent = parent
    configureTransform(node, SEAT_WIDTH, SEAT_HEIGHT)
    const graphics = node.addComponent(Graphics)
    const avatarNode = new Node('DefaultAvatar')
    avatarNode.parent = node
    configureTransform(avatarNode, 64, 64)
    const avatarSprite = avatarNode.addComponent(Sprite)
    avatarSprite.sizeMode = Sprite.SizeMode.CUSTOM
    avatarSprite.node.active = false
    avatarNode.on(Node.EventType.TOUCH_END, () => {
      const id = this.seats.find(seat => seat.place === place)?.playerId
      if (id) this.onSeatAvatar?.(id)
    })
    const nameLabel = createLabel(node, 'PlayerName', 180, 32, 22, new Color(240, 246, 243))
    const rankLabel = createLabel(node, 'PlayerRank', 172, 34, 24, new Color(255, 216, 105))
    return { node, graphics, avatarSprite, nameLabel, rankLabel }
  }

  private renderViews (): void {
    const byPlace = new Map(this.seats.map(seat => [seat.place, seat]))
    TABLE_HUD_SEAT_PLACES.forEach(place => {
      const seat = byPlace.get(place) ?? {
        place,
        name: TABLE_HUD_DEFAULT_SEAT_NAMES[place],
        status: '',
      }
      const view = this.views.get(place)
      if (view) this.renderSeat(view, seat, place)
    })
  }

  private renderSeat (view: SeatView, seat: TableHudSeatState, place: TableHudSeatPlace): void {
    const offline = Boolean(seat.offline)
    const active = Boolean(seat.active) && !offline
    const side = place === 'left' || place === 'right'
    configureTransform(view.node, side ? 156 : SEAT_WIDTH, side ? 168 : SEAT_HEIGHT)
    const avatarSize = 72
    const avatarX = side ? 0 : -96
    const avatarY = side ? 30 : 0
    const textWidth = side ? 144 : 180
    const textX = side ? 0 : 42
    const statusHeight = 34
    const statusY = side ? -62 : -23
    view.graphics.clear()
    view.graphics.fillColor = offline ? new Color(71, 82, 84) : AVATAR_COLORS[place]
    view.graphics.strokeColor = active ? new Color(255, 218, 104) : new Color(221, 236, 232)
    view.graphics.lineWidth = active ? 2.5 : 1.5
    view.graphics.roundRect(avatarX - avatarSize / 2, avatarY - avatarSize / 2, avatarSize, avatarSize, 16)
    view.graphics.fill()
    view.graphics.stroke()
    if (seat.status.trim()) {
      view.graphics.fillColor = active ? new Color(98, 70, 20, 245) : new Color(31, 60, 68, 245)
      view.graphics.roundRect(textX - textWidth / 2, statusY - statusHeight / 2, textWidth, statusHeight, statusHeight / 2)
      view.graphics.fill()
    }
    configureTransform(view.avatarSprite.node, avatarSize - 8, avatarSize - 8)
    view.avatarSprite.node.setPosition(new Vec3(avatarX, avatarY, 2))
    configureLabelMetrics(view.nameLabel, textWidth, 32, 22, textX, side ? -26 : 22)
    configureLabelMetrics(view.rankLabel, textWidth - 8, statusHeight, 24, textX, statusY)
    view.avatarSprite.spriteFrame = place === 'bottom' ? this.ownAvatarFrame ?? this.defaultAvatarFrame : this.defaultAvatarFrame
    view.avatarSprite.node.active = Boolean(view.avatarSprite.spriteFrame)
    view.avatarSprite.color = offline ? new Color(150, 156, 154) : new Color(255, 255, 255)
    view.nameLabel.string = compactHudText(seat.name || TABLE_HUD_DEFAULT_SEAT_NAMES[place], 6)
    view.nameLabel.color = offline ? new Color(148, 163, 163) : new Color(240, 246, 243)
    view.rankLabel.string = compactHudText(seat.status, 7)
    view.rankLabel.node.active = Boolean(view.rankLabel.string)
  }
}
