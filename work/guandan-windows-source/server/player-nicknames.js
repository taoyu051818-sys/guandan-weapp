import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'

// Versioned, fictional nickname database: no real personal data or remote service.
const database = JSON.parse(readFileSync(new URL('./data/bot-nicknames.json', import.meta.url), 'utf8'))
if (database.version !== 1 || database.names?.length !== 100 || new Set(database.names).size !== 100 || database.names.some(name => typeof name !== 'string' || [...name].length < 2 || [...name].length > 6)) {
  throw new Error('机器人网名库必须包含 100 条不重复的有效网名')
}
export const BOT_NICKNAMES = Object.freeze([...database.names])

/** Fictional display names only. Stable across reconnect/restart, not real identities. */
export const generatedPlayerNickname = (identity, attempt = 0) => {
  const offset = createHash('sha256').update(`nickname-pool-v1:${identity}`).digest().readUInt32BE(0)
  return BOT_NICKNAMES[(offset + Math.max(0, Math.trunc(attempt))) % BOT_NICKNAMES.length]
}

export const roomPlayerNicknames = room => {
  room.botDisplayNames ||= {}
  const used = new Set()
  return Object.fromEntries(['p1', 'p2', 'p3', 'p4'].map(id => {
    const identity = room.botUserIdsBySeat?.[id] || `bot_${room.matchId || room.roomId}_${id}`
    let attempt = 0
    let name = room.botDisplayNames[id]
    if (!BOT_NICKNAMES.includes(name) || used.has(name)) name = generatedPlayerNickname(identity)
    while (used.has(name)) name = generatedPlayerNickname(identity, ++attempt)
    used.add(name)
    room.botDisplayNames[id] = name
    return [id, name]
  }))
}
