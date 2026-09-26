import { ImageAsset, SpriteFrame, Texture2D } from 'cc'
import type { AuthGateway, UserProfile } from './FrontPageGatewayContracts'
import { loadGameAssetAsync } from './GameAssetLoader'
import { DEFAULT_PROFILE_CATALOG } from './DefaultProfileCatalog'
import { LeasedAssetCache, type AssetLease } from './LeasedAssetCache'

const PROFILE_AVATARS = ['ui/common/default-avatar/texture', 'ui/lobby/shop-float-chick/texture'] as const
type OwnedAvatar = { frame: SpriteFrame, texture: Texture2D, image: ImageAsset | null }
const cache = new LeasedAssetCache<OwnedAvatar>(8, asset => {
  asset.frame.destroy()
  if (asset.image) { asset.texture.destroy(); asset.image.destroy() }
  else asset.texture.decRef()
})

function decodeAvatar (dataUri: string): Promise<OwnedAvatar | null> {
  return new Promise(resolve => {
    const image = new Image()
    let settled = false
    const finish = (value: OwnedAvatar | null): void => {
      if (settled) return
      settled = true
      clearTimeout(timeout)
      image.onload = null; image.onerror = null
      resolve(value)
    }
    const timeout = setTimeout(() => finish(null), 8000)
    image.onload = () => {
      if (settled) return
      if (!image.width || !image.height || image.width > 1024 || image.height > 1024) { finish(null); return }
      const pixels = new ImageAsset(image)
      const texture = new Texture2D()
      texture.image = pixels
      const frame = new SpriteFrame(); frame.texture = texture
      finish({ frame, texture, image: pixels })
    }
    image.onerror = () => finish(null)
    image.src = dataUri
  })
}

/** Remote pixels only come through the authenticated gateway, never a direct CDN load. */
export function acquireProfileAvatarFrame (profile: UserProfile | null | undefined, auth: AuthGateway): AssetLease<SpriteFrame> {
  const avatar = profile?.avatarUrl || ''
  const bundled = DEFAULT_PROFILE_CATALOG.find(p => p.avatarUrl === avatar)?.asset
  const local = bundled || (avatar.startsWith('asset:') ? avatar.slice(6) : avatar ? null : PROFILE_AVATARS[0])
  const lease = cache.acquire(`${profile?.id ?? ''}:${avatar}`, async () => {
    if (local) {
      const path = bundled || (PROFILE_AVATARS.includes(local as typeof PROFILE_AVATARS[number]) ? local : PROFILE_AVATARS[0])
      const texture = await loadGameAssetAsync(path, Texture2D)
      texture.addRef()
      const frame = new SpriteFrame(); frame.texture = texture
      return { frame, texture, image: null }
    }
    const dataUri = avatar.startsWith('data:image/jpeg;base64,') ? avatar : await auth.getAvatarImage(avatar)
    return dataUri ? decodeAvatar(dataUri) : null
  })
  return { ready: lease.ready.then(value => value?.frame ?? null), release: lease.release }
}

export function clearProfileAvatarCache (): void { cache.clear() }
