import { PlatformError } from './errors.js'

/** Numeric room IDs are guessable: bound authenticated lookup attempts and memory. */
export class FriendRoomNumberLimiter {
  constructor (now = () => Date.now()) {
    this.now = now
    this.windows = new Map()
  }

  consume (userId) {
    const now = this.now()
    for (const [key, window] of this.windows) if (window.until <= now) this.windows.delete(key)
    const current = this.windows.get(userId)
    if (current?.count >= 6 || (!current && this.windows.size >= 10_000)) {
      throw new PlatformError(429, 'FRIEND_ROOM_NUMBER_RATE_LIMIT', '加入操作过于频繁，请一分钟后重试')
    }
    if (current) current.count += 1
    else this.windows.set(userId, { until: now + 60_000, count: 1 })
  }
}
