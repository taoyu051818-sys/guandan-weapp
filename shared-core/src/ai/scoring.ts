import { PlayType, type PlayResolution } from '../types/game';
export type CachedPlayInfo = PlayResolution | null;
export const isBombType = (type: PlayType): boolean =>
  type === PlayType.Bomb || type === PlayType.StraightFlush || type === PlayType.Rocket;
