const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { loadTypeScript } = require('./support/typescript.cjs')
const ts = loadTypeScript()
const file = path.resolve(__dirname, '../assets/scripts/services/DefaultProfileFrames.ts')
const calls = []
class SpriteFrame {}
class Texture2D {}
const record = { exports: {} }
const code = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2019 },
}).outputText
new Function('require', 'module', 'exports', code)(name => {
  if (name === 'cc') return { SpriteFrame, Texture2D }
  if (name === './DefaultProfileCatalog') return { DEFAULT_PROFILE_CATALOG: [{ displayName: 'fixture', asset: 'fixture/texture' }] }
  if (name === './GameAssetLoader') return { loadGameAsset: (...args) => calls.push(args) }
  throw new Error(`unexpected dependency ${name}`)
}, record, record.exports)
const { defaultProfileFrame } = record.exports
assert.equal(defaultProfileFrame('unknown'), undefined)
assert.equal(calls.length, 0)
defaultProfileFrame('fixture'); defaultProfileFrame('fixture')
assert.equal(calls.length, 1, 'concurrent renders coalesce loading')
calls[0][2](new Error('offline'), null)
defaultProfileFrame('fixture'); defaultProfileFrame('fixture')
assert.equal(calls.length, 2, 'failed load can retry on the next render')
calls[1][2](null, null)
defaultProfileFrame('fixture')
assert.equal(calls.length, 3, 'empty success also releases the pending slot')
const texture = new Texture2D()
calls[2][2](null, texture)
const frame = defaultProfileFrame('fixture')
assert.ok(frame instanceof SpriteFrame)
assert.equal(frame.texture, texture)
assert.equal(defaultProfileFrame('fixture'), frame)
assert.equal(calls.length, 3, 'successful frames remain cached')
console.log('default profile failure/retry/coalescing/cache regression passed')
