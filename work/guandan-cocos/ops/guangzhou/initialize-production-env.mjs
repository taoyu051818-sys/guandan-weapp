import { randomBytes } from 'node:crypto'
import { existsSync, writeFileSync } from 'node:fs'

const target = '/srv/guandan/shared/production.env'
if (existsSync(target)) {
  console.log('Existing production environment retained; signing keys were not rotated.')
} else {
  const config = {
    NODE_ENV: 'production',
    PLATFORM_HOST: '127.0.0.1',
    PLATFORM_PORT: '33103',
    PLATFORM_ENABLE_DEV_LOGIN: 'false',
    PLATFORM_CORS_ORIGIN: 'https://api.yutechhn.cn',
    PLATFORM_STORE_MODE: 'json-single-instance',
    PLATFORM_JSON_FILE: '/srv/guandan/shared/data/platform.json',
    PLATFORM_ACCESS_SECRET: randomBytes(32).toString('hex'),
    GAME_TICKET_SECRET: randomBytes(32).toString('hex'),
    GAME_RESULT_SECRET: randomBytes(32).toString('hex'),
    GAME_SPECTATOR_EVENT_SECRET: randomBytes(32).toString('hex'),
    GAME_ENDPOINT: 'wss://api.yutechhn.cn/guandan/weapp',
    GAME_TICKET_REQUIRED: 'true',
    GAME_RESULT_ENDPOINT: 'https://api.yutechhn.cn/guandan/api/v1/game/results',
    GAME_SPECTATOR_EVENT_ENDPOINT: 'https://api.yutechhn.cn/guandan/api/v1/game/spectator-events',
    GAME_RESULT_OUTBOX_FILE: '/srv/guandan/shared/data/result-outbox.json',
    GAME_SPECTATOR_OUTBOX_FILE: '/srv/guandan/shared/data/spectator-outbox.json',
    WEAPP_ROOM_STATE_FILE: '/srv/guandan/shared/data/rooms.json',
    WEAPP_HOST: '127.0.0.1',
    WEAPP_WS_PORT: '33102',
    WEAPP_ALLOWED_ORIGINS: 'https://api.yutechhn.cn,https://servicewechat.com',
    WEAPP_TURN_TIMEOUT_MS: '20000',
  }
  writeFileSync(target, Object.entries(config).map(([key, value]) => `${key}=${value}`).join('\n') + '\n', { mode: 0o600, flag: 'wx' })
  console.log('Production environment created with four independent signing keys.')
}
