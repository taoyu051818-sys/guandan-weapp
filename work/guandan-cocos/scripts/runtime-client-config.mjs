import { isIP } from 'node:net'

const START_MARKER = '/* guandan-runtime-config:start */'
const END_MARKER = '/* guandan-runtime-config:end */'
const GLOBAL_KEY = '__GUANDAN_RUNTIME_CONFIG__'

const parseBoolean = (value, name) => {
  if (value === undefined || value === '') return false
  if (value === 'true') return true
  if (value === 'false') return false
  throw new Error(`${name} must be exactly true or false`)
}

const parsePort = (value, name, fallback) => {
  const parsed = Number(value === undefined || value === '' ? fallback : value)
  if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > 65535) throw new Error(`${name} must be an integer from 1 to 65535`)
  return parsed
}

const requireBareIpv4 = value => {
  const ip = String(value ?? '').trim()
  if (isIP(ip) !== 4 || ip === '0.0.0.0') throw new Error('GUANDAN_TEST_SERVER_IP must be a connectable bare IPv4 address')
  return ip
}

export const bareIpTestRuntimeConfigFromEnv = env => {
  const ip = requireBareIpv4(env.GUANDAN_TEST_SERVER_IP)
  const platformPort = parsePort(env.GUANDAN_TEST_PLATFORM_PORT, 'GUANDAN_TEST_PLATFORM_PORT', 3003)
  const gamePort = parsePort(env.GUANDAN_TEST_GAME_PORT, 'GUANDAN_TEST_GAME_PORT', 3002)
  return {
    version: 1,
    lobbyEndpoint: `ws://${ip}:${gamePort}/weapp`,
    platformEndpoint: `http://${ip}:${platformPort}`,
    platformAllowDevelopmentLogin: true,
    platformAllowInsecureEndpoint: true,
    platformAllowInsecureGameEndpoint: true,
  }
}

export const verifyBareIpTestRuntimeConfig = config => {
  if (!config || config.version !== 1) throw new Error('Bare-IP test build is missing versioned runtime client config.')
  let platform
  let game
  try { platform = new URL(config.platformEndpoint); game = new URL(config.lobbyEndpoint) } catch { throw new Error('Bare-IP test endpoints are invalid.') }
  if (platform.protocol !== 'http:' || game.protocol !== 'ws:' || isIP(platform.hostname) !== 4 || platform.hostname !== game.hostname) {
    throw new Error('Bare-IP test endpoints must use the same IPv4 host over HTTP and WS.')
  }
  if (!config.platformAllowDevelopmentLogin || !config.platformAllowInsecureEndpoint || !config.platformAllowInsecureGameEndpoint) {
    throw new Error('Bare-IP test runtime config requires all three isolated development switches.')
  }
  return config
}

export const verifyReleaseRuntimeConfig = config => {
  if (!config || config.version !== 1) throw new Error('Release build is missing versioned runtime client config.')
  let endpoint
  try { endpoint = new URL(config.platformEndpoint) } catch { throw new Error('Release GUANDAN_PLATFORM_ENDPOINT is invalid.') }
  if (endpoint.protocol !== 'https:') throw new Error('Release platform endpoint must use HTTPS.')
  if (config.platformAllowDevelopmentLogin || config.platformAllowInsecureEndpoint || config.platformAllowInsecureGameEndpoint) {
    throw new Error('Release runtime config must keep all development switches disabled.（正式发布禁止开发开关）')
  }
  return config
}

/** Narrower than generic Web release config: this AppID has one approved business domain. */
export const verifyWechatRuntimeConfig = config => {
  verifyReleaseRuntimeConfig(config)
  for (const [field, protocol] of [['platformEndpoint', 'https:'], ['lobbyEndpoint', 'wss:']]) {
    const value = config[field]
    let endpoint
    try { endpoint = new URL(value) } catch { throw new Error(`WeChat ${field} is missing or invalid.`) }
    const prefix = `${protocol}//api.yutechhn.cn/guandan`
    if (typeof value !== 'string' || endpoint.protocol !== protocol || endpoint.hostname !== 'api.yutechhn.cn' ||
        endpoint.username || endpoint.password || endpoint.port || endpoint.hash ||
        !value.startsWith(prefix) || !['', '/', '?'].includes(value.slice(prefix.length, prefix.length + 1))) {
      throw new Error(`WeChat ${field} must use ${prefix}; local/IP/unapproved endpoints are forbidden.`)
    }
  }
  return config
}

export const runtimeConfigFromEnv = (env, { release = false, bareIpTest = false } = {}) => {
  if (release && bareIpTest) throw new Error('Bare-IP test config cannot be used for a release build.')
  if (bareIpTest) return verifyBareIpTestRuntimeConfig(bareIpTestRuntimeConfigFromEnv(env))
  const platformEndpoint = String(env.GUANDAN_PLATFORM_ENDPOINT ?? '').trim()
  if (!platformEndpoint) {
    if (release) throw new Error('Release build requires GUANDAN_PLATFORM_ENDPOINT.')
    return null
  }
  const config = {
    version: 1,
    lobbyEndpoint: String(env.GUANDAN_LOBBY_ENDPOINT ?? '').trim(),
    platformEndpoint,
    platformAllowDevelopmentLogin: parseBoolean(env.GUANDAN_PLATFORM_ALLOW_DEVELOPMENT_LOGIN, 'GUANDAN_PLATFORM_ALLOW_DEVELOPMENT_LOGIN'),
    platformAllowInsecureEndpoint: parseBoolean(env.GUANDAN_PLATFORM_ALLOW_INSECURE_ENDPOINT, 'GUANDAN_PLATFORM_ALLOW_INSECURE_ENDPOINT'),
    platformAllowInsecureGameEndpoint: parseBoolean(env.GUANDAN_PLATFORM_ALLOW_INSECURE_GAME_ENDPOINT, 'GUANDAN_PLATFORM_ALLOW_INSECURE_GAME_ENDPOINT'),
  }
  if (release) verifyReleaseRuntimeConfig(config)
  return config
}

const blockFor = config => `${START_MARKER}\nglobalThis.${GLOBAL_KEY} = Object.freeze(${JSON.stringify(config)});\n${END_MARKER}`
const markerPattern = /\/\* guandan-runtime-config:start \*\/[\s\S]*?\/\* guandan-runtime-config:end \*\//

const replaceOrInsert = (source, block, anchor, prefix = '') => markerPattern.test(source)
  ? source.replace(markerPattern, block)
  : source.replace(anchor, `${prefix}${block}\n${anchor}`)

export const injectWebRuntimeConfig = (source, config) => {
  const block = `<script>\n${blockFor(config)}\n</script>`
  const existingScript = /<script>\s*\/\* guandan-runtime-config:start \*\/[\s\S]*?\/\* guandan-runtime-config:end \*\/\s*<\/script>/
  if (existingScript.test(source)) return source.replace(existingScript, block)
  const anchor = '<!-- Polyfills bundle. -->'
  if (!source.includes(anchor)) throw new Error('Web build runtime-config injection anchor is missing.')
  return source.replace(anchor, `${block}\n    ${anchor}`)
}

export const injectScriptRuntimeConfig = (source, config) => {
  const block = blockFor(config)
  return markerPattern.test(source) ? source.replace(markerPattern, block) : `${block}\n${source}`
}

export const extractRuntimeConfig = source => {
  const block = source.match(markerPattern)?.[0]
  if (!block) return null
  const match = block.match(/Object\.freeze\((\{[^\n]+\})\)/)
  if (!match) throw new Error('Injected runtime client config is malformed.')
  return JSON.parse(match[1])
}
