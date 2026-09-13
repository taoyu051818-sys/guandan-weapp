// Audit-only dependency inventory. Reads metadata, never imports package code or writes files.
// --online sends ONLY the fixed public name/version allowlist below to registry.npmjs.org.
// No npm/pnpm, registry configuration, credentials, redirects, tarballs, retries, or caches.
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, existsSync, realpathSync, statSync } from 'node:fs'
import { resolve, dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import https from 'node:https'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..')
const read = p => readFileSync(resolve(root, p), 'utf8')
const hash = body => createHash('sha256').update(body).digest('hex')
const json = p => JSON.parse(read(p))
const dirs = ['shared-core', 'work/guandan-cocos', 'work/guandan-windows-source']
const publicKeys = new Set(`@jridgewell/sourcemap-codec@1.5.5
@oxc-project/types@0.143.0
@rolldown/binding-android-arm64@1.2.3
@rolldown/binding-darwin-arm64@1.2.3
@rolldown/binding-darwin-x64@1.2.3
@rolldown/binding-freebsd-x64@1.2.3
@rolldown/binding-linux-arm-gnueabihf@1.2.3
@rolldown/binding-linux-arm64-gnu@1.2.3
@rolldown/binding-linux-arm64-musl@1.2.3
@rolldown/binding-linux-ppc64-gnu@1.2.3
@rolldown/binding-linux-s390x-gnu@1.2.3
@rolldown/binding-linux-x64-gnu@1.2.3
@rolldown/binding-linux-x64-musl@1.2.3
@rolldown/binding-openharmony-arm64@1.2.3
@rolldown/binding-win32-arm64-msvc@1.2.3
@rolldown/binding-win32-x64-msvc@1.2.3
@rolldown/pluginutils@1.0.1
@standard-schema/spec@1.1.0
@types/chai@5.2.3
@types/deep-eql@4.0.2
@types/estree@1.0.9
@vitest/expect@4.1.10
@vitest/mocker@4.1.10
@vitest/pretty-format@4.1.10
@vitest/runner@4.1.10
@vitest/snapshot@4.1.10
@vitest/spy@4.1.10
@vitest/utils@4.1.10
assertion-error@2.0.1
chai@6.2.2
convert-source-map@2.0.0
detect-libc@2.1.2
es-module-lexer@2.3.1
estree-walker@3.0.3
expect-type@1.4.0
fdir@6.5.0
fsevents@2.3.3
lightningcss-android-arm64@1.33.0
lightningcss-darwin-arm64@1.33.0
lightningcss-darwin-x64@1.33.0
lightningcss-freebsd-x64@1.33.0
lightningcss-linux-arm-gnueabihf@1.33.0
lightningcss-linux-arm64-gnu@1.33.0
lightningcss-linux-arm64-musl@1.33.0
lightningcss-linux-x64-gnu@1.33.0
lightningcss-linux-x64-musl@1.33.0
lightningcss-win32-arm64-msvc@1.33.0
lightningcss-win32-x64-msvc@1.33.0
lightningcss@1.33.0
magic-string@0.30.21
nanoid@3.3.18
obug@2.1.4
pathe@2.0.3
picocolors@1.1.1
picomatch@4.0.5
postcss@8.5.26
rolldown@1.2.3
siginfo@2.0.0
source-map-js@1.2.1
stackback@0.0.2
std-env@4.2.0
tinybench@2.9.0
tinyexec@1.3.0
tinyglobby@0.2.17
tinyrainbow@3.1.1
typescript@4.9.5
vite@8.2.1
vitest@4.1.10
why-is-node-running@2.3.0`.split('\n'))

const cleanEnv = { PATH: '/usr/bin:/bin' }
const head = execFileSync('/usr/bin/git', ['rev-parse', 'HEAD'], { cwd: root, env: cleanEnv, encoding: 'utf8' }).trim()
assert.equal(head, '1d58999dc6e5455b049e1643660bbba3deee1406')
const packages = new Map(), locks = []
for (const dir of dirs) {
  const lockPath = dir + '/pnpm-lock.yaml', body = read(lockPath)
  const lock = JSON.parse(execFileSync('/usr/bin/ruby', ['-ryaml', '-rjson', '-e', 'puts JSON.generate(YAML.load_file(ARGV[0]))', resolve(root, lockPath)], { env: cleanEnv, encoding: 'utf8', timeout: 10000 }))
  const manifest = json(dir + '/package.json')
  assert.equal(Object.keys(manifest.dependencies || {}).length, 0)
  const installedLockPath = dir + '/node_modules/.pnpm/lock.yaml'
  locks.push({ path: lockPath, sha256: hash(body), packageCount: Object.keys(lock.packages || {}).length, productionDependencies: Object.keys(manifest.dependencies || {}), devDependencies: manifest.devDependencies || {}, installedLockEqualsSource: existsSync(resolve(root, installedLockPath)) ? read(installedLockPath) === body : null })
  for (const [key, value] of Object.entries(lock.packages || {})) {
    assert.ok(publicKeys.has(key), 'Only fixed public package keys can be transmitted')
    const at = key.lastIndexOf('@'), name = key.slice(0, at), version = key.slice(at + 1)
    assert.match(name, /^(?:@[a-z0-9._-]+\/)?[a-z0-9._-]+$/)
    assert.match(version, /^\d+\.\d+\.\d+$/)
    assert.match(value.resolution.integrity, /^sha512-[A-Za-z0-9+/]{86}==$/)
    let entry = packages.get(key)
    if (!entry) {
      entry = { name, version, scope: 'dev-test-build', directDevIn: [], optionalDependencyOf: [], lockIntegrity: value.resolution.integrity, lockPaths: [], engines: value.engines || null, os: value.os || null, cpu: value.cpu || null, libc: value.libc || null, localMetadata: [] }
      packages.set(key, entry)
    }
    assert.equal(entry.lockIntegrity, value.resolution.integrity)
    entry.lockPaths.push(lockPath)
    if (Object.hasOwn(manifest.devDependencies || {}, name)) entry.directDevIn.push(dir)
  }
  for (const [parent, snapshot] of Object.entries(lock.snapshots || {})) {
    for (const [name, version] of Object.entries(snapshot.optionalDependencies || {})) {
      const p = packages.get(name + '@' + String(version).split('(')[0])
      assert.ok(p)
      if (!p.optionalDependencyOf.includes(parent)) p.optionalDependencyOf.push(parent)
    }
  }
}
assert.equal(packages.size, 69)
const unexpectedInstalled = []
for (const dir of dirs.slice(0, 2)) {
  const store = resolve(root, dir, 'node_modules/.pnpm')
  for (const folder of readdirSync(store, { withFileTypes: true }).filter(e => e.isDirectory() && e.name !== 'node_modules')) {
    const nm = join(store, folder.name, 'node_modules')
    if (!existsSync(nm)) continue
    for (const child of readdirSync(nm, { withFileTypes: true })) {
      const paths = child.name.startsWith('@') && child.isDirectory()
        ? readdirSync(join(nm, child.name)).map(n => join(nm, child.name, n, 'package.json'))
        : [join(nm, child.name, 'package.json')]
      for (const path of paths) {
        if (!existsSync(path)) continue
        const actual = realpathSync(path)
        // A package store contains symlinked dependencies. Inventory only its own package.
        if (!actual.startsWith(join(store, folder.name) + '/')) continue
        const body = readFileSync(actual, 'utf8'), p = JSON.parse(body), key = p.name + '@' + p.version
        const target = packages.get(key)
        if (!target) { unexpectedInstalled.push({ name: p.name, version: p.version, path: relative(root, actual) }); continue }
        const licenseFiles = readdirSync(dirname(actual)).filter(n => /^(?:(licen[cs]e|copying|notice)(\.|$)|thirdpartynotice)/i.test(n) && statSync(join(dirname(actual), n)).isFile()).map(n => ({ path: relative(root, join(dirname(actual), n)), sha256: hash(readFileSync(join(dirname(actual), n))) }))
        target.localMetadata.push({ path: relative(root, actual), sha256: hash(body), nameVersionMatchesLock: true, license: p.license ?? p.licenses ?? null, engines: p.engines || null, licenseFiles, installScripts: Object.fromEntries(Object.entries(p.scripts || {}).filter(([k]) => ['preinstall', 'install', 'postinstall'].includes(k))) })
      }
    }
  }
}

// Scan production JS files and emitted shared core WITHOUT loading/evaluating any module.
const scanned = [], bareImports = new Set(), builtins = new Set(), dynamicImports = []
function scan(dir, emitted = false) {
  for (const e of readdirSync(resolve(root, dir), { withFileTypes: true })) {
    const p = dir + '/' + e.name
    if (e.isDirectory()) { scan(p, emitted); continue }
    if (!(emitted ? /\.js$/ : /\.js$/).test(e.name)) continue
    const body = read(p); scanned.push(p)
    for (const m of body.matchAll(/(?:\bfrom\s*|\brequire\s*\(\s*|\bimport\s*\(\s*)['"]([^'"]+)['"]/g)) {
      const specifier = m[1]
      if (specifier.startsWith('node:')) builtins.add(specifier)
      else if (!specifier.startsWith('.')) bareImports.add(specifier)
    }
    for (const m of body.matchAll(/\bimport\s*\(\s*([^'"\s][^)]*)\)/g)) dynamicImports.push({ path: p, expression: m[1].trim() })
  }
}
scan('work/guandan-windows-source/server')
scan('shared-core/dist', true)
const configuredNodes = ['guandan-game.service', 'guandan-platform.service'].map(name => {
  const body = read('work/guandan-cocos/ops/guangzhou/' + name)
  const m = /^ExecStart=\/opt\/node-v([\d.]+)\/bin\/node /m.exec(body)
  assert.ok(m, 'Expected unit Node path')
  return m[1]
})
assert.equal(configuredNodes[0], configuredNodes[1])
const result = { batch: 'dependency-boundaries-40', head, observedAt: new Date().toISOString(), reviewed: [], findings: [], concerns: [], locks, packages: [...packages.values()], unexpectedInstalled, runtime: { localNode: process.version, serverDeclaredNode: json(dirs[2] + '/package.json').engines.node, serviceConfiguredNode: configuredNodes[0], creatorDeclaredVersion: json(dirs[1] + '/package.json').creator.version, scan: { kind: 'read-only literal specifier scan; not execution or complete module graph proof', files: scanned.length, builtins: [...builtins].sort(), bareImports: [...bareImports], dynamicImports } }, advisory: { queried: false } }
assert.ok(result.packages.filter(p => !p.localMetadata.length).every(p => p.os && p.cpu && p.optionalDependencyOf.length), 'Every locally absent lock entry is platform-gated and optional')

let quotaUnavailable = false
function requestRegistry(path, payload) {
  assert.ok(path.startsWith('/') && !path.startsWith('//'))
  if (quotaUnavailable) return Promise.resolve({ status: 'skipped-after-quota', body: null })
  return new Promise(resolveRequest => {
    const data = payload === undefined ? null : JSON.stringify(payload)
    let settled = false
    const finish = value => { if (!settled) { settled = true; clearTimeout(deadline); resolveRequest(value) } }
    const req = https.request({ hostname: 'registry.npmjs.org', port: 443, path, method: data ? 'POST' : 'GET', headers: { Accept: 'application/json', ...(data ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } : {}) }, timeout: 15000, agent: false }, response => {
      const chunks = []; let length = 0
      response.on('data', c => { length += c.length; if (length > 5000000) { req.destroy(new Error('metadata-response-too-large')); return } chunks.push(c) })
      response.on('end', () => {
        const body = Buffer.concat(chunks).toString('utf8')
        if ([401, 403, 429].includes(response.statusCode)) quotaUnavailable = true
        let parsed = null; try { parsed = JSON.parse(body) } catch {}
        finish({ status: response.statusCode, responseDate: response.headers.date || null, responseSha256: hash(body), body: parsed })
      })
    })
    req.on('timeout', () => req.destroy(new Error('timeout')))
    const deadline = setTimeout(() => req.destroy(new Error('absolute-deadline-20000ms')), 20000)
    req.on('error', e => finish({ status: 'network-error', message: e.message, body: null }))
    req.end(data)
  })
}
if (process.argv.includes('--online')) {
  const payload = Object.fromEntries([...packages.values()].map(p => [p.name, [p.version]]))
  assert.equal(Object.keys(payload).length, 69)
  const endpoint = '/-/npm/v1/security/advisories/bulk'
  const response = await requestRegistry(endpoint, payload)
  result.advisory = { queried: true, endpoint: 'https://registry.npmjs.org' + endpoint, packageNameVersionPairsSent: 69, payloadSha256: hash(JSON.stringify(payload)), credentialsUsed: false, privateDataSent: false, retries: 0, ...response }
  // Sequential, bounded metadata-only requests, to stop immediately if quota is unavailable.
  for (const p of result.packages) {
    if (response.status !== 200) { p.registry = { status: 'skipped-after-advisory-failure' }; continue }
    if (quotaUnavailable) { p.registry = { status: 'skipped-after-quota' }; continue }
    const path = '/' + encodeURIComponent(p.name) + '/' + encodeURIComponent(p.version)
    const metadata = await requestRegistry(path)
    const body = metadata.body
    p.registry = { url: 'https://registry.npmjs.org' + path, status: metadata.status, responseDate: metadata.responseDate || null, responseSha256: metadata.responseSha256 || null, nameVersionMatchesLock: body?.name === p.name && body?.version === p.version, license: body?.license ?? null, integrity: body?.dist?.integrity ?? null, integrityMatchesLock: body?.dist?.integrity === p.lockIntegrity, deprecated: body?.deprecated || null, engines: body?.engines || null }
  }
}
result.summary = { uniqueLockedNameVersions: packages.size, lockOccurrences: result.locks.reduce((n, l) => n + l.packageCount, 0), localMetadataUniquePackages: result.packages.filter(p => p.localMetadata.length).length, localMetadataCopies: result.packages.reduce((n, p) => n + p.localMetadata.length, 0), absentLocally: result.packages.filter(p => !p.localMetadata.length).map(p => p.name + '@' + p.version), unexpectedInstalled: unexpectedInstalled.length, registryMetadataVerified: result.packages.filter(p => p.registry?.nameVersionMatchesLock).length, registryIntegrityMatched: result.packages.filter(p => p.registry?.integrityMatchesLock).length, registryLicenseCounts: result.packages.reduce((o, p) => { const k = p.registry?.license || 'unverified'; o[k] = (o[k] || 0) + 1; return o }, {}), localLicenseCounts: result.packages.filter(p => p.localMetadata.length).reduce((o, p) => { const k = p.localMetadata[0].license || 'undeclared'; o[k] = (o[k] || 0) + 1; return o }, {}), quotaUnavailable }
console.log(JSON.stringify(result, null, 2))
