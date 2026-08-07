import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { access, copyFile, mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const sourceRoot = process.env.NIUMA_CLIENT_COCOS_DIR
const sourceRevision = 'f9d037feaef5a80867fd97c8dd39b9a7486fbeca'
const sourcePath = 'assets/GuanDan/Audio/bg.mp3'
const runtimeDirectory = 'assets/game-assets/audio/music/niuma'
const runtimeRoot = path.join(projectRoot, runtimeDirectory)
const runtimeFile = 'table_theme.mp3'
const destinationPath = path.join(runtimeRoot, runtimeFile)
const manifestPath = path.join(projectRoot, 'third_party/licenses/niuma-client-cocos-bgm.json')
const retainedLicensePath = path.join(projectRoot, 'third_party/licenses/NiuMa-client-cocos-MIT.txt')

if (!sourceRoot) throw new Error('Set NIUMA_CLIENT_COCOS_DIR to the checked-out NiuMa client-cocos repository.')

const exists = async filePath => access(filePath).then(() => true, () => false)
const sha256 = buffer => createHash('sha256').update(buffer).digest('hex')
const normalizeText = buffer => buffer.toString('utf8').replace(/\r\n/g, '\n').trimEnd()
const deterministicUuid = key => {
  const chars = createHash('sha256').update(`niuma-bgm:${sourceRevision}:${key}`).digest('hex').slice(0, 32).split('')
  chars[12] = '5'
  chars[16] = ((Number.parseInt(chars[16], 16) & 0x3) | 0x8).toString(16)
  const hex = chars.join('')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}
const ensureDirectoryMeta = async (directoryPath, key) => {
  const metaPath = `${directoryPath}.meta`
  if (await exists(metaPath)) return
  await writeFile(metaPath, `${JSON.stringify({
    ver: '1.2.0', importer: 'directory', imported: true,
    uuid: deterministicUuid(`directory:${key}`), files: [], subMetas: {}, userData: {},
  }, null, 2)}\n`)
}

let checkedOutRevision
try {
  checkedOutRevision = execFileSync('git', ['-C', sourceRoot, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim()
} catch {
  throw new Error('NiuMa source must be a Git checkout so its pinned revision can be verified.')
}
if (checkedOutRevision !== sourceRevision) throw new Error(`NiuMa source revision mismatch: expected ${sourceRevision}, received ${checkedOutRevision}.`)

const sourceLicense = await readFile(path.join(sourceRoot, 'LICENSE'))
const retainedLicense = await readFile(retainedLicensePath)
if (normalizeText(sourceLicense) !== normalizeText(retainedLicense)) throw new Error('Retained NiuMa MIT license does not match the selected source checkout.')

const sourceBuffer = await readFile(path.join(sourceRoot, sourcePath))
const digest = sha256(sourceBuffer)
await mkdir(runtimeRoot, { recursive: true })
await ensureDirectoryMeta(path.join(projectRoot, 'assets/game-assets/audio/music'), 'music')
await ensureDirectoryMeta(runtimeRoot, 'music/niuma')
if (await exists(destinationPath)) {
  const destinationBuffer = await readFile(destinationPath)
  if (sha256(destinationBuffer) !== digest) throw new Error(`Refusing to overwrite changed runtime asset: ${destinationPath}`)
} else {
  await copyFile(path.join(sourceRoot, sourcePath), destinationPath)
}

const metaPath = `${destinationPath}.meta`
if (!(await exists(metaPath))) {
  await writeFile(metaPath, `${JSON.stringify({
    ver: '1.0.0', importer: 'audio-clip', imported: true,
    uuid: deterministicUuid('music/table_theme'), files: ['.json', '.mp3'], subMetas: {}, userData: { downloadMode: 0 },
  }, null, 2)}\n`)
}

await writeFile(manifestPath, `${JSON.stringify({
  schemaVersion: 1,
  source: 'https://github.com/niuma-wj/client-cocos',
  sourceRevision,
  license: 'MIT',
  licenseFile: 'third_party/licenses/NiuMa-client-cocos-MIT.txt',
  runtimeDirectory,
  asset: {
    key: 'music/niuma/table_theme',
    file: runtimeFile,
    sourcePath,
    bytes: sourceBuffer.length,
    sha256: digest,
    format: { channels: 2, sampleRate: 44100, bitRate: 128000, durationSeconds: 30.537125 },
    use: 'Optional looping lobby/table background music controlled by the independent music switch and volume.',
  },
  releaseBoundary: 'Source and hash are verified; loop seam, loudness and device playback still require human listening before production release.',
}, null, 2)}\n`)

process.stdout.write('Imported and verified the NiuMa MIT background music track.\n')
