import assert from 'node:assert/strict'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

export const adminReleaseFiles = Object.freeze([
  'index.html', 'styles.css',
  ...['app', 'api', 'model', 'dom', 'dialog', 'login', 'announcements', 'feedback', 'features', 'audit'].map(name => `src/${name}.js`),
].map(path => `work/guandan-admin/${path}`))
const adminFiles = new Set(adminReleaseFiles)

export function allowedReleasePath (path, withWeb = false) {
  if (typeof path !== 'string' || !path || /[\\\u0000-\u0020\u007f]/.test(path) || path.startsWith('/')) return false
  const clean = path.endsWith('/') ? path.slice(0, -1) : path
  const segments = clean.split('/')
  if (segments.some(part => !part || part.startsWith('.'))) return false
  const name = segments.at(-1)
  if (/\.env(?:\.|$)|(?:admins?|credentials?|enrollment|secrets?)[^/]*\.json$/i.test(name)) return false
  return adminFiles.has(path) ||
    /^(?:shared-core\/dist(?:\/|$)|shared-core\/package\.json$|work\/guandan-windows-source\/server(?:\/|$)|work\/guandan-windows-source\/package\.json$)/.test(clean) ||
    (withWeb && /^web(?:\/|$)/.test(clean))
}

export function validateReleasePaths (listing, withWeb = false) {
  const paths = listing.trimEnd().split('\n')
  const unique = new Set()
  for (const path of paths) {
    assert.ok(allowedReleasePath(path, withWeb), `Unexpected archive path: ${path}`)
    assert.ok(!unique.has(path), `Duplicate archive path: ${path}`)
    unique.add(path)
  }
  for (const path of adminReleaseFiles) assert.ok(unique.has(path), `Missing required admin asset: ${path}`)
  return paths
}

export function validateReleaseTypes (listing) {
  const lines = listing.trimEnd().split('\n')
  assert.ok(lines.length && lines.every(line => /^[d-][rwxstST-]{9}\s/.test(line)), 'Archives may contain only regular files and directories; links and special files are forbidden')
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [mode, withWeb] = process.argv.slice(2)
  if (mode === 'admin-files') process.stdout.write(`${adminReleaseFiles.join('\n')}\n`)
  else {
    assert.ok(['check', 'types'].includes(mode), 'Usage: release-paths.mjs admin-files | check [true] | types')
    let listing = ''
    for await (const chunk of process.stdin) {
      listing += chunk
      assert.ok(listing.length <= 4 * 1024 * 1024, 'Archive listing is too large')
    }
    if (mode === 'check') validateReleasePaths(listing, withWeb === 'true')
    else validateReleaseTypes(listing)
  }
}
