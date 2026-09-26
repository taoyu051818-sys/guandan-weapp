import { Color, Label, Node, Rect, Size, Sprite, SpriteFrame, Texture2D, UITransform, Vec3 } from 'cc'
import { loadGameAsset } from '../services/GameAssetLoader'
import { attachStarGlintSequence } from './StarGlint'
import type { StarGlintClock } from './StarGlintPolicy'
import { LOBBY_STAR_GLINT } from './LobbyStarGlintPolicy'
import { attachClassicEntryAnimation } from './ClassicEntryAnimation'
import { attachFriendEntrySteam } from './FriendEntrySteam'
import type { ClassicEntryClock } from './ClassicEntryAnimationPolicy'
import { LOBBY_DESIGN, lobbyDockLabelY, type LobbyLayout, type LobbyRect } from './LobbyLayoutPolicy'
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
      // Static art may finish loading after its animation overlay was attached.
      node.setSiblingIndex(frames.length)
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
  entries: ReadonlyArray<{ name: string, art: string, kind: 'classic' | 'friend' | 'tournament', action: () => void }>,
  motion?: { allowed: () => boolean, clock: StarGlintClock, friendClock?: StarGlintClock, classicClock?: ClassicEntryClock }): void {
  const s = layout.scale
  for (const entry of entries) {
    const r = layout[entry.kind], tournament = entry.kind === 'tournament'
    const card = ui.panel(entry.name, r.x, r.y, r.width, r.height, {
      fill: tournament ? new Color(234, 241, 236, 245) : new Color(255, 251, 237),
      stroke: tournament ? new Color(190, 207, 199) : new Color(234, 214, 155), lineWidth: (tournament ? 1 : 2) * s, frame: 'control', frameScale: s,
    })
    if (tournament) {
      const width = 61 * s, height = r.height - 10 * s
      const artwork = lobbyArtwork(card, 'TournamentArtwork', entry.art, { x: r.width / 2 - 35.5 * s, y: 0, width, height }, .74)
      if (motion) attachStarGlintSequence(artwork, { width, height, scale: s,
        points: LOBBY_STAR_GLINT.trophy, allowed: motion.allowed, clock: motion.clock, pressTarget: card })
      lobbyLabel(ui, '赛事', -r.width / 2 + 40 * s, r.height / 2 - 25 * s, 21, 70 * s, s, card)
      lobbyLabel(ui, '16人积分赛', -r.width / 2 + 42 * s, r.height / 2 - 47 * s, 12, 75 * s, s, card, new Color(89, 110, 115), 0, false)
    } else {
      const footer = (entry.kind === 'classic' ? 54 : 48) * s
      const width = r.width - 4 * s, height = r.height - footer - 2 * s
      const artwork = lobbyArtwork(card, 'EntryArtwork', entry.art, { x: 0, y: footer / 2 - s, width, height }, .74)
      if (entry.kind === 'classic' && motion?.classicClock) attachClassicEntryAnimation(artwork, {
        width, height, allowed: motion.allowed, clock: motion.classicClock, pressTarget: card,
      })
      if (entry.kind === 'friend' && motion) attachStarGlintSequence(artwork, {
        width, height, scale: s, points: LOBBY_STAR_GLINT.friend,
        allowed: motion.allowed, clock: motion.friendClock, pressTarget: card,
      })
      if (entry.kind === 'friend' && motion) attachFriendEntrySteam(artwork, {
        scale: s, allowed: motion.allowed, pressTarget: card,
      })
      lobbyLabel(ui, entry.kind === 'classic' ? '经典掼蛋' : '好友房', 0, -r.height / 2 + footer - 18 * s, 24, r.width - 16 * s, s, card)
      lobbyLabel(ui, entry.kind === 'classic' ? '随机级牌 · 单局对战' : '创建房间 · 邀请好友', 0, -r.height / 2 + 13 * s, 12, r.width - 16 * s, s, card, new Color(93, 113, 111), 0, false)
    }
    ui.makeInteractive(card, entry.action)
  }
}

export function renderLobbyShop (ui: RuntimeUiFactory, layout: LobbyLayout, art: string, action: () => void,
  motion?: { allowed: () => boolean, clock: StarGlintClock }): void {
  const r = layout.shop, s = layout.scale
  const root = new Node('ShopShortcut')
  root.parent = ui.parent
  root.setPosition(new Vec3(r.x, r.y, 0))
  root.addComponent(UITransform).setContentSize(r.width, r.height)
  lobbyArtwork(root, 'ShopChickArtwork', art, { ...r, x: 0, y: 0 }, 1, LOBBY_DESIGN.shopFadeStart)
  if (motion) attachStarGlintSequence(root, { width: r.width, height: r.height, scale: s,
    points: LOBBY_STAR_GLINT.shop, ...motion, pressTarget: root })
  lobbyLabel(ui, '商城', 0, lobbyDockLabelY(r.height / s, LOBBY_DESIGN.shopFontSize) * s, LOBBY_DESIGN.shopFontSize, r.width - 12 * s, s, root, new Color(255, 226, 105), LOBBY_DESIGN.shopOutline)
  ui.makeInteractive(root, action, .95)
}
