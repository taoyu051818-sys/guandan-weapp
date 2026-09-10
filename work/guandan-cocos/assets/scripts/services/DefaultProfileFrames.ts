import { SpriteFrame, Texture2D } from 'cc'
import { DEFAULT_PROFILE_CATALOG } from './DefaultProfileCatalog'
import { loadGameAsset } from './GameAssetLoader'

const frames = new Map<string, SpriteFrame>()
const pending = new Set<string>()
export const defaultProfileAsset = (name: string): string | undefined => DEFAULT_PROFILE_CATALOG.find(p => p.displayName === name)?.asset
export const defaultProfileFrame = (name: string): SpriteFrame | undefined => {
  const asset = defaultProfileAsset(name)
  if (!asset) return undefined
  if (!frames.has(asset) && !pending.has(asset)) {
    pending.add(asset)
    loadGameAsset(asset, Texture2D, (error, texture) => {
      if (error || !texture) return
      const frame = new SpriteFrame(); frame.texture = texture
      frames.set(asset, frame)
    })
  }
  return frames.get(asset)
}
