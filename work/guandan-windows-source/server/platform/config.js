import { resolve } from 'node:path'

const developmentSecret = (purpose) => `development-only-${purpose}-secret-change-before-deploying-2026`

const requiredInProduction = (env, name, value) => {
  if (env.NODE_ENV === 'production' && !value) throw new Error(`生产环境必须配置 ${name}`)
  return value
}

const endpoint = (env, name, value, protocols) => {
  if (!value) return ''
  let parsed
  try { parsed = new URL(value) } catch { throw new Error(`${name} 必须是有效 URL`) }
  if (!protocols.includes(parsed.protocol) || !parsed.hostname || parsed.username || parsed.password) {
    throw new Error(`${name} 协议或主机无效`)
  }
  return parsed.toString()
}

const webOrigin = (name, value) => {
  if (value === '*') return value
  let parsed
  try { parsed = new URL(value) } catch { throw new Error(`${name} 必须是有效 Web Origin`) }
  if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password || parsed.pathname !== '/' || parsed.search || parsed.hash) {
    throw new Error(`${name} 必须是无路径、无凭证的 HTTP/HTTPS Origin`)
  }
  return parsed.origin
}

const boundedInteger = (name, value, { minimum, maximum }) => {
  const parsed = Number(value)
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new Error(`${name} 必须是 ${minimum} 到 ${maximum} 的整数`)
  }
  return parsed
}

const integerSetting = (env, name, fallback, bounds) => boundedInteger(
  name,
  env[name] === undefined || env[name] === '' ? fallback : env[name],
  bounds,
)

const optionalFile = value => {
  const trimmed = String(value || '').trim()
  return trimmed ? resolve(trimmed) : ''
}

const persistentJsonFileNames = [
  'PLATFORM_JSON_FILE',
  'GAME_RESULT_OUTBOX_FILE',
  'GAME_SPECTATOR_OUTBOX_FILE',
  'WEAPP_ROOM_STATE_FILE',
]

const assertDistinctPersistentJsonFiles = (env) => {
  const ownerByResolvedPath = new Map()
  for (const name of persistentJsonFileNames) {
    const filePath = optionalFile(env[name])
    if (!filePath) continue
    const existing = ownerByResolvedPath.get(filePath)
    if (existing) {
      throw new Error(`${existing} 与 ${name} 解析为同一路径；四个持久 JSON 必须使用不同文件`)
    }
    ownerByResolvedPath.set(filePath, name)
  }
}

const secret = (env, name, purpose) => {
  const value = env[name] || developmentSecret(purpose)
  if (env.NODE_ENV === 'production' && value === developmentSecret(purpose)) {
    throw new Error(`生产环境必须配置 ${name}`)
  }
  if (value.length < 32) throw new Error(`${name} 至少需要32个字符`)
  return value
}

export const loadPlatformConfig = (env = process.env) => {
  const accessSecret = secret(env, 'PLATFORM_ACCESS_SECRET', 'access')
  const gameTicketSecret = secret(env, 'GAME_TICKET_SECRET', 'game-ticket')
  const gameResultSecret = secret(env, 'GAME_RESULT_SECRET', 'game-result')
  const spectatorEventSecret = secret(env, 'GAME_SPECTATOR_EVENT_SECRET', 'spectator-event')
  if (env.NODE_ENV === 'production' && new Set([accessSecret, gameTicketSecret, gameResultSecret, spectatorEventSecret]).size !== 4) {
    throw new Error('生产环境的平台访问、入桌票据、结算与观战必须使用四个不同密钥')
  }
  const production = env.NODE_ENV === 'production'
  const requestedStoreMode = String(env.PLATFORM_STORE_MODE || '').trim()
  if (requestedStoreMode && !['memory', 'json-single-instance'].includes(requestedStoreMode)) {
    throw new Error('PLATFORM_STORE_MODE 仅支持 memory 或 json-single-instance')
  }
  if (production && requestedStoreMode !== 'json-single-instance') {
    throw new Error('生产环境必须显式配置 PLATFORM_STORE_MODE=json-single-instance')
  }
  const storeMode = requestedStoreMode || 'memory'
  const jsonFile = optionalFile(env.PLATFORM_JSON_FILE || '')
  if (storeMode === 'json-single-instance' && !jsonFile) throw new Error('PLATFORM_STORE_MODE=json-single-instance 时必须配置 PLATFORM_JSON_FILE')
  if (storeMode !== 'json-single-instance' && jsonFile) throw new Error('PLATFORM_JSON_FILE 只能与 PLATFORM_STORE_MODE=json-single-instance 一起使用')
  assertDistinctPersistentJsonFiles(env)
  const corsOrigin = webOrigin('PLATFORM_CORS_ORIGIN', env.PLATFORM_CORS_ORIGIN || '*')
  const enableDevLogin = env.PLATFORM_ENABLE_DEV_LOGIN === 'true' || env.PLATFORM_ENABLE_DEV_LOGIN === '1'
  if (production && enableDevLogin) throw new Error('生产环境禁止启用 PLATFORM_ENABLE_DEV_LOGIN')
  if (production && corsOrigin === '*') throw new Error('生产环境 PLATFORM_CORS_ORIGIN 不能使用通配符')
  const wxAppId = requiredInProduction(env, 'WX_APPID', String(env.WX_APPID || '').trim())
  const wxSecret = requiredInProduction(env, 'WX_SECRET', String(env.WX_SECRET || '').trim())
  const gameEndpoint = endpoint(env, 'GAME_ENDPOINT', env.GAME_ENDPOINT || `ws://127.0.0.1:${env.WEAPP_WS_PORT || 3002}/weapp`, production ? ['wss:'] : ['ws:', 'wss:'])
  return {
    host: env.PLATFORM_HOST || '127.0.0.1',
    port: integerSetting(env, 'PLATFORM_PORT', 3003, { minimum: 1, maximum: 65535 }),
    corsOrigin,
    storeMode,
    jsonFile,
    enableDevLogin,
    wxAppId,
    wxSecret,
    wxTimeoutMs: integerSetting(env, 'WX_LOGIN_TIMEOUT_MS', 5000, { minimum: 100, maximum: 30_000 }),
    accessTokenTtlMs: integerSetting(env, 'PLATFORM_ACCESS_TOKEN_TTL_MS', 24 * 60 * 60 * 1000, { minimum: 5 * 60_000, maximum: 30 * 24 * 60 * 60 * 1000 }),
    gameTicketTtlMs: integerSetting(env, 'GAME_TICKET_TTL_MS', 90_000, { minimum: 10_000, maximum: 10 * 60_000 }),
    accessSecret,
    gameTicketSecret,
    gameResultSecret,
    spectatorEventSecret,
    gameEndpoint,
  }
}

export const loadGameSecurityConfig = (env = process.env) => {
  const gameTicketSecret = secret(env, 'GAME_TICKET_SECRET', 'game-ticket')
  const gameResultSecret = secret(env, 'GAME_RESULT_SECRET', 'game-result')
  const spectatorEventSecret = secret(env, 'GAME_SPECTATOR_EVENT_SECRET', 'spectator-event')
  if (env.NODE_ENV === 'production' && new Set([gameTicketSecret, gameResultSecret, spectatorEventSecret]).size !== 3) {
    throw new Error('生产环境的入桌票据、结算与观战必须使用三个不同密钥')
  }
  const production = env.NODE_ENV === 'production'
  const ticketRequired = env.GAME_TICKET_REQUIRED === '1' || env.GAME_TICKET_REQUIRED === 'true'
  if (production && !ticketRequired) throw new Error('生产环境必须启用 GAME_TICKET_REQUIRED')
  const resultEndpoint = requiredInProduction(env, 'GAME_RESULT_ENDPOINT', env.GAME_RESULT_ENDPOINT || '')
  const spectatorEventEndpoint = requiredInProduction(env, 'GAME_SPECTATOR_EVENT_ENDPOINT', env.GAME_SPECTATOR_EVENT_ENDPOINT || '')
  const resultOutboxFile = requiredInProduction(env, 'GAME_RESULT_OUTBOX_FILE', optionalFile(env.GAME_RESULT_OUTBOX_FILE || ''))
  const spectatorOutboxFile = requiredInProduction(env, 'GAME_SPECTATOR_OUTBOX_FILE', optionalFile(env.GAME_SPECTATOR_OUTBOX_FILE || ''))
  const roomStateFile = requiredInProduction(env, 'WEAPP_ROOM_STATE_FILE', optionalFile(env.WEAPP_ROOM_STATE_FILE || ''))
  const allowedOrigins = String(env.WEAPP_ALLOWED_ORIGINS || '').split(',').map(value => value.trim()).filter(Boolean).map(value => webOrigin('WEAPP_ALLOWED_ORIGINS', value))
  if (production && (allowedOrigins.length === 0 || allowedOrigins.includes('*'))) throw new Error('生产环境必须配置非通配的 WEAPP_ALLOWED_ORIGINS')
  assertDistinctPersistentJsonFiles(env)
  const friendSecondMs = integerSetting(env, 'WEAPP_FRIEND_SECOND_MS', 1000, { minimum: 1, maximum: 60_000 })
  const totalMinuteMs = integerSetting(env, 'WEAPP_TOTAL_MINUTE_MS', 60_000, { minimum: 100, maximum: 10 * 60_000 })
  if (production && (friendSecondMs !== 1000 || totalMinuteMs !== 60_000)) {
    throw new Error('生产环境禁止修改 WEAPP_FRIEND_SECOND_MS 或 WEAPP_TOTAL_MINUTE_MS 故障注入时钟')
  }
  return {
    host: String(env.WEAPP_HOST || '127.0.0.1').trim() || '127.0.0.1',
    ticketRequired,
    gameTicketSecret,
    gameResultSecret,
    spectatorEventSecret,
    resultEndpoint: endpoint(env, 'GAME_RESULT_ENDPOINT', resultEndpoint, production ? ['https:'] : ['http:', 'https:']),
    spectatorEventEndpoint: endpoint(env, 'GAME_SPECTATOR_EVENT_ENDPOINT', spectatorEventEndpoint, production ? ['https:'] : ['http:', 'https:']),
    resultOutboxFile,
    spectatorOutboxFile,
    roomStateFile,
    allowedOrigins,
    wsPort: integerSetting(env, 'WEAPP_WS_PORT', 3002, { minimum: 1, maximum: 65535 }),
    turnTimeoutMs: integerSetting(env, 'WEAPP_TURN_TIMEOUT_MS', 20_000, { minimum: 100, maximum: 60 * 60_000 }),
    friendSecondMs,
    totalMinuteMs,
    dissolveTimeoutMs: integerSetting(env, 'WEAPP_DISSOLVE_TIMEOUT_MS', 30_000, { minimum: 1000, maximum: 60 * 60_000 }),
    emptyRoomTimeoutMs: integerSetting(env, 'WEAPP_EMPTY_ROOM_TIMEOUT_MS', 60_000, { minimum: 100, maximum: 24 * 60 * 60_000 }),
    maxMessageBytes: integerSetting(env, 'WEAPP_MAX_MESSAGE_BYTES', 65_535, { minimum: 1024, maximum: 65_535 }),
    maxConnections: integerSetting(env, 'WEAPP_MAX_CONNECTIONS', 1000, { minimum: 4, maximum: 10_000 }),
    maxRooms: integerSetting(env, 'WEAPP_MAX_ROOMS', 500, { minimum: 1, maximum: 5000 }),
    commandRateWindowMs: integerSetting(env, 'WEAPP_COMMAND_RATE_WINDOW_MS', 10_000, { minimum: 1000, maximum: 10 * 60_000 }),
    commandRateLimit: integerSetting(env, 'WEAPP_COMMAND_RATE_LIMIT', 120, { minimum: 10, maximum: 10_000 }),
    maxPendingCommands: integerSetting(env, 'WEAPP_MAX_PENDING_COMMANDS', 32, { minimum: 1, maximum: 1024 }),
    persistDebounceMs: integerSetting(env, 'WEAPP_PERSIST_DEBOUNCE_MS', 25, { minimum: 5, maximum: 5000 }),
  }
}
