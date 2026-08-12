export const createAcceptedActionStore = ({ maxEntries }) => {
  if (!Number.isSafeInteger(maxEntries) || maxEntries < 1) throw new Error('maxEntries must be positive')
  const entries = new Map()
  const reservations = new Set()

  const reserve = key => {
    if (!key || entries.has(key) || reservations.has(key)) return true
    const pendingCount = [...entries.values()].filter(value => value.pendingDurability).length
    if (pendingCount + reservations.size >= maxEntries) return false
    reservations.add(key)
    return true
  }
  const release = key => { if (key) reservations.delete(key) }
  const remember = (key, fingerprint, response, messageType = 'actionAccepted') => {
    if (!key) return true
    if (!entries.has(key) && !reservations.has(key) && !reserve(key)) return false
    while (!entries.has(key) && entries.size >= maxEntries) {
      const oldestDurable = [...entries].find(([, value]) => !value.pendingDurability)?.[0]
      if (oldestDurable === undefined) { reservations.delete(key); return false }
      entries.delete(oldestDurable)
    }
    reservations.delete(key)
    entries.set(key, { fingerprint, messageType, response, pendingDurability: true })
    return true
  }
  const rotateToken = (previousToken, nextToken, room = null) => {
    const prefix = `${previousToken}:`
    for (const [key, value] of [...entries]) {
      if (!key.startsWith(prefix)) continue
      entries.delete(key)
      entries.set(`${nextToken}:${key.slice(prefix.length)}`, value)
    }
    if (room?.pendingGameStartRequest?.cacheKey?.startsWith(prefix)) {
      room.pendingGameStartRequest.cacheKey = `${nextToken}:${room.pendingGameStartRequest.cacheKey.slice(prefix.length)}`
    }
  }
  const deleteToken = token => {
    const prefix = `${token}:`
    for (const key of [...entries.keys()]) if (key.startsWith(prefix)) entries.delete(key)
    for (const key of [...reservations]) if (key.startsWith(prefix)) reservations.delete(key)
  }
  return { entries, reserve, release, remember, rotateToken, deleteToken }
}
