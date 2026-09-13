// Audit-only: run actual importer/finalizer source against memory filesystem ports.
// No downloads, subprocesses, production writes, or generated-output rewrites.
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const url = require('node:url')
const crypto = require('node:crypto')
const repo = path.resolve(__dirname, '../../../..')
const ts = require(path.join(repo, 'shared-core/node_modules/typescript'))
const app = '/synthetic-audit-asset-pipeline/app'
const virtualUrl = name => url.pathToFileURL(`${app}/scripts/${name}`).href
const normalize = value => value instanceof URL ? url.fileURLToPath(value) : String(value)
const digest = data => crypto.createHash('sha256').update(data).digest('hex')
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor
let corePolicy

function memory (initial = {}) {
  const files = new Map(Object.entries(initial).map(([p, v]) => [p, Buffer.from(v)]))
  const writes = [], removals = [], copies = []
  const read = (p, encoding) => {
    const key = normalize(p)
    if (!files.has(key)) throw Object.assign(new Error(`ENOENT ${key}`), { code: 'ENOENT' })
    const value = files.get(key)
    return encoding ? value.toString(encoding) : Buffer.from(value)
  }
  const write = (p, value) => { const key = normalize(p); writes.push(key); files.set(key, Buffer.from(value)) }
  const copy = (source, target) => { copies.push([normalize(source), normalize(target)]); write(target, read(source)) }
  const list = (directory, options) => {
    const prefix = `${normalize(directory)}/`, entries = new Map()
    for (const file of files.keys()) if (file.startsWith(prefix)) {
      const relative = file.slice(prefix.length), name = relative.split('/')[0]
      entries.set(name, relative.includes('/'))
    }
    return [...entries].map(([name, directory]) => options?.withFileTypes ? { name, isDirectory: () => directory, isFile: () => !directory } : name)
  }
  const api = {
    readFileSync: read, writeFileSync: write, copyFileSync: copy, mkdirSync () {},
    readFile: async (...args) => read(...args), writeFile: async (...args) => write(...args),
    copyFile: async (...args) => copy(...args), mkdir: async () => {}, readdir: async (...args) => list(...args),
    access: async p => { read(p) }, stat: async p => ({ size: read(p).length }),
    rm: async p => { const key = normalize(p); removals.push(key); files.delete(key) },
    cp: async (source, target, options) => {
      for (const key of [...files.keys()]) if (key.startsWith(`${source}/`) && options.filter(key)) copy(key, `${target}/${key.slice(source.length + 1)}`)
    },
  }
  return { files, writes, removals, copies, api, read, write }
}

async function run (name, mem, { env = {}, fetch, exec } = {}) {
  const source = fs.readFileSync(path.join(repo, 'work/guandan-cocos/scripts', name), 'utf8')
    .replaceAll('import.meta.url', JSON.stringify(virtualUrl(name)))
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText
  const module = { exports: {} }, logs = [], calls = []
  const requirePort = key => {
    if (key === 'node:fs/promises' || key === 'node:fs') return mem.api
    if (['node:path', 'node:url', 'node:crypto'].includes(key)) return require(key)
    if (key === './core-sync-policy.mjs') return corePolicy
    if (key === 'node:child_process') return { execFileSync: (...args) => { calls.push(args); if (!exec) throw Error('Subprocess forbidden'); return exec(...args) } }
    throw Error(`Unexpected source dependency: ${key}`)
  }
  await new AsyncFunction('require', 'exports', 'module', 'process', 'console', 'fetch', compiled)(
    requirePort, module.exports, module, { env, argv: [], stdout: { write: value => logs.push(value) } },
    { log: value => logs.push(value) }, fetch || (() => { throw Error('Network forbidden') }),
  )
  return { ...module.exports, logs, calls }
}

async function main () {
  corePolicy = await import(url.pathToFileURL(path.join(repo, 'work/guandan-cocos/scripts/core-sync-policy.mjs')))
  const template = `${app}/build-templates/wechatgame/openDataContext`, output = `${app}/build/wechatgame`
  const mem = memory(Object.fromEntries(['index.js', 'ranking-model.js', 'ranking-renderer.js'].map((file, i) => [`${template}/${file}`, `// audit ${i}`])))
  mem.write(`${output}/game.json`, JSON.stringify({ deviceOrientation: 'landscape', subpackages: [{ name: 'game-assets', root: 'subpackages/game-assets/' }] }))
  const { finalizeOpenDataPackage } = await run('wechat-open-data-package.mjs', mem)
  await finalizeOpenDataPackage(app)
  const config = JSON.parse(mem.read(`${output}/game.json`, 'utf8'))
  assert.equal(config.openDataContext, 'openDataContext'); assert.equal(config.subpackages.length, 1)
  const beforeCheck = mem.writes.length; await finalizeOpenDataPackage(app, true); assert.equal(mem.writes.length, beforeCheck)
  mem.write(`${output}/openDataContext/ranking-model.js`, '// stale')
  await assert.rejects(finalizeOpenDataPackage(app, true), /out of date/)
  await finalizeOpenDataPackage(app)
  mem.write(`${output}/game.json`, JSON.stringify({ ...config, openDataContext: 'wrong' }))
  await assert.rejects(finalizeOpenDataPackage(app, true), /does not declare/)

  const source = path.resolve(app, '../../shared-core/src'), target = `${app}/assets/scripts/core/generated`
  const sync = memory({ [`${source}/index.ts`]: 'export {}', [`${source}/lib/rules.ts`]: 'rules', [`${source}/lib/ai.ts`]: 'excluded barrel',
    [`${target}/obsolete.ts`]: 'obsolete', [`${target}/obsolete.ts.meta`]: 'stable uuid', [`${target}/lib/old.ts`]: 'old',
    [`${target}/lib/rules.ts.meta`]: 'rule uuid', [`${target}/lib/ai.ts.meta`]: 'retired uuid' })
  await run('sync-core.mjs', sync)
  assert.equal(sync.read(`${target}/lib/rules.ts`, 'utf8'), 'rules')
  assert.equal(sync.read(`${target}/lib/rules.ts.meta`, 'utf8'), 'rule uuid')
  assert.equal(sync.read(`${target}/obsolete.ts.meta`, 'utf8'), 'stable uuid')
  for (const p of ['obsolete.ts', 'lib/old.ts', 'lib/ai.ts', 'lib/ai.ts.meta']) assert.equal(sync.files.has(`${target}/${p}`), false)

  const profilesSource = path.resolve(app, '../guandan-windows-source/server/data/default-profiles')
  const profiles = memory({ [`${profilesSource}/catalog.json`]: JSON.stringify({ profiles: [{ displayName: 'Audit Player', avatarUrl: '/profiles/a.jpg', file: 'a.jpg' }] }), [`${profilesSource}/a.jpg`]: 'synthetic image bytes' })
  await run('sync-default-profiles.mjs', profiles)
  assert.equal(profiles.read(`${app}/assets/game-assets/ui/profiles/a.jpg`, 'utf8'), 'synthetic image bytes')
  assert.match(profiles.read(`${app}/assets/scripts/services/DefaultProfileCatalog.ts`, 'utf8'), /ui\/profiles\/a\/texture/)

  const catalogPath = `${app}/third_party/licenses/gameabc2-audio/catalog.json`, voiceRoot = `${app}/assets/game-assets/audio/voices/licensed`
  const catalog = { assets: [{ key: 'licensed/a', label: 'A', file: 'a.mp3', url: 'https://audit.invalid/a' }], archived: [], excluded: [], authorization: 'synthetic fixture' }
  const badDownload = memory({ [catalogPath]: JSON.stringify(catalog), [`${voiceRoot}/a.mp3`]: 'existing clip bytes' })
  await assert.rejects(run('import-licensed-audio.mjs', badDownload, { fetch: async () => ({ ok: true, arrayBuffer: async () => Buffer.from('<html>bad</html>') }) }), /not an MP3/)
  assert.equal(badDownload.read(`${voiceRoot}/a.mp3`, 'utf8'), 'existing clip bytes')
  const valid = Buffer.alloc(512); valid.write('ID3')
  const imported = memory({ [catalogPath]: JSON.stringify(catalog) })
  await run('import-licensed-audio.mjs', imported, { fetch: async () => ({ ok: true, arrayBuffer: async () => valid, headers: { get: () => 'audio/mpeg' } }) })
  const manifest = JSON.parse(imported.read(`${app}/third_party/licenses/gameabc2-audio/manifest.json`, 'utf8'))
  assert.equal(manifest.assets[0].sha256, digest(valid)); assert.equal(manifest.assets[0].bytes, 512)

  const upstream = '/synthetic-upstream', revision = 'f9d037feaef5a80867fd97c8dd39b9a7486fbeca'
  const makeBgm = destination => memory({ [`${upstream}/LICENSE`]: 'audit license\r\n', [`${app}/third_party/licenses/NiuMa-client-cocos-MIT.txt`]: 'audit license\n',
    [`${upstream}/assets/GuanDan/Audio/bg.mp3`]: 'modified checkout audio', ...(destination ? { [`${app}/assets/game-assets/audio/music/niuma/table_theme.mp3`]: destination } : {}) })
  const protectedBgm = makeBgm('user modified destination')
  await assert.rejects(run('import-niuma-bgm.mjs', protectedBgm, { env: { NIUMA_CLIENT_COCOS_DIR: upstream }, exec: () => revision }), /Refusing to overwrite changed/)
  assert.equal(protectedBgm.read(`${app}/assets/game-assets/audio/music/niuma/table_theme.mp3`, 'utf8'), 'user modified destination')
  const wrongRevision = makeBgm()
  await assert.rejects(run('import-niuma-bgm.mjs', wrongRevision, { env: { NIUMA_CLIENT_COCOS_DIR: upstream }, exec: () => '0'.repeat(40) }), /revision mismatch/)
  assert.equal(wrongRevision.writes.length, 0)
  const dirtyUpstream = makeBgm(), result = await run('import-niuma-bgm.mjs', dirtyUpstream, { env: { NIUMA_CLIENT_COCOS_DIR: upstream }, exec: () => revision })
  const bgmManifest = JSON.parse(dirtyUpstream.read(`${app}/third_party/licenses/niuma-client-cocos-bgm.json`, 'utf8'))
  assert.equal(bgmManifest.sourceRevision, revision)
  assert.equal(bgmManifest.asset.sha256, digest(Buffer.from('modified checkout audio')))
  assert.deepEqual(result.calls.map(([, args]) => args), [['-C', upstream, 'rev-parse', 'HEAD']])
  console.log(JSON.stringify({ openData: 'copy/check-only/stale/config-preservation passed', coreSync: 'TS-only prune/meta preservation/filter passed',
    profiles: 'bundled pixels and generated path mapping passed', licensedAudio: 'invalid response preserves selected clip; valid bytes hashed',
    bgm: 'destination protection/revision mismatch passed', sourceProvenanceConcern: 'HEAD alone does not compare working audio bytes with commit blobs; memory-only diagnostic, no current corrupt asset demonstrated',
    sideEffects: 'memory filesystem, mocked git/fetch, no external writes' }))
}
main().catch(error => { console.error(error); process.exitCode = 1 })
