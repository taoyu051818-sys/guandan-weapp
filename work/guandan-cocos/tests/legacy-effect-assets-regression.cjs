const assert = require('node:assert/strict')
const crypto = require('node:crypto')
const fs = require('node:fs')
const path = require('node:path')
const { spawnSync } = require('node:child_process')

const projectRoot = path.resolve(__dirname, '..')
const manifestPath = path.join(projectRoot, 'third_party/legacy-effects/manifest.json')
const verifierPath = path.join(projectRoot, 'scripts/verify-legacy-effect-assets.mjs')
const sourceRoot = '/Users/mac/Downloads/掼蛋/client-cocos'

function sha256 (filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex')
}

function runVerifier (...args) {
  return spawnSync(process.execPath, [verifierPath, ...args], {
    cwd: projectRoot,
    encoding: 'utf8',
  })
}

function verifyCatalog () {
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
  assert.equal(manifest.schemaVersion, 1)
  assert.equal(manifest.source.repository, 'https://github.com/niuma-wj/client-cocos.git')
  assert.equal(manifest.source.commit, 'f9d037feaef5a80867fd97c8dd39b9a7486fbeca')
  assert.equal(manifest.license.spdx, 'MIT')
  assert.equal(manifest.runtimePolicy.defaultDecision, 'rejected')
  assert.equal(manifest.runtimePolicy.copyUpstreamMeta, false)

  const copiedLicense = path.join(projectRoot, manifest.license.copiedPath)
  assert.equal(sha256(copiedLicense), manifest.license.copiedSha256, 'retained MIT license must match its catalog hash')

  const allowed = manifest.entries.filter(entry => entry.status === 'allowed')
  const rejected = manifest.entries.filter(entry => entry.status === 'rejected')
  assert.equal(allowed.length, 5, 'only the five reviewed animation sources may be adapted')
  assert.equal(rejected.length, 39, 'every rejected legacy image must stay explicitly catalogued')
  assert.deepEqual(
    allowed.map(entry => entry.sourcePath).sort(),
    [
      'assets/Game/TuoGuan/ani.anim',
      'assets/GuanDan/Room/Main/deal_card.anim',
      'assets/GuanDan/Room/Main/deal_card.animgraph',
      'assets/Talk/TalkLeft.anim',
      'assets/Talk/TalkRight.anim',
    ],
  )
  assert.equal(allowed.every(entry => entry.runtimeIncluded === false && entry.targetSha256 === null), true, 'reviewed clips remain adaptation inputs until their runtime form is separately hashed')
  assert.equal(rejected.every(entry => entry.runtimeIncluded === false && entry.targetPath === null && entry.migrationMode === 'do-not-import'), true)
  assert.equal(manifest.entries.some(entry => entry.sourcePath.endsWith('.meta')), false, 'upstream Cocos metadata must never enter the migration catalog')

  const rejectedDirectoryCounts = Object.fromEntries(
    manifest.runtimePolicy.fullyRejectedSourceDirectories.map(directory => [
      directory,
      rejected.filter(entry => entry.sourcePath.startsWith(`${directory}/`)).length,
    ]),
  )
  assert.deepEqual(rejectedDirectoryCounts, {
    'assets/GuanDan/Room/Effect/Blast': 11,
    'assets/GuanDan/Room/Effect/Flush': 2,
    'assets/GuanDan/Room/Effect/Plane': 2,
  })

  return manifest
}

function verifyCommands (manifest) {
  const defaultResult = runVerifier()
  assert.equal(defaultResult.status, 0, defaultResult.stderr)
  assert.match(defaultResult.stdout, /5 allowed, 39 rejected, 0 runtime/)
  assert.match(defaultResult.stdout, /source skipped/)

  if (!fs.existsSync(sourceRoot)) return false
  const strictResult = runVerifier('--source-root', sourceRoot, '--strict-source')
  assert.equal(strictResult.status, 0, strictResult.stderr)
  assert.match(strictResult.stdout, /source checked/)
  assert.equal(sha256(path.join(sourceRoot, manifest.license.sourcePath)), manifest.license.sourceSha256)
  return true
}

const manifest = verifyCatalog()
const sourceChecked = verifyCommands(manifest)
process.stdout.write(`legacy effect asset regression checks passed (source ${sourceChecked ? 'checked' : 'not available'})\n`)
