import { readFile, readdir } from 'node:fs/promises'
import { dirname, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { isClientSharedCoreSource } from './core-sync-policy.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const projectRoot = resolve(here, '..')
const sourceRoot = resolve(projectRoot, '../../shared-core/src')
const generatedRoot = resolve(projectRoot, 'assets/scripts/core/generated')

const listTypescript = async (root, directory = root) => {
  const entries = await readdir(directory, { withFileTypes: true })
  const nested = await Promise.all(entries.map(async entry => {
    const path = resolve(directory, entry.name)
    if (entry.isDirectory()) return await listTypescript(root, path)
    return entry.isFile() && entry.name.endsWith('.ts') ? [relative(root, path)] : []
  }))
  return nested.flat().sort()
}

const sourceFiles = (await listTypescript(sourceRoot)).filter(isClientSharedCoreSource)
const generatedFiles = await listTypescript(generatedRoot)
const failures = []

for (const path of new Set([...sourceFiles, ...generatedFiles])) {
  if (!sourceFiles.includes(path)) failures.push(`generated-only: ${path}`)
  else if (!generatedFiles.includes(path)) failures.push(`missing-generated: ${path}`)
  else {
    const [source, generated] = await Promise.all([
      readFile(resolve(sourceRoot, path), 'utf8'),
      readFile(resolve(generatedRoot, path), 'utf8'),
    ])
    if (source !== generated) failures.push(`content-drift: ${path}`)
  }
}

if (failures.length) {
  console.error(`Shared core is out of sync:\n${failures.map(item => `- ${item}`).join('\n')}`)
  console.error('Run: node scripts/sync-core.mjs')
  process.exitCode = 1
} else {
  console.log(`Shared core sync verified (${sourceFiles.length} TypeScript files)`)
}
