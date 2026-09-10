import assert from 'node:assert/strict'
import { mkdtemp, writeFile, mkdir, symlink, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { inventory } from './release-manifest.mjs'

const directory = await mkdtemp(join(tmpdir(), 'guandan-release-inventory-'))
try {
  await assert.rejects(inventory(directory), /Empty artifact/)
  await writeFile(join(directory, 'a.txt'), 'one')
  await mkdir(join(directory, 'nested'))
  await writeFile(join(directory, 'nested/b.txt'), 'two')
  const first = await inventory(directory)
  assert.equal(first.totalBytes, 6)
  assert.deepEqual(first.files.map(row => row.path), ['a.txt', 'nested/b.txt'])
  assert.deepEqual(await inventory(directory), first)
  await writeFile(join(directory, 'a.txt'), 'ONE')
  assert.notEqual((await inventory(directory)).sha256, first.sha256, 'same-size changes must be detected')
  await symlink(join(directory, 'a.txt'), join(directory, 'link'))
  await assert.rejects(inventory(directory), /Symlink/)
  console.log('release inventory ordering, byte hashes and symlink rejection passed')
} finally { await rm(directory, { recursive: true, force: true }) }
