import { DEFAULT_PROFILES, stableDefaultProfile } from './default-profiles.js'

// Imported display profiles only; runtime never calls the upstream QQ API.
export const BOT_NICKNAMES = Object.freeze([...new Set(DEFAULT_PROFILES.map(p => p.displayName))])
if (BOT_NICKNAMES.length < 8) throw new Error('机器人资料库至少需要8个不同昵称')

/** Display names only. Stable across reconnect/restart, with bot identity retained separately. */
export const generatedPlayerNickname = (identity, attempt = 0) => {
  return stableDefaultProfile(identity, attempt).displayName
}

export const generatedPlayerAvatar = name => DEFAULT_PROFILES.find(p => p.displayName === name)?.avatarUrl || ''

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
