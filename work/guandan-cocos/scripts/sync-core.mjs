import { cp, mkdir, readdir, rm } from 'node:fs/promises'
import { dirname, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { isClientSharedCoreSource } from './core-sync-policy.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const appRoot = resolve(here, '..')
const coreSource = resolve(appRoot, '../../shared-core/src')
const coreTarget = resolve(appRoot, 'assets/scripts/core/generated')

await mkdir(coreTarget, { recursive: true })

// Creator owns the adjacent .meta files and their UUIDs. Remove only synced
// TypeScript sources so refreshing the shared core never invalidates scenes.
const removeSyncedSources = async directory => {
  const entries = await readdir(directory, { withFileTypes: true })
  await Promise.all(entries.map(async entry => {
    const path = resolve(directory, entry.name)
    if (entry.isDirectory()) await removeSyncedSources(path)
    else if (entry.name.endsWith('.ts')) await rm(path)
  }))
}

await removeSyncedSources(coreTarget)
await cp(coreSource, coreTarget, { recursive: true, filter: source => isClientSharedCoreSource(relative(coreSource, source)) })
await rm(resolve(coreTarget, 'lib/ai.ts.meta'), { force: true })
console.log(`Shared core synced to ${coreTarget}`)
