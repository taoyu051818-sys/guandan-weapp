import { Color, Label, Node, Rect, Size, Sprite, SpriteFrame, Texture2D, UITransform, Vec3 } from 'cc'
import { loadGameAsset } from '../services/GameAssetLoader'
import { LOBBY_DESIGN, type LobbyLayout, type LobbyRect } from './LobbyLayoutPolicy'
import { RuntimeUiFactory } from './RuntimeUiFactory'

/** Approved lobby typography, independent of the other pages' heavy outline floor. */
export function lobbyLabel (ui: RuntimeUiFactory, text: string, x: number, y: number,
  size: number, width: number, scale: number, parent?: Node, color = new Color(34, 60, 81), outline = 0, bold = true): Label {
  const label = ui.outlinedLabel(text, x, y, size * scale, {
    parent, width, height: (size + 4) * scale, color,
    outlineColor: new Color(58, 35, 17), outlineWidth: outline * scale,
  })
  label.fontSize = size * scale
  label.lineHeight = (size + 2) * scale
  label.enableWrapText = false
  label.isBold = bold
  label.enableOutline = outline > 0
  label.outlineWidth = outline * scale
  return label
}

/** Crop existing textures in the renderer; never mutate or duplicate source PNGs.
 * Alpha strips batch on one texture and avoid platform-specific canvas/shader paths. */
export function lobbyArtwork (parent: Node, name: string, asset: string, r: LobbyRect, topRatio = 1, fadeStart?: number): Node {
  const root = new Node(name)
  root.parent = parent
  root.setPosition(new Vec3(r.x, r.y, 0))
  root.addComponent(UITransform).setContentSize(r.width, r.height)
  const frames: SpriteFrame[] = []
  const cancel = loadGameAsset(asset, Texture2D, (error, texture) => {
    if (!root.isValid) return
    if (error || !texture) { console.warn('Lobby artwork unavailable:', asset, error); return }
    const cropHeight = texture.height * topRatio
    const cover = Math.max(r.width / texture.width, r.height / cropHeight)
    const sw = r.width / cover, sh = r.height / cover
    const sx = (texture.width - sw) / 2, sy = (cropHeight - sh) / 2
    const piece = (start: number, end: number, alpha: number): void => {
      const node = new Node('ArtworkSlice')
      node.parent = root
      node.setPosition(new Vec3(0, r.height * (.5 - (start + end) / 2), 0))
      node.addComponent(UITransform).setContentSize(r.width, r.height * (end - start))
      const frame = new SpriteFrame()
      frame.reset({ texture, rect: new Rect(sx, sy + start * sh, sw, (end - start) * sh), originalSize: new Size(sw, (end - start) * sh) })
      frame.packable = false
      frames.push(frame)
      const sprite = node.addComponent(Sprite)
      sprite.sizeMode = Sprite.SizeMode.CUSTOM
      sprite.spriteFrame = frame
      sprite.color = new Color(255, 255, 255, Math.round(255 * alpha))
    }
    if (fadeStart === undefined) piece(0, 1, 1)
    else {
      piece(0, fadeStart, 1)
      for (let i = 0; i < 24; i++) piece(fadeStart + (1 - fadeStart) * i / 24, fadeStart + (1 - fadeStart) * (i + 1) / 24, 1 - (i + .5) / 24)
    }
  })
  root.on(Node.EventType.NODE_DESTROYED, () => { cancel(); frames.forEach(frame => frame.destroy()) })
  return root
}

export function renderLobbyEntries (ui: RuntimeUiFactory, layout: LobbyLayout,
  entries: ReadonlyArray<{ name: string, art: string, kind: 'classic' | 'friend' | 'tournament', action: () => void }>): void {
  const s = layout.scale
  for (const entry of entries) {
    const r = layout[entry.kind], tournament = entry.kind === 'tournament'
    const card = ui.panel(entry.name, r.x, r.y, r.width, r.height, {
      fill: tournament ? new Color(234, 241, 236, 245) : new Color(255, 251, 237),
      stroke: tournament ? new Color(190, 207, 199) : new Color(234, 214, 155), lineWidth: (tournament ? 1 : 2) * s, radius: 6 * s,
    })
    if (tournament) {
      lobbyArtwork(card, 'TournamentArtwork', entry.art, { x: r.width / 2 - 35.5 * s, y: 0, width: 61 * s, height: r.height - 10 * s }, .74)
      lobbyLabel(ui, '赛事', -r.width / 2 + 40 * s, r.height / 2 - 25 * s, 21, 70 * s, s, card)
      lobbyLabel(ui, '筹备中', -r.width / 2 + 42 * s, r.height / 2 - 47 * s, 12, 75 * s, s, card, new Color(89, 110, 115), 0, false)
    } else {
      const footer = (entry.kind === 'classic' ? 54 : 48) * s
      lobbyArtwork(card, 'EntryArtwork', entry.art, { x: 0, y: footer / 2 - s, width: r.width - 4 * s, height: r.height - footer - 2 * s }, .74)
      lobbyLabel(ui, entry.kind === 'classic' ? '经典掼蛋' : '好友房', 0, -r.height / 2 + footer - 18 * s, 24, r.width - 16 * s, s, card)
      lobbyLabel(ui, entry.kind === 'classic' ? '随机级牌 · 单局对战' : '创建房间 / 加入房间', 0, -r.height / 2 + 13 * s, 12, r.width - 16 * s, s, card, new Color(93, 113, 111), 0, false)
    }
    ui.makeInteractive(card, entry.action)
  }
}

export function renderLobbyShop (ui: RuntimeUiFactory, layout: LobbyLayout, art: string, action: () => void): void {
  const r = layout.shop, s = layout.scale
  const root = new Node('ShopShortcut')
  root.parent = ui.parent
  root.setPosition(new Vec3(r.x, r.y, 0))
  root.addComponent(UITransform).setContentSize(r.width, r.height)
  lobbyArtwork(root, 'ShopChickArtwork', art, { ...r, x: 0, y: 0 }, 1, LOBBY_DESIGN.shopFadeStart)
  lobbyLabel(ui, '商城', 0, -r.height * .34, LOBBY_DESIGN.shopFontSize, r.width - 12 * s, s, root, new Color(255, 226, 105), LOBBY_DESIGN.shopOutline)
  ui.makeInteractive(root, action, .95)
}
