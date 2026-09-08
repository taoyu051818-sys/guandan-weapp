import { createHash } from 'node:crypto'

const websocketGuid = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11'

export const isProtocolUpgradeRequest = request => Boolean(
  request?.url === '/weapp'
  && request.headers?.upgrade?.toLowerCase() === 'websocket'
  && request.headers?.['sec-websocket-key'],
)

export const frameTextMessage = text => {
  const data = Buffer.from(text)
  if (data.length >= 65536) throw new Error('WebSocket 消息过大')
  const header = data.length < 126
    ? Buffer.from([0x81, data.length])
    : Buffer.from([0x81, 126, data.length >> 8, data.length & 255])
  return Buffer.concat([header, data])
}

export const sendProtocolMessage = (connection, type, payload = {}) => (
  connection.socket.write(frameTextMessage(JSON.stringify({ type, ...payload })))
)

export const rejectWebSocketUpgrade = (socket, status, message) => {
  socket.end(`HTTP/1.1 ${status}\r\nConnection: close\r\nContent-Type: text/plain; charset=utf-8\r\nContent-Length: ${Buffer.byteLength(message)}\r\n\r\n${message}`)
}

const acceptUpgrade = (request, socket) => {
  const accept = createHash('sha1')
    .update(`${request.headers['sec-websocket-key']}${websocketGuid}`)
    .digest('base64')
  socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`)
}

const nextFrame = (connection, maxMessageBytes) => {
  if (connection.buffer.length < 2) return null
  const finalFrame = Boolean(connection.buffer[0] & 0x80)
  const opcode = connection.buffer[0] & 15
  const length = connection.buffer[1] & 127
  const masked = Boolean(connection.buffer[1] & 128)
  const headerLength = length < 126 ? 2 : 4
  if (!finalFrame || !masked || length === 127) return { invalid: true }
  if (connection.buffer.length < headerLength + 4) return null
  const size = length === 126 ? connection.buffer.readUInt16BE(2) : length
  const maskStart = headerLength
  const bodyStart = headerLength + 4
  if (size > maxMessageBytes) return { invalid: true }
  if (connection.buffer.length < bodyStart + size) return null
  const body = Buffer.from(connection.buffer.subarray(bodyStart, bodyStart + size))
  for (let index = 0; index < size; index += 1) body[index] ^= connection.buffer[maskStart + index % 4]
  connection.buffer = connection.buffer.subarray(bodyStart + size)
  return { opcode, body }
}

const consumeFrames = (connection, { maxMessageBytes, onMessage, onInvalidMessage }) => {
  while (connection.buffer.length >= 2) {
    const parsed = nextFrame(connection, maxMessageBytes)
    if (!parsed) return
    if (parsed.invalid) {
      connection.socket.destroy()
      return
    }
    const { opcode, body } = parsed
    if (opcode === 8) {
      connection.socket.end()
      return
    }
    if (opcode === 9) {
      if (body.length > 125) connection.socket.destroy()
      else connection.socket.write(Buffer.concat([Buffer.from([0x8a, body.length]), body]))
      continue
    }
    if (opcode === 10) continue
    if (opcode !== 1) {
      connection.socket.destroy()
      return
    }
    try {
      onMessage(connection, JSON.parse(body.toString()))
    } catch {
      onInvalidMessage(connection)
    }
  }
}

/**
 * Owns the HTTP upgrade and raw WebSocket frame lifecycle. Domain callbacks only
 * receive parsed protocol objects and connection-close notifications.
 */
export const upgradeToProtocolConnection = ({
  request,
  socket,
  allowedOrigins,
  connectionCount,
  maxConnections,
  maxMessageBytes,
  createConnectionId,
  onOpen,
  onMessage,
  onInvalidMessage,
  onClose,
}) => {
  if (!isProtocolUpgradeRequest(request)) {
    socket.destroy()
    return null
  }
  const origin = typeof request.headers.origin === 'string' ? request.headers.origin : ''
  if (origin && allowedOrigins.length && !allowedOrigins.includes(origin)) {
    rejectWebSocketUpgrade(socket, '403 Forbidden', 'WebSocket origin is not allowed')
    return null
  }
  if (connectionCount >= maxConnections) {
    rejectWebSocketUpgrade(socket, '503 Service Unavailable', 'WebSocket capacity reached')
    return null
  }

  acceptUpgrade(request, socket)
  const connection = {
    id: createConnectionId(),
    socket,
    buffer: Buffer.alloc(0),
    roomId: null,
    rateWindowStartedAt: Date.now(),
    rateWindowCount: 0,
    rateLimitViolations: 0,
    pendingCommands: 0,
    acceptingCommands: true,
    dropQueuedCommands: false,
    acceptedCacheKeys: new Map(),
  }
  onOpen(connection)
  // 客户端切后台、开发者工具重启都会直接断开 TCP；错误由 close 清理统一收口。
  socket.on('error', () => {})
  socket.on('data', chunk => {
    connection.buffer = Buffer.concat([connection.buffer, chunk])
    consumeFrames(connection, { maxMessageBytes, onMessage, onInvalidMessage })
  })
  socket.on('close', () => onClose(connection))
  return connection
}
