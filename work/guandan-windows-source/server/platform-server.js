import { createServer } from 'node:http'
import { fileURLToPath } from 'node:url'
import { AccessTokenService, GameTicketService } from './platform/crypto.js'
import { loadPlatformConfig } from './platform/config.js'
import { createPlatformHttpHandler } from './platform/http.js'
import { PlatformService } from './platform/service.js'
import { createSeededPlatformState } from './platform/seeds.js'
import { JsonFilePlatformStore, MemoryPlatformStore } from './platform/storage.js'
import { WxCodeVerifier } from './platform/wx-auth.js'

export const createPlatformRuntime = async ({ env = process.env, store, logger = console, wxCodeVerifier } = {}) => {
  const config = loadPlatformConfig(env)
  const platformStore = store || (config.jsonFile
    ? await JsonFilePlatformStore.open(config.jsonFile, createSeededPlatformState())
    : new MemoryPlatformStore(createSeededPlatformState()))
  const service = new PlatformService({
    store: platformStore,
    accessTokens: new AccessTokenService({ secret: config.accessSecret }),
    gameTickets: new GameTicketService({ secret: config.gameTicketSecret, gameEndpoint: config.gameEndpoint }),
  })
  const verifier = wxCodeVerifier || new WxCodeVerifier({ appId: config.wxAppId, secret: config.wxSecret, timeoutMs: config.wxTimeoutMs })
  const handler = createPlatformHttpHandler({
    service,
    gameResultSecret: config.gameResultSecret,
    spectatorEventSecret: config.spectatorEventSecret,
    wxCodeVerifier: verifier,
    enableDevLogin: config.enableDevLogin,
    corsOrigin: config.corsOrigin,
    logger,
  })
  return { config, store: platformStore, service, server: createServer(handler) }
}

const startedAsScript = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]
if (startedAsScript) {
  const runtime = await createPlatformRuntime()
  runtime.server.listen(runtime.config.port, runtime.config.host, () => {
    console.log(`Guandan platform API running at http://${runtime.config.host}:${runtime.config.port}/api/v1`)
    if (!runtime.config.jsonFile) console.log('Platform storage: in-memory (development/test only)')
  })
}
