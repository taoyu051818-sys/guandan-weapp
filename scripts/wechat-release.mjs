import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { execFileSync, spawnSync } from 'node:child_process'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { inventory } from './release-manifest.mjs'
import { verifyCompatibility } from './release-compatibility.mjs'
import { extractRuntimeConfig, verifyWechatRuntimeConfig } from '../work/guandan-cocos/scripts/runtime-client-config.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const cocos = join(root, 'work/guandan-cocos')
const creator = process.env.COCOS_CREATOR_BIN || '/Applications/Cocos/Creator/3.8.8/CocosCreator.app/Contents/MacOS/CocosCreator'
const wechatCli = process.env.WECHAT_CLI_BIN || '/Applications/wechatwebdevtools.app/Contents/MacOS/cli'
const hash = value => createHash('sha256').update(value).digest('hex')
const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim()
const cleanCommit = () => {
  assert.ok(git('status', '--porcelain', '--untracked-files=all') === '', 'Commit reviewed sources before release; dirty/untracked sources are forbidden')
  return git('rev-parse', 'HEAD')
}
const jsonFile = (path, value) => writeFile(path, JSON.stringify(value, null, 2) + '\n', { flag: 'wx', mode: 0o600 })

export function confirmedUpload (result) {
  const output = `${result.stdout || ''}\n${result.stderr || ''}`.replace(/\x1b\[[0-9;]*m/g, '')
  // DevTools may exit 0 after an API error: exit status alone is insufficient.
  return result.status === 0 && /✔\s*upload\b/i.test(output) && !/\b(?:error|failed|fail)\b|上传失败/i.test(output)
}

async function runLogged (directory, label, command, args, { cwd = root, cocosBuild = false } = {}) {
  console.log(`Running ${label}`)
  const defaults = verifyWechatRuntimeConfig(extractRuntimeConfig(await readFile(join(cocos, 'build-templates/wechatgame/game.ejs'), 'utf8')))
  const env = { ...process.env, GUANDAN_PLATFORM_ENDPOINT: process.env.GUANDAN_PLATFORM_ENDPOINT ?? defaults.platformEndpoint,
    GUANDAN_LOBBY_ENDPOINT: process.env.GUANDAN_LOBBY_ENDPOINT ?? defaults.lobbyEndpoint }
  const result = spawnSync(command, args, { cwd, env, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, timeout: 30 * 60 * 1000 })
  const output = `${result.stdout || ''}\n${result.stderr || ''}`
  await writeFile(join(directory, `${label}.log`), output, { flag: 'wx', mode: 0o600 })
  assert.ok(!result.error && (result.status === 0 || (cocosBuild && result.status === 36)), `${label} failed; inspect saved log`)
  if (cocosBuild) assert.match(output, /Finished/i, `${label} lacks build completion evidence`)
  return result
}

export async function verifyPrepared (directory) {
  const prepared = JSON.parse(await readFile(join(directory, 'prepared.json'), 'utf8'))
  assert.equal(prepared.schemaVersion, 1)
  assert.equal(prepared.commit, cleanCommit(), 'Prepared source differs from checkout')
  assert.equal(hash(await readFile(join(directory, 'manifest.json'))), prepared.manifestSha256, 'Manifest changed')
  execFileSync(process.execPath, ['scripts/release-manifest.mjs', 'verify', join(directory, 'manifest.json')], { cwd: root, stdio: 'pipe' })
  assert.deepEqual(await inventory(join(directory, 'logs')), prepared.logs, 'Build/check logs changed')
  return prepared
}

async function main () {
  const [mode, releaseId, version, description] = process.argv.slice(2)
  assert.ok(['prepare', 'upload'].includes(mode) && /^20\d{6}-[a-z0-9-]+$/.test(releaseId || ''), 'Usage: wechat-release.mjs prepare RELEASE_ID VERSION | upload RELEASE_ID VERSION DESCRIPTION')
  assert.match(version || '', /^\d+(?:\.\d+){2,3}$/)
  assert.ok(mode === 'prepare' ? process.argv.length === 5 : process.argv.length === 6 && description.trim() && description.length <= 120, 'Invalid argument count or description')
  const commit = cleanCommit()
  const directory = join(root, 'release-artifacts', releaseId)
  if (mode === 'prepare') {
    await mkdir(directory, { recursive: true, mode: 0o700 })
    const logs = join(directory, 'logs')
    await mkdir(logs, { mode: 0o700 }) // Existing preparation is never overwritten.
    await runLogged(logs, 'core-build', 'pnpm', ['--dir', 'shared-core', 'build'])
    await runLogged(logs, 'management', process.execPath, ['scripts/project-management.test.mjs'])
    await runLogged(logs, 'core', 'pnpm', ['--dir', 'shared-core', 'test'])
    await runLogged(logs, 'admin', 'npm', ['--prefix', 'work/guandan-admin', 'run', 'verify'])
    await runLogged(logs, 'server', 'npm', ['--prefix', 'work/guandan-windows-source', 'run', 'test:server'])
    await runLogged(logs, 'client', 'npm', ['--prefix', 'work/guandan-cocos', 'run', 'test:ci'])
    for (const platform of ['web-desktop', 'wechatgame']) {
      await runLogged(logs, `build-${platform}`, creator, ['--project', cocos, '--build', `platform=${platform};debug=false`], { cocosBuild: true })
      const target = platform === 'wechatgame' ? 'wechat' : 'web'
      await runLogged(logs, `finalize-${platform}`, 'npm', ['run', `finalize:${target}-build`], { cwd: cocos })
      await runLogged(logs, `verify-${platform}`, 'npm', ['run', `verify:${target}-build`], { cwd: cocos })
    }
    await runLogged(logs, 'boundaries', process.execPath, ['scripts/check-repository-boundaries.mjs', '--with-builds'])
    assert.equal(cleanCommit(), commit, 'Sources changed during preparation')
    execFileSync(process.execPath, ['scripts/release-manifest.mjs', 'create', releaseId], { cwd: root, stdio: 'inherit' })
    await jsonFile(join(directory, 'prepared.json'), { schemaVersion: 1, commit, version, createdAt: new Date().toISOString(),
      manifestSha256: hash(await readFile(join(directory, 'manifest.json'))), logs: await inventory(logs),
      status: { developmentUpload: 'not-uploaded', experience: 'not-confirmed', deviceAcceptance: 'pending', serverDeployment: 'not-performed' } })
    console.log(`Prepared ${releaseId}; no upload or deployment performed`)
    return
  }
  const prepared = await verifyPrepared(directory)
  assert.equal(prepared.version, version, 'Version must match the prepared artifact')
  const config = verifyWechatRuntimeConfig(extractRuntimeConfig(await readFile(join(cocos, 'build/wechatgame/game.js'), 'utf8')))
  const compatibility = await verifyCompatibility(config.platformEndpoint)
  await verifyPrepared(directory) // detect changed output/source during network checks
  await jsonFile(join(directory, 'upload-attempt.json'), { commit, version, startedAt: new Date().toISOString(), compatibility })
  // A crashed/ambiguous attempt requires manual reconciliation, never automatic retry.
  const result = spawnSync(wechatCli, ['upload', '--project', join(cocos, 'build/wechatgame'), '--version', version, '--desc', description], { encoding: 'utf8', timeout: 15 * 60 * 1000, maxBuffer: 16 * 1024 * 1024 })
  await writeFile(join(directory, 'upload.log'), `${result.stdout || ''}\n${result.stderr || ''}`, { flag: 'wx', mode: 0o600 })
  let unchanged = true
  try { await verifyPrepared(directory) } catch { unchanged = false }
  const confirmed = !result.error && confirmedUpload(result) && unchanged
  await jsonFile(join(directory, 'upload-result.json'), { commit, version, completedAt: new Date().toISOString(),
    developmentUpload: confirmed ? 'confirmed' : 'unknown-needs-reconciliation', experience: 'not-confirmed',
    deviceAcceptance: 'pending', serverDeployment: 'not-performed', exitCode: result.status, artifactsUnchanged: unchanged })
  assert.ok(confirmed, 'Upload result is uncertain; inspect console and WeChat platform before any retry')
  console.log('Development upload confirmed. Experience selection and real-device acceptance still require separate evidence.')
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { await main() } catch (error) { console.error(error.message); process.exitCode = 1 }
}
