import { assertWechatBusinessEndpoint, isWechatRuntime, type WechatRuntimeHost } from './WechatNetworkPolicy'
import { parseNetworkEndpoint } from './NetworkEndpoint'

export const RUNTIME_CLIENT_CONFIG_KEY = '__GUANDAN_RUNTIME_CONFIG__' as const

export type SerializedClientNetworkConfig = Readonly<{
  lobbyEndpoint: string
  platformEndpoint: string
  platformAllowDevelopmentLogin: boolean
  platformAllowInsecureEndpoint: boolean
  platformAllowInsecureGameEndpoint: boolean
}>

export type ResolvedClientNetworkConfig = SerializedClientNetworkConfig & Readonly<{
  usingLocalBrowserDefaults: boolean
}>

type RuntimeConfigHost = WechatRuntimeHost & Readonly<{
  location?: Readonly<{ hostname?: string }>
  __GUANDAN_RUNTIME_CONFIG__?: unknown
}>

const requireBoolean = (value: unknown, field: string): boolean => {
  if (typeof value !== 'boolean') throw new Error(`运行时配置 ${field} 必须是布尔值`)
  return value
}

const requireEndpoint = (value: unknown, field: string): string => {
  if (typeof value !== 'string') throw new Error(`运行时配置 ${field} 必须是字符串`)
  return value.trim()
}

const assertEndpointPolicy = (config: SerializedClientNetworkConfig): void => {
  if (config.platformEndpoint) {
    let protocol = ''
    try { protocol = parseNetworkEndpoint(config.platformEndpoint).protocol } catch { throw new Error('运行时平台地址格式无效') }
    if (protocol !== 'https:' && !config.platformAllowInsecureEndpoint) throw new Error('正式运行时平台地址必须使用 HTTPS')
  }
  if (config.lobbyEndpoint) {
    let protocol = ''
    try { protocol = parseNetworkEndpoint(config.lobbyEndpoint).protocol } catch { throw new Error('运行时牌局地址格式无效') }
    if (protocol !== 'wss:' && !config.platformAllowInsecureGameEndpoint) throw new Error('正式运行时牌局地址必须使用 WSS')
  }
}

const injectedConfig = (host: RuntimeConfigHost): SerializedClientNetworkConfig | null => {
  const raw = host.__GUANDAN_RUNTIME_CONFIG__
  if (raw === undefined) return null
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('运行时配置必须是对象')
  const source = raw as Record<string, unknown>
  if (source.version !== 1) throw new Error('运行时配置版本不受支持')
  const config: SerializedClientNetworkConfig = {
    lobbyEndpoint: source.lobbyEndpoint === undefined ? '' : requireEndpoint(source.lobbyEndpoint, 'lobbyEndpoint'),
    platformEndpoint: requireEndpoint(source.platformEndpoint, 'platformEndpoint'),
    platformAllowDevelopmentLogin: requireBoolean(source.platformAllowDevelopmentLogin, 'platformAllowDevelopmentLogin'),
    platformAllowInsecureEndpoint: requireBoolean(source.platformAllowInsecureEndpoint, 'platformAllowInsecureEndpoint'),
    platformAllowInsecureGameEndpoint: requireBoolean(source.platformAllowInsecureGameEndpoint, 'platformAllowInsecureGameEndpoint'),
  }
  assertEndpointPolicy(config)
  return config
}

/** Resolves a versioned build injection before falling back to Inspector/local preview values. */
export const resolveClientNetworkConfig = (
  serialized: SerializedClientNetworkConfig,
  host: RuntimeConfigHost = globalThis as RuntimeConfigHost,
): ResolvedClientNetworkConfig => {
  const injected = injectedConfig(host)
  if (isWechatRuntime(host)) {
    if (!injected) throw new Error('微信包缺少正式网络配置，请重新构建；禁止回退本地测试服务')
    if (injected.platformAllowDevelopmentLogin || injected.platformAllowInsecureEndpoint || injected.platformAllowInsecureGameEndpoint) {
      throw new Error('微信包禁止开发登录及不安全连接开关')
    }
    assertWechatBusinessEndpoint(injected.platformEndpoint, 'https:')
    assertWechatBusinessEndpoint(injected.lobbyEndpoint, 'wss:')
    return { ...injected, usingLocalBrowserDefaults: false }
  }
  if (injected) return { ...injected, usingLocalBrowserDefaults: false }
  const hostname = host.location?.hostname?.trim().toLowerCase()
  const localhost = hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1' || hostname === '[::1]'
  const usingLocalBrowserDefaults = localhost && !serialized.platformEndpoint.trim() && !serialized.lobbyEndpoint.trim()
  const resolved: SerializedClientNetworkConfig = usingLocalBrowserDefaults
    ? {
        lobbyEndpoint: 'ws://127.0.0.1:3002/weapp', platformEndpoint: 'http://127.0.0.1:3003',
        platformAllowDevelopmentLogin: true, platformAllowInsecureEndpoint: true, platformAllowInsecureGameEndpoint: true,
      }
    : {
        ...serialized,
        lobbyEndpoint: serialized.lobbyEndpoint.trim(),
        platformEndpoint: serialized.platformEndpoint.trim(),
      }
  assertEndpointPolicy(resolved)
  return { ...resolved, usingLocalBrowserDefaults }
}
