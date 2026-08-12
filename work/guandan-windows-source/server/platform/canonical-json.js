/** Recursively orders object keys so semantic JSON payloads have stable identity. */
export const canonicalizeJson = value => {
  if (Array.isArray(value)) return value.map(canonicalizeJson)
  if (!value || typeof value !== 'object') return value
  return Object.fromEntries(
    Object.keys(value).sort().map(key => [key, canonicalizeJson(value[key])]),
  )
}

export const canonicalJsonFingerprint = value => JSON.stringify(canonicalizeJson(value))

/** Accepts pre-migration insertion-order fingerprints while all new writes use canonical JSON. */
export const matchesJsonFingerprint = (stored, value) => (
  stored === canonicalJsonFingerprint(value) || (() => {
    try { return canonicalJsonFingerprint(JSON.parse(stored)) === canonicalJsonFingerprint(value) } catch { return false }
  })()
)
