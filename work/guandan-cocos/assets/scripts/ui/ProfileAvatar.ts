import { ImageAsset, Node, Sprite, SpriteFrame, Texture2D, UITransform, Vec3 } from 'cc'
import type { AuthGateway, UserProfile } from '../services/FrontPageGatewayContracts'
import { loadGameAsset } from '../services/GameAssetLoader'

export const PROFILE_AVATARS = ['ui/common/default-avatar/texture', 'ui/lobby/shop-float-chick/texture'] as const
const cache = new Map<string, Promise<SpriteFrame | null>>()

/** Remote pixels arrive through the authenticated platform API, never an arbitrary CDN URL. */
export function profileAvatarFrame (profile: UserProfile | null | undefined, auth: AuthGateway): Promise<SpriteFrame | null> {
  const avatar = profile?.avatarUrl || ''
  const key = `${profile?.id ?? ''}:${avatar}`
  const cached = cache.get(key)
  if (cached) return cached
  const local = avatar.startsWith('asset:') ? avatar.slice(6) : avatar ? null : PROFILE_AVATARS[0]
  const promise = new Promise<SpriteFrame | null>(resolve => {
    const finish = (texture: Texture2D | null): void => {
      if (!texture) { cache.delete(key); resolve(null); return }
      const frame = new SpriteFrame()
      frame.texture = texture
      resolve(frame)
    }
    if (local) {
      loadGameAsset(PROFILE_AVATARS.includes(local as typeof PROFILE_AVATARS[number]) ? local : PROFILE_AVATARS[0], Texture2D,
        (error, texture) => finish(error ? null : texture))
      return
    }
    void auth.getAvatarImage(avatar).then(dataUri => {
      if (!dataUri) { finish(null); return }
      const image = new Image()
      const timeout = setTimeout(() => { image.onload = null; image.onerror = null; finish(null) }, 8000)
      image.onload = () => {
        clearTimeout(timeout)
        image.onload = null
        image.onerror = null
        if (image.width > 1024 || image.height > 1024) { finish(null); return }
        const texture = new Texture2D()
        texture.image = new ImageAsset(image)
        finish(texture)
      }
      image.onerror = () => { clearTimeout(timeout); finish(null) }
      image.src = dataUri
    }).catch(() => finish(null))
  })
  if (cache.size >= 8) cache.delete(cache.keys().next().value!)
  cache.set(key, promise)
  return promise
}

export function mountProfileAvatar (parent: Node, profile: UserProfile | null | undefined, auth: AuthGateway,
  x: number, y: number, size: number): Node {
  const node = new Node('ProfileAvatar')
  node.parent = parent
  node.setPosition(new Vec3(x, y, 0))
  node.addComponent(UITransform).setContentSize(size, size)
  const sprite = node.addComponent(Sprite)
  sprite.sizeMode = Sprite.SizeMode.CUSTOM
  void profileAvatarFrame(profile, auth).then(frame => {
    if (node.isValid && frame) sprite.spriteFrame = frame
    else if (node.isValid) void profileAvatarFrame(null, auth).then(fallback => { if (node.isValid) sprite.spriteFrame = fallback })
  })
  return node
}
