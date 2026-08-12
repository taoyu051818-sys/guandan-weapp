import { createHash } from 'node:crypto'
import { mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { basename, dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const catalogPath = resolve(projectRoot, 'third_party/licenses/gameabc2-audio/catalog.json')
const manifestPath = resolve(projectRoot, 'third_party/licenses/gameabc2-audio/manifest.json')
const runtimeRoot = resolve(projectRoot, 'assets/game-assets/audio/voices/licensed')
const archiveRoot = resolve(projectRoot, 'art-source/audio/licensed-archive')
const catalog = JSON.parse(await readFile(catalogPath, 'utf8'))

const isMp3 = buffer => {
  if (buffer.length < 512) return false
  if (buffer.subarray(0, 3).toString('ascii') === 'ID3') return true
  return buffer[0] === 0xff && (buffer[1] & 0xe0) === 0xe0
}

const sha256 = buffer => createHash('sha256').update(buffer).digest('hex')

async function download (asset, destinationRoot) {
  const destination = resolve(destinationRoot, asset.file)
  const response = await fetch(asset.url, {
    headers: { 'user-agent': 'guandan-cocos-licensed-audio-import/1.0' },
    redirect: 'follow',
  })
  if (!response.ok) throw new Error(`${asset.label}: HTTP ${response.status}`)
  const buffer = Buffer.from(await response.arrayBuffer())
  if (!isMp3(buffer)) throw new Error(`${asset.label}: response is not an MP3`)
  // The complete response is validated in memory before replacing a local clip.
  await writeFile(destination, buffer)
  return {
    ...asset,
    bytes: buffer.length,
    sha256: sha256(buffer),
    contentType: response.headers.get('content-type') ?? 'unknown',
  }
}

await mkdir(runtimeRoot, { recursive: true })
await mkdir(archiveRoot, { recursive: true })
await rm(resolve(runtimeRoot, '.DS_Store'), { force: true })
await rm(resolve(archiveRoot, '.DS_Store'), { force: true })
const runtimeFileNames = new Set(catalog.assets.map(asset => asset.file))
for (const file of await readdir(runtimeRoot)) {
  if (!file.endsWith('.mp3') || runtimeFileNames.has(file)) continue
  await rm(resolve(runtimeRoot, file), { force: true })
  await rm(resolve(runtimeRoot, `${file}.meta`), { force: true })
}
const archiveFileNames = new Set(catalog.archived.map(asset => asset.file))
for (const file of await readdir(archiveRoot)) {
  if (!file.endsWith('.mp3') || archiveFileNames.has(file)) continue
  await rm(resolve(archiveRoot, file), { force: true })
  await rm(resolve(archiveRoot, `${file}.meta`), { force: true })
}

const imported = []
for (const asset of catalog.assets) {
  imported.push(await download(asset, runtimeRoot))
  process.stdout.write(`downloaded ${asset.file}\n`)
}

const archived = []
for (const asset of catalog.archived) {
  archived.push(await download(asset, archiveRoot))
  process.stdout.write(`archived ${asset.file}\n`)
}

const manifest = {
  schemaVersion: 1,
  authorization: catalog.authorization,
  generatedAt: new Date().toISOString(),
  runtimeDirectory: 'assets/game-assets/audio/voices/licensed',
  archiveDirectory: 'art-source/audio/licensed-archive',
  assets: imported,
  archived,
  excluded: catalog.excluded,
}
await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`)

for (const asset of imported) {
  const runtimePath = resolve(runtimeRoot, asset.file)
  const info = await stat(runtimePath)
  if (info.size !== asset.bytes) throw new Error(`${basename(runtimePath)}: size changed after import`)
}

for (const asset of archived) {
  const archivePath = resolve(archiveRoot, asset.file)
  const info = await stat(archivePath)
  if (info.size !== asset.bytes) throw new Error(`${basename(archivePath)}: size changed after import`)
}

process.stdout.write(`verified ${imported.length} runtime and ${archived.length} archived MP3 files; ${catalog.excluded.length} visual asset excluded\n`)
