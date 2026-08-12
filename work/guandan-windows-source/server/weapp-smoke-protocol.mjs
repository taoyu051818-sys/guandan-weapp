import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const { commandRequiresExpectedVersion } = require('../../../shared-core/dist/protocol')

const gameVersions = new WeakMap()
const roomGameVersions = new Map()

const trackGameVersion = (socket) => {
  if (gameVersions.has(socket)) return
  gameVersions.set(socket, 0)
  socket.addEventListener('message', ({ data }) => {
    try {
      const packet = JSON.parse(data)
      if (Number.isSafeInteger(packet.gameVersion) && packet.gameVersion >= 0) {
        gameVersions.set(socket, packet.gameVersion)
        if (typeof packet.roomId === 'string') {
          roomGameVersions.set(packet.roomId, Math.max(roomGameVersions.get(packet.roomId) ?? 0, packet.gameVersion))
        }
      }
    } catch {
      // Protocol smoke tests assert malformed packets separately when needed.
    }
  })
}

export const gameVersionFor = (socket, roomId) => (
  (typeof roomId === 'string' ? roomGameVersions.get(roomId) : undefined) ?? gameVersions.get(socket) ?? 0
)

export const sendProtocolCommand = (socket, type, payload, requestId) => {
  trackGameVersion(socket)
  const commandPayload = commandRequiresExpectedVersion(type) && !Number.isSafeInteger(payload?.expectedVersion)
    ? { ...payload, expectedVersion: gameVersionFor(socket, payload?.roomId) }
    : payload
  socket.send(JSON.stringify({ type, requestId, payload: commandPayload }))
}
