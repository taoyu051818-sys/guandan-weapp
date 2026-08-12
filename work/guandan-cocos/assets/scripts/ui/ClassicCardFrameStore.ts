import { SpriteFrame, Texture2D } from 'cc'
import { loadGameAssetAsync } from '../services/GameAssetLoader'
import { ALL_CLASSIC_CARD_ASSET_NAMES, classicCardAssetNames } from './CardSkinResolver'
import type { ClassicCardPlan } from './CardSkinResolver'

const frameCache = new Map<string, SpriteFrame>()
const frameRequests = new Map<string, Promise<SpriteFrame | null>>()

/**
 * Owns the process-wide classic-card frames. Hand cards, landed cards and VFX
 * snapshots must all reuse these SpriteFrames so a texture is never decoded
 * into competing renderer-local caches.
 */
export function requestClassicCardFrame (assetName: string): Promise<SpriteFrame | null> {
  const cached = frameCache.get(assetName)
  if (cached) return Promise.resolve(cached)

  const pending = frameRequests.get(assetName)
  if (pending) return pending

  const request = loadGameAssetAsync(`cards/classic/${assetName}/texture`, Texture2D)
    .then(texture => {
      const frame = new SpriteFrame()
      frame.texture = texture
      frameCache.set(assetName, frame)
      return frame
    })
    .catch(() => null)
    .finally(() => frameRequests.delete(assetName))
  frameRequests.set(assetName, request)
  return request
}

/** Returns every frame synchronously only when the complete face is cached. */
export function getCachedClassicCardFrames (plan: ClassicCardPlan): ReadonlyMap<string, SpriteFrame> | null {
  const frames = new Map<string, SpriteFrame>()
  for (const assetName of classicCardAssetNames(plan)) {
    const frame = frameCache.get(assetName)
    if (!frame) return null
    frames.set(assetName, frame)
  }
  return frames
}

/** Resolves an all-or-nothing frame set for one classic card face. */
export async function requestClassicCardFrames (plan: ClassicCardPlan): Promise<ReadonlyMap<string, SpriteFrame> | null> {
  const cached = getCachedClassicCardFrames(plan)
  if (cached) return cached

  const assets = classicCardAssetNames(plan)
  const entries = await Promise.all(assets.map(async assetName => [assetName, await requestClassicCardFrame(assetName)] as const))
  const frames = new Map<string, SpriteFrame>()
  for (const [assetName, frame] of entries) {
    if (!frame) return null
    frames.set(assetName, frame)
  }
  return frames
}

/** Warms one shared cache for any number of hand or effect plans. */
export async function preloadClassicCardFrames (plans: readonly ClassicCardPlan[]): Promise<boolean> {
  const assets = Array.from(new Set(plans.flatMap(classicCardAssetNames)))
  const frames = await Promise.all(assets.map(requestClassicCardFrame))
  return frames.every(Boolean)
}

/** Preloads the complete 37-component classic deck before the table appears. */
export async function preloadAllClassicCardFrames (): Promise<boolean> {
  const frames = await Promise.all(ALL_CLASSIC_CARD_ASSET_NAMES.map(requestClassicCardFrame))
  return frames.every(Boolean)
}
