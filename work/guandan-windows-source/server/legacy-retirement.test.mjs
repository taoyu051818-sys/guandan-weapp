import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const projectDir = dirname(dirname(fileURLToPath(import.meta.url)))
const packageJson = JSON.parse(readFileSync(join(projectDir, 'package.json'), 'utf8'))

for (const retiredScript of ['dev', 'build', 'preview']) {
  assert.equal(packageJson.scripts[retiredScript], undefined)
}
assert.equal(packageJson.scripts.check, 'npm run check:server')
assert.equal(packageJson.scripts.lint, 'npm run lint:server')
assert.equal(packageJson.scripts.test, 'npm run test:server')

const legacyEntry = join(projectDir, 'server/index.js')
const legacyResult = spawnSync(process.execPath, [legacyEntry], { encoding: 'utf8' })
assert.notEqual(legacyResult.status, 0)
assert.match(legacyResult.stderr, /has been retired/)

const readme = readFileSync(join(projectDir, 'README.md'), 'utf8')
assert.doesNotMatch(readme, /npm run (?:dev|build|preview)/)
assert.doesNotMatch(readme, /node server\/index\.js/)

console.log('Legacy React and Socket.IO entry points are retired')
