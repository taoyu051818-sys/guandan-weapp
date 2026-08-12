const START_MARKER = '/* guandan-runtime-config:start */'
const END_MARKER = '/* guandan-runtime-config:end */'
const GLOBAL_KEY = '__GUANDAN_RUNTIME_CONFIG__'

const parseBoolean = (value, name) => {
  if (value === undefined || value === '') return false
  if (value === 'true') return true
  if (value === 'false') return false
  throw new Error(`${name} must be exactly true or false`)
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

export const runtimeConfigFromEnv = (env, { release = false } = {}) => {
  const platformEndpoint = String(env.GUANDAN_PLATFORM_ENDPOINT ?? '').trim()
  if (!platformEndpoint) {
    if (release) throw new Error('Release build requires GUANDAN_PLATFORM_ENDPOINT.')
    return null
  }
  const config = {
    version: 1,
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
