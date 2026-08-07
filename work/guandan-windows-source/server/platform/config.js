const developmentSecret = (purpose) => `development-only-${purpose}-secret-change-before-deploying-2026`

const secret = (env, name, purpose) => {
  const value = env[name] || developmentSecret(purpose)
  if (env.NODE_ENV === 'production' && value === developmentSecret(purpose)) {
    throw new Error(`生产环境必须配置 ${name}`)
  }
  if (value.length < 32) throw new Error(`${name} 至少需要32个字符`)
  return value
}

export const loadPlatformConfig = (env = process.env) => {
  const gameResultSecret = secret(env, 'GAME_RESULT_SECRET', 'game-result')
  const spectatorEventSecret = secret(env, 'GAME_SPECTATOR_EVENT_SECRET', 'spectator-event')
  if (env.NODE_ENV === 'production' && gameResultSecret === spectatorEventSecret) {
    throw new Error('GAME_RESULT_SECRET 与 GAME_SPECTATOR_EVENT_SECRET 必须使用不同密钥')
  }
  return {
    host: env.PLATFORM_HOST || '127.0.0.1',
    port: Number(env.PLATFORM_PORT || 3003),
    corsOrigin: env.PLATFORM_CORS_ORIGIN || '*',
    jsonFile: env.PLATFORM_JSON_FILE || '',
    enableDevLogin: env.PLATFORM_ENABLE_DEV_LOGIN === 'true' || env.PLATFORM_ENABLE_DEV_LOGIN === '1',
    wxAppId: env.WX_APPID || '',
    wxSecret: env.WX_SECRET || '',
    wxTimeoutMs: Number(env.WX_LOGIN_TIMEOUT_MS || 5000),
    accessSecret: secret(env, 'PLATFORM_ACCESS_SECRET', 'access'),
    gameTicketSecret: secret(env, 'GAME_TICKET_SECRET', 'game-ticket'),
    gameResultSecret,
    spectatorEventSecret,
    gameEndpoint: env.GAME_ENDPOINT || `ws://127.0.0.1:${env.WEAPP_WS_PORT || 3002}/weapp`,
  }
}

export const loadGameSecurityConfig = (env = process.env) => {
  const gameResultSecret = secret(env, 'GAME_RESULT_SECRET', 'game-result')
  const spectatorEventSecret = secret(env, 'GAME_SPECTATOR_EVENT_SECRET', 'spectator-event')
  if (env.NODE_ENV === 'production' && gameResultSecret === spectatorEventSecret) {
    throw new Error('GAME_RESULT_SECRET 与 GAME_SPECTATOR_EVENT_SECRET 必须使用不同密钥')
  }
  return {
    ticketRequired: env.GAME_TICKET_REQUIRED === '1' || env.GAME_TICKET_REQUIRED === 'true',
    gameTicketSecret: secret(env, 'GAME_TICKET_SECRET', 'game-ticket'),
    gameResultSecret,
    spectatorEventSecret,
    resultEndpoint: env.GAME_RESULT_ENDPOINT || '',
    spectatorEventEndpoint: env.GAME_SPECTATOR_EVENT_ENDPOINT || '',
    spectatorOutboxFile: env.GAME_SPECTATOR_OUTBOX_FILE || '',
  }
}
