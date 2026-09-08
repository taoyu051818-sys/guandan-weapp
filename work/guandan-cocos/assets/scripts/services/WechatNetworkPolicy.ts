import { parseNetworkEndpoint, type NetworkEndpoint } from './NetworkEndpoint'

/** Business traffic only. Engine-local files and WeChat's own APIs are not remote business endpoints. */
export const WECHAT_BUSINESS_HOST = 'api.yutechhn.cn'

export type WechatRuntimeHost = Readonly<{
  __GUANDAN_BUILD_TARGET__?: unknown
  wx?: Readonly<{ request?: unknown, connectSocket?: unknown }>
}>

export const isWechatRuntime = (host: WechatRuntimeHost = globalThis as WechatRuntimeHost): boolean =>
  host.__GUANDAN_BUILD_TARGET__ === 'wechatgame' ||
  typeof host.wx?.request === 'function' || typeof host.wx?.connectSocket === 'function'

export const assertWechatBusinessEndpoint = (value: string, protocol: 'https:' | 'wss:'): void => {
  let endpoint: NetworkEndpoint
  try { endpoint = parseNetworkEndpoint(value) } catch { throw new Error('微信业务服务地址格式无效') }
  const prefix = `${protocol}//${WECHAT_BUSINESS_HOST}/guandan`
  const boundary = value.slice(prefix.length, prefix.length + 1)
  if (endpoint.protocol !== protocol || endpoint.hostname !== WECHAT_BUSINESS_HOST ||
      endpoint.port || endpoint.hash ||
      /%(?:2e|2f|5c|25|0[0-9a-f]|1[0-9a-f]|7f)/i.test(endpoint.pathname) ||
      endpoint.pathname.split('/').some(segment => segment === '.' || segment === '..') ||
      !value.startsWith(prefix) || !['', '/', '?'].includes(boundary)) {
    throw new Error(`微信业务连接只允许 ${protocol}//${WECHAT_BUSINESS_HOST}/guandan 下的合法地址`)
  }
}

export const assertWechatTransportEndpoint = (value: string, protocol: 'https:' | 'wss:'): void => {
  if (isWechatRuntime()) assertWechatBusinessEndpoint(value, protocol)
}
