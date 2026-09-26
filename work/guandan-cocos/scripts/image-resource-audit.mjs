import assert from 'node:assert/strict'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { dirname, extname, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const imagePattern = /\.(png|jpe?g|webp)$/i
const walk = dir => readdirSync(dir, { withFileTypes: true }).flatMap(e => e.isDirectory() ? walk(resolve(dir, e.name)) : [resolve(dir, e.name)])
const digest = bytes => createHash('sha256').update(bytes).digest('hex')
export function imageDimensions (bytes) {
  if (bytes.subarray(1, 4).toString() === 'PNG') return [bytes.readUInt32BE(16), bytes.readUInt32BE(20)]
  assert.equal(bytes.readUInt16BE(0), 0xffd8, 'Runtime images must use audited PNG/JPEG encodings')
  for (let p = 2; p < bytes.length;) {
    assert.equal(bytes[p++], 0xff)
    while (bytes[p] === 0xff) p++
    const marker = bytes[p++], length = bytes.readUInt16BE(p)
    if ([0xc0, 0xc1, 0xc2].includes(marker)) return [bytes.readUInt16BE(p + 5), bytes.readUInt16BE(p + 3)]
    assert.ok(length >= 2 && p + length <= bytes.length, 'Invalid JPEG segment')
    p += length
  }
  throw Error('Missing image dimensions')
}

/** Explicit reviewed inventory. This never discovers and silently approves new assets. */
export function verifyImageResources (root, { buildRoot } = {}) {
  const manifest = JSON.parse(readFileSync(resolve(root, 'art-source/image-resources.json'), 'utf8'))
  const files = walk(resolve(root, 'assets')).filter(p => imagePattern.test(p)).map(p => relative(root, p)).sort()
  assert.deepEqual(files, manifest.images.map(i => i.path).sort(), 'Runtime images differ from reviewed inventory')
  assert.equal(new Set(manifest.images.map(i => i.id)).size, manifest.images.length, 'Duplicate image IDs')
  const hashes = new Map(), uuids = new Set()
  let totalBytes = 0
  for (const entry of manifest.images) {
    const bytes = readFileSync(resolve(root, entry.path)), [width, height] = imageDimensions(bytes)
    assert.ok(bytes.length <= entry.maxBytes, `${entry.id}: encoded byte budget exceeded`)
    assert.ok(width <= entry.maxWidth && height <= entry.maxHeight, `${entry.id}: texture pixel budget exceeded`)
    assert.ok(entry.usage && entry.lifetime && entry.sourceEvidence, `${entry.id}: ownership/provenance missing`)
    assert.ok(existsSync(resolve(root, entry.sourceEvidence)), `${entry.id}: missing source evidence`)
    for (const reference of entry.consumers) {
      assert.ok(readFileSync(resolve(root, reference.file), 'utf8').includes(reference.token), `${entry.id}: consumer reference retired`)
    }
    assert.ok(entry.consumers.length, `${entry.id}: no consumer`)
    const hash = digest(bytes)
    assert.ok(!hashes.has(hash), `${entry.id}: duplicate pixels of ${hashes.get(hash)}`)
    hashes.set(hash, entry.id)
    const meta = JSON.parse(readFileSync(resolve(root, entry.path + '.meta'), 'utf8'))
    assert.ok(meta.uuid && !uuids.has(meta.uuid), `${entry.id}: missing/duplicate UUID`)
    uuids.add(meta.uuid)
    totalBytes += bytes.length
    if (buildRoot && entry.path.startsWith('assets/game-assets/')) {
      const bundle = existsSync(resolve(buildRoot, 'subpackages/game-assets')) ? 'subpackages/game-assets' : 'assets/game-assets'
      const native = resolve(buildRoot, bundle, 'native', meta.uuid.slice(0, 2), meta.uuid + extname(entry.path))
      // Cocos fixes transparent edge RGB on import; compare the shipped bytes
      // with that import product, not the artist's unprocessed source bytes.
      const imported = resolve(root, 'library', meta.uuid.slice(0, 2), meta.uuid + extname(entry.path))
      const expected = meta.userData?.fixAlphaTransparencyArtifacts ? readFileSync(imported) : bytes
      const built = readFileSync(native)
      assert.deepEqual(imageDimensions(expected), [width, height], `${entry.id}: imported dimensions are stale`)
      assert.equal(digest(built), digest(expected), `${entry.id}: built image is stale`)
    }
  }
  for (const meta of walk(resolve(root, 'assets')).filter(p => /\.(png|jpe?g|webp)\.meta$/i.test(p))) {
    assert.ok(existsSync(meta.slice(0, -5)), `Orphan image metadata: ${meta}`)
  }
  for (const retired of manifest.retired) {
    assert.ok(!existsSync(resolve(root, retired.path)) && !existsSync(resolve(root, retired.path + '.meta')), `${retired.path}: retired image returned`)
    assert.equal(digest(readFileSync(resolve(root, retired.archive))), retired.sha256, 'Retired source archive changed')
    if (buildRoot) {
      const bundle = existsSync(resolve(buildRoot, 'subpackages/game-assets')) ? 'subpackages/game-assets' : 'assets/game-assets'
      assert.ok(!existsSync(resolve(buildRoot, bundle, 'native', retired.uuid.slice(0, 2), retired.uuid + extname(retired.path))), `${retired.path}: retired image shipped`)
    }
  }
  assert.ok(totalBytes <= manifest.maxTotalBytes, 'Total runtime image budget exceeded')
  return { count: manifest.images.length, totalBytes, retired: manifest.retired.length }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
  console.log('Image resources verified:', verifyImageResources(root, process.argv.includes('--wechat') ? { buildRoot: resolve(root, 'build/wechatgame') } : {}))
}
