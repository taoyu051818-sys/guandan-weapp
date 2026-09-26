import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { adminReleaseFiles, allowedReleasePath, validateReleasePaths, validateReleaseTypes } from '../work/guandan-cocos/ops/guangzhou/release-paths.mjs'
import { packageServerRelease } from './package-server-release.mjs'

for (const file of adminReleaseFiles) assert.equal(allowedReleasePath(file), true)
for (const file of [
  'work/guandan-admin/', 'work/guandan-admin/package.json', 'work/guandan-admin/README.md',
  'work/guandan-admin/tests/api.test.mjs', 'work/guandan-admin/.env', 'work/guandan-admin/admins.json',
  'work/guandan-admin/src/admin-credentials.json', 'work/guandan-admin/enrollment.json',
  'work/guandan-admin/src/new-module.js', 'work/guandan-admin/src/../../secrets',
  '/work/guandan-admin/index.html', 'work//guandan-admin/index.html',
  'work/guandan-windows-source/server/../secrets.json', 'work/guandan-windows-source/server/.env',
  'work/guandan-windows-source/server/admin-credentials.json', 'web/production.env',
  'work/guandan-windows-source/server/admins.json',
]) assert.equal(allowedReleasePath(file, true), false, file)
assert.equal(allowedReleasePath('web/index.html'), false)
assert.equal(allowedReleasePath('web/index.html', true), true)
validateReleasePaths(adminReleaseFiles.join('\n'))
assert.throws(() => validateReleasePaths(adminReleaseFiles.slice(1).join('\n')), /Missing/)
assert.throws(() => validateReleasePaths([...adminReleaseFiles, adminReleaseFiles[0]].join('\n')), /Duplicate/)
validateReleaseTypes('-rw-r--r-- user/group 10 2026-09-26 path\ndrwxr-xr-x user/group 0 2026-09-26 path/\n')
for (const type of ['l', 'h', 'c', 'b', 'p']) assert.throws(() => validateReleaseTypes(`${type}rw-r--r-- user/group 10 path`), /regular/)
const sourceModules = (await readdir(new URL('../work/guandan-admin/src/', import.meta.url))).filter(name => name.endsWith('.js'))
assert.deepEqual(adminReleaseFiles.slice().sort(), ['work/guandan-admin/index.html', 'work/guandan-admin/styles.css', ...sourceModules.map(name => `work/guandan-admin/src/${name}`)].sort(), 'every admin runtime module must be explicitly packaged')

const root = await mkdtemp(join(tmpdir(), 'guandan-release-boundary-'))
try {
  for (const file of ['shared-core/dist/index.js', 'shared-core/package.json', 'work/guandan-windows-source/server/platform-server.js', 'work/guandan-windows-source/package.json', ...adminReleaseFiles]) {
    await mkdir(dirname(join(root, file)), { recursive: true })
    await writeFile(join(root, file), `fixture ${file}\n`)
  }
  await writeFile(join(root, 'work/guandan-admin/admins.json'), 'excluded private fixture')
  await writeFile(join(root, 'work/guandan-admin/README.md'), 'excluded documentation')
  const disguised = join(root, 'work/guandan-windows-source/server/unrelated-name.json')
  for (const privateDocument of [{ schemaVersion: 1, admins: [] }, { totpSecret: 'test-only-fixture' }, { uri: 'otpauth://totp/test-only-fixture' }]) {
    await writeFile(disguised, JSON.stringify(privateDocument))
    await assert.rejects(() => packageServerRelease({ root, releaseId: '20260926-admin-private', outputDirectory: join(root, 'output') }), /Credential\/enrollment document/)
  }
  await rm(disguised)
  await writeFile(join(root, 'work/guandan-windows-source/server/credential-code.js'), "export const example = { totpSecret: 'not-a-document' }\n")
  const result = await packageServerRelease({ root, releaseId: '20260926-admin-fixture', outputDirectory: join(root, 'output') })
  const listing = execFileSync('tar', ['-tzf', result.archive], { encoding: 'utf8', env: { ...process.env, LC_ALL: 'C' } })
  validateReleasePaths(listing)
  assert.ok(!listing.includes('admins.json') && !listing.includes('README.md'))
  assert.match(result.sha256, /^[a-f0-9]{64}$/)
  await assert.rejects(() => packageServerRelease({ root, releaseId: '20260926-admin-fixture', outputDirectory: join(root, 'output') }), /EEXIST/)
  await rm(join(root, 'work/guandan-admin/src/app.js'))
  await symlink(join(root, 'work/guandan-admin/admins.json'), join(root, 'work/guandan-admin/src/app.js'))
  await assert.rejects(() => packageServerRelease({ root, releaseId: '20260926-admin-link', outputDirectory: join(root, 'output') }), /symlink/)
  const activation = await readFile(new URL('../work/guandan-cocos/ops/guangzhou/activate-server-variants.sh', import.meta.url), 'utf8')
  assert.match(activation, /release-paths\.mjs" check/)
  assert.match(activation, /release-paths\.mjs" types/)
  assert.ok(activation.indexOf('release-paths.mjs" types') < activation.indexOf('tar --no-same-owner -xzf'))
  console.log('release admin allowlist, secret/traversal/link rejection and packaging fixture passed')
} finally { await rm(root, { recursive: true, force: true }) }
