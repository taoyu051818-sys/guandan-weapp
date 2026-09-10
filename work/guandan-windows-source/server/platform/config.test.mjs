import assert from 'node:assert/strict'
import { loadGameSecurityConfig, loadPlatformConfig } from './config.js'

const secrets = {
  PLATFORM_ACCESS_SECRET: 'production-access-secret-0000000000000001',
  GAME_TICKET_SECRET: 'production-ticket-secret-0000000000000001',
  GAME_RESULT_SECRET: 'production-result-secret-0000000000000001',
  GAME_SPECTATOR_EVENT_SECRET: 'production-spectator-secret-0000000000001',
}

const platformProduction = {
  NODE_ENV: 'production',
  ...secrets,
  PLATFORM_STORE_MODE: 'json-single-instance',
  PLATFORM_JSON_FILE: '/var/lib/guandan/platform.json',
  PLATFORM_CORS_ORIGIN: 'https://game.example.com',
  GAME_ENDPOINT: 'wss://game.example.com/weapp',
  WX_APPID: 'wx-production-app-id',
  WX_SECRET: 'wx-production-app-secret',
}

const gameProduction = {
  NODE_ENV: 'production',
  ...secrets,
  GAME_TICKET_REQUIRED: 'true',
  GAME_RESULT_ENDPOINT: 'https://platform.example.com/api/v1/game/results',
  GAME_SPECTATOR_EVENT_ENDPOINT: 'https://platform.example.com/api/v1/game/spectator-events',
  GAME_RESULT_OUTBOX_FILE: '/var/lib/guandan/result-outbox.json',
  GAME_SPECTATOR_OUTBOX_FILE: '/var/lib/guandan/spectator-outbox.json',
  WEAPP_ROOM_STATE_FILE: '/var/lib/guandan/rooms.json',
  WEAPP_ALLOWED_ORIGINS: 'https://game.example.com,https://servicewechat.com',
}
const allPersistentFilesProduction = { ...platformProduction, ...gameProduction }

const platformConfig = loadPlatformConfig(platformProduction)
assert.equal(platformConfig.gameEndpoint, 'wss://game.example.com/weapp')
assert.equal(platformConfig.storeMode, 'json-single-instance')
assert.equal(platformConfig.wxTimeoutMs, 5000)
const gameConfig = loadGameSecurityConfig(gameProduction)
assert.deepEqual(gameConfig.allowedOrigins, ['https://game.example.com', 'https://servicewechat.com'])
assert.equal(gameConfig.wsPort, 3002)
assert.equal(gameConfig.maxConnections, 1000)
assert.equal(gameConfig.maxPendingCommands, 32)

for (const name of ['PLATFORM_STORE_MODE', 'PLATFORM_JSON_FILE', 'PLATFORM_CORS_ORIGIN', 'GAME_ENDPOINT', 'WX_APPID', 'WX_SECRET']) {
  const env = { ...platformProduction }
  delete env[name]
  assert.throws(() => loadPlatformConfig(env), /生产环境|必须配置|通配符|协议/)
}
assert.throws(() => loadPlatformConfig({ ...platformProduction, PLATFORM_STORE_MODE: 'memory' }), /json-single-instance/)
assert.throws(() => loadPlatformConfig({ ...platformProduction, PLATFORM_STORE_MODE: 'postgres' }), /仅支持/)
assert.throws(() => loadPlatformConfig({ ...platformProduction, PLATFORM_JSON_FILE: '   ' }), /PLATFORM_JSON_FILE/)
assert.throws(() => loadPlatformConfig({ ...platformProduction, PLATFORM_ENABLE_DEV_LOGIN: 'true' }), /禁止启用/)
assert.throws(() => loadPlatformConfig({ ...platformProduction, PLATFORM_CORS_ORIGIN: '*' }), /通配符/)
assert.throws(() => loadPlatformConfig({ ...platformProduction, GAME_ENDPOINT: 'ws://game.example.com/weapp' }), /协议|WSS/)
assert.throws(() => loadPlatformConfig({ ...platformProduction, PLATFORM_PORT: '70000' }), /65535/)
assert.throws(() => loadPlatformConfig({ ...platformProduction, WX_LOGIN_TIMEOUT_MS: 'NaN' }), /WX_LOGIN_TIMEOUT_MS/)
assert.throws(() => loadPlatformConfig({ ...platformProduction, PLATFORM_ACCESS_TOKEN_TTL_MS: '299999' }), /PLATFORM_ACCESS_TOKEN_TTL_MS/)
assert.throws(() => loadPlatformConfig({ ...platformProduction, GAME_TICKET_TTL_MS: '600001' }), /GAME_TICKET_TTL_MS/)
assert.throws(() => loadPlatformConfig({ ...platformProduction, GAME_RESULT_SECRET: secrets.GAME_TICKET_SECRET }), /不同密钥/)

for (const name of ['GAME_RESULT_ENDPOINT', 'GAME_SPECTATOR_EVENT_ENDPOINT', 'GAME_RESULT_OUTBOX_FILE', 'GAME_SPECTATOR_OUTBOX_FILE', 'WEAPP_ROOM_STATE_FILE', 'WEAPP_ALLOWED_ORIGINS']) {
  const env = { ...gameProduction }
  delete env[name]
  assert.throws(() => loadGameSecurityConfig(env), /生产环境/)
}
assert.throws(() => loadGameSecurityConfig({ ...gameProduction, GAME_TICKET_REQUIRED: 'false' }), /GAME_TICKET_REQUIRED/)
assert.throws(() => loadGameSecurityConfig({ ...gameProduction, GAME_RESULT_ENDPOINT: 'http://platform.example.com/results' }), /协议/)
assert.throws(() => loadGameSecurityConfig({ ...gameProduction, WEAPP_ALLOWED_ORIGINS: '*' }), /非通配/)
assert.throws(() => loadGameSecurityConfig({ ...gameProduction, GAME_RESULT_OUTBOX_FILE: '   ' }), /GAME_RESULT_OUTBOX_FILE/)
assert.throws(() => loadGameSecurityConfig({ ...gameProduction, GAME_RESULT_OUTBOX_FILE: gameProduction.WEAPP_ROOM_STATE_FILE }), /不同文件/)
assert.throws(() => loadGameSecurityConfig({ ...gameProduction, GAME_SPECTATOR_EVENT_SECRET: secrets.GAME_RESULT_SECRET }), /不同密钥/)
const persistentFileNames = [
  'PLATFORM_JSON_FILE',
  'GAME_RESULT_OUTBOX_FILE',
  'GAME_SPECTATOR_OUTBOX_FILE',
  'WEAPP_ROOM_STATE_FILE',
]
for (let left = 0; left < persistentFileNames.length; left += 1) {
  for (let right = left + 1; right < persistentFileNames.length; right += 1) {
    const collision = {
      ...allPersistentFilesProduction,
      [persistentFileNames[right]]: allPersistentFilesProduction[persistentFileNames[left]],
    }
    assert.throws(() => loadPlatformConfig(collision), /持久 JSON|同一路径|不同文件/)
    assert.throws(() => loadGameSecurityConfig(collision), /持久 JSON|同一路径|不同文件/)
  }
}
const equivalentRelativeCollision = {
  ...allPersistentFilesProduction,
  PLATFORM_JSON_FILE: './var/state/../shared.json',
  WEAPP_ROOM_STATE_FILE: 'var/shared.json',
}
assert.throws(() => loadPlatformConfig(equivalentRelativeCollision), /解析为同一路径/)
assert.throws(() => loadGameSecurityConfig(equivalentRelativeCollision), /解析为同一路径/)
for (const [name, value] of [
  ['WEAPP_WS_PORT', '0'],
  ['WEAPP_TURN_TIMEOUT_MS', '99'],
  ['WEAPP_MAX_MESSAGE_BYTES', '65536'],
  ['WEAPP_MAX_CONNECTIONS', '3'],
  ['WEAPP_MAX_ROOMS', '0'],
  ['WEAPP_COMMAND_RATE_WINDOW_MS', '999'],
  ['WEAPP_COMMAND_RATE_LIMIT', '10.5'],
  ['WEAPP_MAX_PENDING_COMMANDS', '1025'],
  ['WEAPP_PERSIST_DEBOUNCE_MS', 'Infinity'],
]) {
  assert.throws(() => loadGameSecurityConfig({ ...gameProduction, [name]: value }), new RegExp(name))
}
assert.throws(() => loadGameSecurityConfig({ ...gameProduction, WEAPP_FRIEND_SECOND_MS: '5' }), /故障注入时钟/)

assert.equal(loadPlatformConfig({}).corsOrigin, '*', '开发环境仍允许显式本地联调默认值')
assert.equal(loadPlatformConfig({}).storeMode, 'memory')
assert.throws(() => loadPlatformConfig({ PLATFORM_JSON_FILE: './var/platform.json' }), /PLATFORM_STORE_MODE/)
assert.equal(loadPlatformConfig({ PLATFORM_STORE_MODE: 'json-single-instance', PLATFORM_JSON_FILE: './var/platform.json' }).storeMode, 'json-single-instance')
assert.equal(loadGameSecurityConfig({}).ticketRequired, false)

console.log('production configuration fail-fast tests passed')
