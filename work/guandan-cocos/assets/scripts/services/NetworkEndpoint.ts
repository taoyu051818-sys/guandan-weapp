/** Strict absolute business endpoint parser; deliberately not a browser URL polyfill.
 * Accepts ASCII DNS/IPv4 and bracketed hex IPv6, HTTP(S)/WS(S), and encoded paths.
 * Rejects credentials and ambiguous browser normalization. Never needs DOM/URL globals.
 */
export type NetworkEndpoint = Readonly<{
  protocol: string
  hostname: string
  port: string
  pathname: string
  search: string
  hash: string
}>

const validHostname = (hostname: string): boolean => {
  if (hostname.startsWith('[')) {
    const address = hostname.slice(1, -1)
    const halves = address.split('::')
    const groups = address.split(':').filter(Boolean)
    return hostname.endsWith(']') && halves.length <= 2 &&
      groups.every(group => /^[0-9a-f]{1,4}$/i.test(group)) &&
      (halves.length === 2
        ? groups.length < 8 && halves.every(half => !half || half.split(':').every(Boolean))
        : groups.length === 8 && address.split(':').every(Boolean))
  }
  if (/^[\d.]+$/.test(hostname)) {
    const parts = hostname.split('.')
    return parts.length === 4 && parts.every(part => /^(0|[1-9]\d{0,2})$/.test(part) && Number(part) <= 255)
  }
  return hostname.length <= 253 && hostname.split('.').every(label =>
    /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i.test(label))
}

export const parseNetworkEndpoint = (value: string): NetworkEndpoint => {
  const invalid = (): never => { throw new Error('Invalid absolute network endpoint') }
  // Do not silently strip whitespace, backslashes, malformed escapes or controls.
  if (typeof value !== 'string' || /[\s\\\u0000-\u001f\u007f]/.test(value) || /%(?![0-9a-f]{2})/i.test(value)) return invalid()
  const match = /^(https?|wss?):\/\/([^/?#]+)(\/[^?#]*)?(\?[^#]*)?(#.*)?$/i.exec(value)
  if (!match) return invalid()
  const authority = match[2]
  const host = /^(\[[0-9a-f:]+\]|[a-z0-9.-]+)(?::([0-9]{1,5}))?$/i.exec(authority)
  if (!host || !validHostname(host[1]) || (host[2] !== undefined && (Number(host[2]) < 1 || Number(host[2]) > 65535))) return invalid()
  return {
    protocol: `${match[1].toLowerCase()}:`, hostname: host[1].toLowerCase(),
    port: host[2] ?? '', pathname: match[3] || '/', search: match[4] ?? '', hash: match[5] ?? '',
  }
}
