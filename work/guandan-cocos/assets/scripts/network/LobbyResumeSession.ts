import type { PlayerId } from '../core/generated'
import { parseNetworkEndpoint } from '../services/NetworkEndpoint'

export const LOBBY_RESUME_STORAGE_KEY = 'guandan-cocos-lobby-resume-v1'

export type LobbyResumeStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>

export type LobbyResumeSession = Readonly<{
  version: 1
  endpoint: string
  roomId: string
  seat: PlayerId
  resumeToken: string
  matchId?: string
}>

const isPlayerId = (value: unknown): value is PlayerId =>
  value === 'p1' || value === 'p2' || value === 'p3' || value === 'p4'

const isEndpoint = (value: unknown): value is string => {
  if (typeof value !== 'string' || value.length > 2048) return false
  try {
    const protocol = parseNetworkEndpoint(value).protocol
    return protocol === 'ws:' || protocol === 'wss:'
  } catch {
    return false
  }
}

const normalizeSession = (value: unknown): LobbyResumeSession | null => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const candidate = value as Record<string, unknown>
  if (
    candidate.version !== 1 || !isEndpoint(candidate.endpoint) ||
    typeof candidate.roomId !== 'string' || !/^\d{6}$/.test(candidate.roomId) ||
    !isPlayerId(candidate.seat) || typeof candidate.resumeToken !== 'string' ||
    candidate.resumeToken.length < 8 || candidate.resumeToken.length > 512 ||
    (candidate.matchId !== undefined && (typeof candidate.matchId !== 'string' || candidate.matchId.length < 1 || candidate.matchId.length > 256))
  ) return null
  return {
    version: 1,
    endpoint: candidate.endpoint,
    roomId: candidate.roomId,
    seat: candidate.seat,
    resumeToken: candidate.resumeToken,
    ...(candidate.matchId ? { matchId: candidate.matchId } : {}),
  }
}

export class LobbyResumeSessionStore {
  public constructor (private readonly storage: LobbyResumeStorage) {}

  public restore (): LobbyResumeSession | null {
    try {
      const raw = this.storage.getItem(LOBBY_RESUME_STORAGE_KEY)
      if (!raw) return null
      const restored = normalizeSession(JSON.parse(raw))
      if (restored) return restored
    } catch {
      // A malformed or inaccessible storage record is not a recoverable identity.
    }
    this.clear()
    return null
  }

  public save (session: LobbyResumeSession): boolean {
    const normalized = normalizeSession(session)
    if (!normalized) return false
    try {
      this.storage.setItem(LOBBY_RESUME_STORAGE_KEY, JSON.stringify(normalized))
      return true
    } catch {
      this.clear()
      return false
    }
  }

  public clear (): void {
    try { this.storage.removeItem(LOBBY_RESUME_STORAGE_KEY) } catch {}
  }
}
