import { cp, mkdir, rm } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const appRoot = resolve(here, '..')
const coreSource = resolve(appRoot, '../../shared-core/src')
const coreTarget = resolve(appRoot, 'assets/scripts/core/generated')

await rm(coreTarget, { recursive: true, force: true })
await mkdir(coreTarget, { recursive: true })
await cp(coreSource, coreTarget, { recursive: true })
console.log(`Shared core synced to ${coreTarget}`)
