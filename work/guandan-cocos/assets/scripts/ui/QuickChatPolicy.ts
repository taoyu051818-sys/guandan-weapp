import type { PlayerId } from '../core/generated'

export type QuickChatPhrase = Readonly<{
  id: 'hurry' | 'nice-play' | 'teamwork' | 'cheer' | 'thanks' | 'play-again'
  text: string
  /** Optional resource key. Missing quick-chat voices degrade to silence. */
  voice: string
}>

/** Fixed, neutral and auditable copy. Arbitrary network text never becomes a table bubble. */
export const QUICK_CHAT_PHRASES: readonly QuickChatPhrase[] = Object.freeze([
  Object.freeze({ id: 'hurry', text: '请尽快出牌', voice: 'chat_hurry' }),
  Object.freeze({ id: 'nice-play', text: '你的牌打得太好啦', voice: 'niuma/chat_nice_play' }),
  Object.freeze({ id: 'teamwork', text: '配合得好', voice: 'chat_teamwork' }),
  Object.freeze({ id: 'cheer', text: '大家加油', voice: 'chat_cheer' }),
  Object.freeze({ id: 'thanks', text: '谢谢', voice: 'chat_thanks' }),
  Object.freeze({ id: 'play-again', text: '再来一局', voice: 'chat_play_again' }),
])

export type QuickChatBubble = Readonly<{
  id: number
  playerId: PlayerId
  phraseId: QuickChatPhrase['id']
  message: string
  voice: string
  createdAt: number
  expiresAt: number
}>

export type QuickChatRejectionReason = 'unknown-phrase' | 'user-throttled' | 'repeat-cooldown'

export type QuickChatDecision =
  | Readonly<{ accepted: true, bubble: QuickChatBubble }>
  | Readonly<{ accepted: false, reason: QuickChatRejectionReason, retryAfterMs: number }>

export type QuickChatPolicyOptions = Readonly<{
  perUserIntervalMs?: number
  repeatCooldownMs?: number
  bubbleTtlMs?: number
}>

const phraseById = new Map<string, QuickChatPhrase>(QUICK_CHAT_PHRASES.map(phrase => [phrase.id, phrase]))
const phraseByText = new Map<string, QuickChatPhrase>(QUICK_CHAT_PHRASES.map(phrase => [phrase.text, phrase]))

export const resolveQuickChatPhrase = (value: string | QuickChatPhrase): QuickChatPhrase | null => {
  const key = typeof value === 'string' ? value.trim() : value.id
  const phrase = phraseById.get(key) ?? phraseByText.get(key)
  if (!phrase) return null
  if (typeof value !== 'string' && (value.text !== phrase.text || value.voice !== phrase.voice)) return null
  return phrase
}

const normalizedDuration = (value: number | undefined, fallback: number, minimum: number, maximum: number): number => {
  if (!Number.isFinite(value)) return fallback
  return Math.max(minimum, Math.min(maximum, Math.round(value!)))
}

/**
 * Presentation-only policy. It never mutates a game state, socket, turn, hand or rule result.
 * Blocking is scoped to viewer/sender visibility and deliberately does not reject network data.
 */
export class QuickChatPolicy {
  public readonly perUserIntervalMs: number
  public readonly repeatCooldownMs: number
  public readonly bubbleTtlMs: number

  private nextId = 1
  private readonly lastAcceptedAt = new Map<PlayerId, number>()
  private readonly lastPhraseAt = new Map<PlayerId, Map<QuickChatPhrase['id'], number>>()
  private readonly bubbles = new Map<PlayerId, QuickChatBubble>()
  private readonly blockedSenders = new Map<PlayerId, Set<PlayerId>>()

  public constructor (options: QuickChatPolicyOptions = {}) {
    this.perUserIntervalMs = normalizedDuration(options.perUserIntervalMs, 1200, 500, 10000)
    this.repeatCooldownMs = Math.max(
      this.perUserIntervalMs,
      normalizedDuration(options.repeatCooldownMs, 8000, 1000, 60000),
    )
    this.bubbleTtlMs = normalizedDuration(options.bubbleTtlMs, 2500, 800, 8000)
  }

  /** Validates and records one accepted bubble. Calls from different players are independent. */
  public submit (playerId: PlayerId, value: string | QuickChatPhrase, now = Date.now()): QuickChatDecision {
    const phrase = resolveQuickChatPhrase(value)
    if (!phrase) return Object.freeze({ accepted: false, reason: 'unknown-phrase', retryAfterMs: 0 })

    const lastAcceptedAt = this.lastAcceptedAt.get(playerId) ?? -Infinity
    const intervalRemaining = lastAcceptedAt + this.perUserIntervalMs - now
    if (intervalRemaining > 0) {
      return Object.freeze({ accepted: false, reason: 'user-throttled', retryAfterMs: intervalRemaining })
    }

    const playerPhrases = this.lastPhraseAt.get(playerId)
    const lastSamePhraseAt = playerPhrases?.get(phrase.id) ?? -Infinity
    const repeatRemaining = lastSamePhraseAt + this.repeatCooldownMs - now
    if (repeatRemaining > 0) {
      return Object.freeze({ accepted: false, reason: 'repeat-cooldown', retryAfterMs: repeatRemaining })
    }

    const bubble: QuickChatBubble = Object.freeze({
      id: this.nextId++,
      playerId,
      phraseId: phrase.id,
      message: phrase.text,
      voice: phrase.voice,
      createdAt: now,
      expiresAt: now + this.bubbleTtlMs,
    })
    this.lastAcceptedAt.set(playerId, now)
    const nextPlayerPhrases = playerPhrases ?? new Map<QuickChatPhrase['id'], number>()
    nextPlayerPhrases.set(phrase.id, now)
    this.lastPhraseAt.set(playerId, nextPlayerPhrases)
    this.bubbles.set(playerId, bubble)
    return Object.freeze({ accepted: true, bubble })
  }

  public getBubble (playerId: PlayerId, now = Date.now()): QuickChatBubble | undefined {
    const bubble = this.bubbles.get(playerId)
    if (!bubble) return undefined
    if (bubble.expiresAt <= now) {
      this.bubbles.delete(playerId)
      return undefined
    }
    return bubble
  }

  /** Returns only presentation-visible data; block state never changes the stored message. */
  public getVisibleBubble (viewerId: PlayerId, playerId: PlayerId, now = Date.now()): QuickChatBubble | undefined {
    if (this.isBlocked(viewerId, playerId)) return undefined
    return this.getBubble(playerId, now)
  }

  public block (viewerId: PlayerId, senderId: PlayerId): void {
    if (viewerId === senderId) return
    const senders = this.blockedSenders.get(viewerId) ?? new Set<PlayerId>()
    senders.add(senderId)
    this.blockedSenders.set(viewerId, senders)
  }

  public unblock (viewerId: PlayerId, senderId: PlayerId): void {
    const senders = this.blockedSenders.get(viewerId)
    if (!senders) return
    senders.delete(senderId)
    if (senders.size === 0) this.blockedSenders.delete(viewerId)
  }

  public isBlocked (viewerId: PlayerId, senderId: PlayerId): boolean {
    return this.blockedSenders.get(viewerId)?.has(senderId) ?? false
  }

  /** Clears expired presentation state and returns the seats that need a re-render. */
  public expire (now = Date.now()): PlayerId[] {
    const expired: PlayerId[] = []
    this.bubbles.forEach((bubble, playerId) => {
      if (bubble.expiresAt > now) return
      this.bubbles.delete(playerId)
      expired.push(playerId)
    })
    return expired
  }
}
