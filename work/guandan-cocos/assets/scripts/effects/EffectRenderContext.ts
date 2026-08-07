import type { Node, SpriteFrame, Vec3 } from 'cc'
import type { AudioEvent } from '../audio/AudioProfiles'
import type { CardBlastReactionRequest } from './CardBlastReaction'
import type { EffectAssetCatalog, EffectAssetEntry } from './EffectAssetCatalog'
import type { EffectHandle } from './EffectHandle'
import type { LegacyCoordinateAdapter } from './LegacyCoordinateAdapter'
import type { TransientEffectNodePool } from './TransientEffectNodePool'
import type { EffectProfile, EffectQuality, PlayEffectEvent, ShakeStrength } from './EffectTypes'

export type EffectRenderRoots = Readonly<{
  /** Only this root may be shaken; HUD and navigation stay stable. */
  tableRoot: Node
  /** Card snapshots and other spatially continuous effects. */
  flightRoot: Node
  /** Labels, dimmers and table-covering effects. */
  topRoot: Node
}>

export type EffectRenderServices = Readonly<{
  loadSpriteFrame?: (asset: EffectAssetEntry) => Promise<SpriteFrame | null>
  playSound?: (event: AudioEvent) => void
  vibrate?: (kind: EffectProfile['haptic']) => void
  shake?: (strength: ShakeStrength) => EffectHandle | null
  reactTableCards?: (request: CardBlastReactionRequest) => EffectHandle | null
  notifyImpact?: () => void
  reportError?: (effectKey: string, error: unknown) => void
}>

/** Everything a renderer may use; rules and network state stay outside it. */
export type EffectRenderContext = Readonly<{
  profile: EffectProfile
  quality: EffectQuality
  roots: EffectRenderRoots
  assets: EffectAssetCatalog
  nodePool: TransientEffectNodePool
  legacyCoordinates: LegacyCoordinateAdapter
  services?: EffectRenderServices
  event?: PlayEffectEvent
  sourceWorldPositions?: readonly Vec3[]
  targetWorldPosition?: Vec3
  metadata?: Readonly<Record<string, unknown>>
}>
