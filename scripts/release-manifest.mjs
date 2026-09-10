import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { readdir, readFile, lstat, mkdir, writeFile } from 'node:fs/promises'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim()
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex')
export async function inventory (directory) {
  const rows = []
  async function walk (path) {
    const info = await lstat(path)
    assert.ok(!info.isSymbolicLink(), `Symlink is not a release artifact: ${path}`)
    if (info.isDirectory()) for (const name of (await readdir(path)).sort()) await walk(join(path, name))
    else {
      assert.ok(info.isFile(), `Unsupported artifact: ${path}`)
      rows.push({ path: relative(directory, path).split('\\').join('/'), bytes: info.size, sha256: sha256(await readFile(path)) })
    }
  }
  await walk(directory)
  assert.ok(rows.length, `Empty artifact directory: ${directory}`)
  return { files: rows, totalBytes: rows.reduce((sum, file) => sum + file.bytes, 0), sha256: sha256(JSON.stringify(rows)) }
}

async function main () {
  const [mode, argument] = process.argv.slice(2)
  assert.ok(process.argv.length === 4 && argument && ['create', 'verify'].includes(mode), 'Usage: release-manifest.mjs create RELEASE_ID | verify MANIFEST_FILE')
  if (mode === 'verify') {
    const manifest = JSON.parse(await readFile(resolve(argument), 'utf8'))
    assert.equal(manifest.schemaVersion, 1)
    assert.equal(manifest.source.commit, git('rev-parse', 'HEAD'), 'Source commit differs')
    assert.equal(git('status', '--porcelain', '--untracked-files=all'), '', 'Working tree is not clean')
    assert.deepEqual(Object.keys(manifest.artifacts).sort(), ['shared-core/dist', 'work/guandan-cocos/build/web-desktop', 'work/guandan-cocos/build/wechatgame'].sort())
    for (const [path, expected] of Object.entries(manifest.artifacts)) {
      assert.ok(['shared-core/dist', 'work/guandan-cocos/build/web-desktop', 'work/guandan-cocos/build/wechatgame'].includes(path))
      assert.deepEqual(await inventory(join(root, path)), expected, `Artifact differs: ${path}`)
    }
    console.log(`Verified immutable artifact inventory for ${manifest.source.commit}`)
    return
  }
  assert.match(argument || '', /^20\d{6}-[a-z0-9-]+$/)
  assert.equal(git('status', '--porcelain', '--untracked-files=all'), '', 'Commit reviewed sources before generating a release manifest')
  const artifacts = {}
  for (const path of ['shared-core/dist', 'work/guandan-cocos/build/web-desktop', 'work/guandan-cocos/build/wechatgame']) artifacts[path] = await inventory(join(root, path))
  const manifest = {
    schemaVersion: 1, releaseId: argument, createdAt: new Date().toISOString(),
    source: { commit: git('rev-parse', 'HEAD'), tree: git('rev-parse', 'HEAD^{tree}'), branch: git('branch', '--show-current') },
    tooling: { node: process.version, cocos: '3.8.8' }, artifacts,
    acceptance: { realDevice: 'pending', productionCapacity: 'unverified', deployment: 'not-deployed' },
    note: 'Hash inventory ties these files to the recorded clean checkout. Build logs and CI must be retained separately; this is not a claim of reproducible build provenance or device acceptance.',
  }
  const directory = join(root, 'release-artifacts', argument)
  await mkdir(directory, { recursive: true })
  await writeFile(join(directory, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n', { flag: 'wx' })
  console.log(join(directory, 'manifest.json'))
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main()
