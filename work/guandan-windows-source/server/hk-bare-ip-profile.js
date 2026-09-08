import { isIP } from 'node:net'
import { loadGameSecurityConfig, loadPlatformConfig } from './platform/config.js'

const required = (env, name) => {
  const value = String(env[name] || '').trim()
  if (!value) throw new Error(`香港裸 IP 测试档必须配置 ${name}`)
  return value
}

const requirePublicTestIpv4 = value => {
  if (isIP(value) !== 4 || value === '0.0.0.0') throw new Error('GUANDAN_TEST_SERVER_IP 必须是可连接的裸 IPv4 地址')
  return value
}

const requireRestrictedOrigins = (platformOrigin, gameOrigins) => {
  if (platformOrigin === '*') throw new Error('香港裸 IP 测试档禁止通配 PLATFORM_CORS_ORIGIN')
  if (gameOrigins.length === 0 || gameOrigins.includes('*')) throw new Error('香港裸 IP 测试档必须限制 WEAPP_ALLOWED_ORIGINS')
}

const requireDistinctSecrets = env => {
  const names = ['PLATFORM_ACCESS_SECRET', 'GAME_TICKET_SECRET', 'GAME_RESULT_SECRET', 'GAME_SPECTATOR_EVENT_SECRET']
  const values = names.map(name => required(env, name))
  if (new Set(values).size !== values.length) throw new Error('香港裸 IP 测试档的四组签名密钥必须互不相同')
}

export const validateHongKongBareIpTestProfile = (env = process.env) => {
  if (env.NODE_ENV === 'production') throw new Error('香港裸 IP 仅用于 development 测试档，不能伪装成 production')
  const ip = requirePublicTestIpv4(required(env, 'GUANDAN_TEST_SERVER_IP'))
  const platformPort = Number(env.GUANDAN_TEST_PLATFORM_PORT || 3003)
  const gamePort = Number(env.GUANDAN_TEST_GAME_PORT || 3002)
  if (String(env.PLATFORM_HOST || '') !== '0.0.0.0') throw new Error('香港裸 IP 测试档必须设置 PLATFORM_HOST=0.0.0.0')
  if (String(env.WEAPP_HOST || '') !== '0.0.0.0') throw new Error('香港裸 IP 测试档必须设置 WEAPP_HOST=0.0.0.0')
  if (!['1', 'true'].includes(String(env.PLATFORM_ENABLE_DEV_LOGIN || ''))) throw new Error('香港裸 IP 测试档必须显式启用开发登录')
  if (!['1', 'true'].includes(String(env.GAME_TICKET_REQUIRED || ''))) throw new Error('香港裸 IP 测试档必须强制签名入桌票据')
  if (env.PLATFORM_STORE_MODE !== 'json-single-instance') throw new Error('香港裸 IP 测试档必须启用单实例 JSON 持久化')
  for (const name of ['PLATFORM_JSON_FILE', 'GAME_RESULT_OUTBOX_FILE', 'GAME_SPECTATOR_OUTBOX_FILE', 'WEAPP_ROOM_STATE_FILE']) required(env, name)
  requireDistinctSecrets(env)

  const platform = loadPlatformConfig(env)
  const game = loadGameSecurityConfig(env)
  requireRestrictedOrigins(platform.corsOrigin, game.allowedOrigins)
  const expectedGameEndpoint = `ws://${ip}:${gamePort}/weapp`
  if (platform.gameEndpoint !== expectedGameEndpoint) throw new Error(`GAME_ENDPOINT 必须等于 ${expectedGameEndpoint}`)
  if (platform.port !== platformPort || game.wsPort !== gamePort) throw new Error('裸 IP 测试端口与平台/牌局监听端口不一致')
  return {
    serverIp: ip,
    platformEndpoint: `http://${ip}:${platformPort}`,
    gameEndpoint: expectedGameEndpoint,
    platformOrigin: platform.corsOrigin,
    gameOrigins: game.allowedOrigins,
    persistence: {
      platform: platform.jsonFile,
      resultOutbox: game.resultOutboxFile,
      spectatorOutbox: game.spectatorOutboxFile,
      rooms: game.roomStateFile,
    },
  }
}
