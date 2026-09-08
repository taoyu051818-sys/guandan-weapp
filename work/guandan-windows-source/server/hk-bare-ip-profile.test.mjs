import assert from 'node:assert/strict'
import { validateHongKongBareIpTestProfile } from './hk-bare-ip-profile.js'

const base = {
  NODE_ENV: 'development',
  GUANDAN_TEST_SERVER_IP: '203.0.113.42',
  GUANDAN_TEST_PLATFORM_PORT: '3003',
  GUANDAN_TEST_GAME_PORT: '3002',
  PLATFORM_HOST: '0.0.0.0',
  WEAPP_HOST: '0.0.0.0',
  PLATFORM_PORT: '3003',
  PLATFORM_ENABLE_DEV_LOGIN: 'true',
  PLATFORM_CORS_ORIGIN: 'http://127.0.0.1:4178',
  PLATFORM_STORE_MODE: 'json-single-instance',
  PLATFORM_JSON_FILE: '/srv/guandan-test/data/platform.json',
  PLATFORM_ACCESS_SECRET: 'test-access-secret-0000000000000001',
  GAME_ENDPOINT: 'ws://203.0.113.42:3002/weapp',
  GAME_TICKET_REQUIRED: 'true',
  GAME_TICKET_SECRET: 'test-ticket-secret-0000000000000002',
  GAME_RESULT_SECRET: 'test-result-secret-0000000000000003',
  GAME_SPECTATOR_EVENT_SECRET: 'test-spectator-secret-0000000000004',
  GAME_RESULT_ENDPOINT: 'http://127.0.0.1:3003/api/v1/game/results',
  GAME_SPECTATOR_EVENT_ENDPOINT: 'http://127.0.0.1:3003/api/v1/game/spectator-events',
  GAME_RESULT_OUTBOX_FILE: '/srv/guandan-test/data/result-outbox.json',
  GAME_SPECTATOR_OUTBOX_FILE: '/srv/guandan-test/data/spectator-outbox.json',
  WEAPP_ROOM_STATE_FILE: '/srv/guandan-test/data/rooms.json',
  WEAPP_ALLOWED_ORIGINS: 'http://127.0.0.1:4178',
  WEAPP_WS_PORT: '3002',
}

const validated = validateHongKongBareIpTestProfile(base)
assert.equal(validated.platformEndpoint, 'http://203.0.113.42:3003')
assert.equal(validated.gameEndpoint, 'ws://203.0.113.42:3002/weapp')
assert.equal(validated.platformOrigin, 'http://127.0.0.1:4178')
assert.throws(() => validateHongKongBareIpTestProfile({ ...base, GUANDAN_TEST_SERVER_IP: 'hk.example' }), /IPv4/)
assert.throws(() => validateHongKongBareIpTestProfile({ ...base, NODE_ENV: 'production' }), /development/)
assert.throws(() => validateHongKongBareIpTestProfile({ ...base, PLATFORM_CORS_ORIGIN: '*' }), /通配/)
assert.throws(() => validateHongKongBareIpTestProfile({ ...base, GAME_RESULT_SECRET: base.GAME_TICKET_SECRET }), /互不相同/)
assert.throws(() => validateHongKongBareIpTestProfile({ ...base, WEAPP_ROOM_STATE_FILE: '' }), /WEAPP_ROOM_STATE_FILE/)

console.log('Hong Kong bare-IP profile tests passed')
