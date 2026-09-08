import { Color } from 'cc'
import type { MatchQueueId } from '../../services/FrontPageGatewayContracts'

export type ClassicRoomMode = 'classic' | 'consecutive' | 'no-shuffle' | 'team-turn' | 'upgrade80'

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

export const CLASSIC_ROOM_MODES: ReadonlyArray<{ id: ClassicRoomMode, label: string, available: boolean }> = [
  { id: 'classic', label: '经典玩法', available: true },
  { id: 'consecutive', label: '连打过A', available: false },
  { id: 'no-shuffle', label: '不洗牌', available: false },
  { id: 'team-turn', label: '团团转', available: false },
  { id: 'upgrade80', label: '升级80分', available: false },
]

export const CLASSIC_ROOM_TIERS: ReadonlyArray<{ name: string, score: number, queueId: MatchQueueId, art: string, accent: Color }> = [
  { name: '初级场', score: 50, queueId: 'classic_50', art: LOBBY_ART.tierGreen, accent: new Color(75, 160, 78) },
  { name: '中级场', score: 300, queueId: 'classic_300', art: LOBBY_ART.tierBlue, accent: new Color(53, 139, 218) },
  { name: '高级场', score: 2000, queueId: 'classic_2000', art: LOBBY_ART.tierViolet, accent: new Color(139, 79, 211) },
  { name: '大师场', score: 10000, queueId: 'classic_10000', art: LOBBY_ART.tierGold, accent: new Color(230, 123, 42) },
]
