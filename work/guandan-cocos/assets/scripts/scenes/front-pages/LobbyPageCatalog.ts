import { Color } from 'cc'
import { CLASSIC_MODES, type ClassicMode, type ClassicBaseStake } from '../../core/generated/lib/classicModes'

export type ClassicRoomMode = ClassicMode

export const LOBBY_ART = Object.freeze({
  entryClassic: 'ui/lobby/entry-classic/texture',
  entryFriend: 'ui/lobby/entry-friend/texture',
  entryTournament: 'ui/lobby/entry-tournament/texture',
  friendBackground: 'ui/lobby/friend-room-green/texture',
  shopChick: 'ui/lobby/shop-float-chick/texture',
  coin: 'ui/lobby/coin/texture',
  defaultAvatar: 'ui/common/default-avatar/texture',
  tierGreen: 'ui/lobby/tier-green/texture',
  tierBlue: 'ui/lobby/tier-blue/texture',
  tierViolet: 'ui/lobby/tier-violet/texture',
  tierGold: 'ui/lobby/tier-gold/texture',
})

export const CLASSIC_ROOM_MODES = CLASSIC_MODES

export const CLASSIC_ROOM_TIERS: ReadonlyArray<{ name: string, score: ClassicBaseStake, art: string, accent: Color }> = [
  { name: '初级场', score: 50, art: LOBBY_ART.tierGreen, accent: new Color(75, 160, 78) },
  { name: '中级场', score: 300, art: LOBBY_ART.tierBlue, accent: new Color(53, 139, 218) },
  { name: '高级场', score: 2000, art: LOBBY_ART.tierViolet, accent: new Color(139, 79, 211) },
  { name: '大师场', score: 10000, art: LOBBY_ART.tierGold, accent: new Color(230, 123, 42) },
]
