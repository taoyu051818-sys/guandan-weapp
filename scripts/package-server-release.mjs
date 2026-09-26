import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { copyFile, lstat, mkdir, mkdtemp, open, readFile, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { adminReleaseFiles, allowedReleasePath, validateReleasePaths, validateReleaseTypes } from '../work/guandan-cocos/ops/guangzhou/release-paths.mjs'

const repository = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const tar = args => execFileSync('tar', args, { encoding: 'utf8', env: { ...process.env, LC_ALL: 'C' } })
const rejectPrivateCredentialDocument = (contents, path) => {
  if (!/^\s*\{/.test(contents)) return
  let document
  try { document = JSON.parse(contents) } catch { return }
  assert.ok(!Array.isArray(document.admins) && typeof document.totpSecret !== 'string' &&
    !(typeof document.uri === 'string' && document.uri.startsWith('otpauth:')),
  `Credential/enrollment document must remain outside the release: ${path}`)
}

export async function packageServerRelease ({ root, releaseId, outputDirectory, withWeb = false }) {
  assert.match(releaseId, /^20\d{6}-[a-z0-9-]+$/)
  const files = []
  async function collect (source, target) {
    const info = await lstat(source)
    assert.ok(!info.isSymbolicLink(), `Release input is a symlink: ${source}`)
    assert.ok(allowedReleasePath(target, withWeb), `Unexpected release input: ${target}`)
    if (info.isDirectory()) {
      for (const child of (await readdir(source)).sort()) await collect(join(source, child), `${target}/${child}`)
    } else {
      assert.ok(info.isFile() && info.nlink === 1, `Release inputs must be regular non-linked files: ${source}`)
      rejectPrivateCredentialDocument(await readFile(source, 'utf8'), target)
      files.push({ source, target })
    }
  }
  for (const path of ['shared-core/dist', 'shared-core/package.json', 'work/guandan-windows-source/server', 'work/guandan-windows-source/package.json', ...adminReleaseFiles]) await collect(join(root, path), path)
  if (withWeb) await collect(join(root, 'work/guandan-cocos/build/web-desktop'), 'web')
  validateReleasePaths(files.map(file => file.target).join('\n'), withWeb)
  const stage = await mkdtemp(join(tmpdir(), 'guandan-release-stage-'))
  const archive = join(resolve(outputDirectory), `guandan-release-${releaseId}.tgz`)
  let reserved = false
  try {
    await mkdir(resolve(outputDirectory), { recursive: true, mode: 0o700 })
    const handle = await open(archive, 'wx', 0o600)
    await handle.close(); reserved = true
    for (const { source, target } of files) {
      await mkdir(dirname(join(stage, target)), { recursive: true })
      await copyFile(source, join(stage, target))
    }
    tar(['-czf', archive, '-C', stage, ...files.map(file => file.target)])
    validateReleasePaths(tar(['-tzf', archive]), withWeb)
    validateReleaseTypes(tar(['-tvzf', archive]))
    const sha256 = createHash('sha256').update(await readFile(archive)).digest('hex')
    return { archive, sha256, files: files.length, withWeb }
  } catch (error) {
    if (reserved) await rm(archive, { force: true })
    throw error
  } finally { await rm(stage, { recursive: true, force: true }) }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [releaseId, outputDirectory, option] = process.argv.slice(2)
  assert.ok(releaseId && outputDirectory && (!option || option === '--with-web') && process.argv.length <= 5, 'Usage: package-server-release.mjs RELEASE_ID OUTPUT_DIRECTORY [--with-web]')
  assert.equal(execFileSync('git', ['status', '--porcelain', '--untracked-files=all'], { cwd: repository, encoding: 'utf8' }).trim(), '', 'Commit reviewed sources before packaging a release')
  const result = await packageServerRelease({ root: repository, releaseId, outputDirectory, withWeb: option === '--with-web' })
  console.log(JSON.stringify({ ...result, sourceCommit: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repository, encoding: 'utf8' }).trim() }, null, 2))
}
