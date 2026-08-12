import { readFile, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  extractRuntimeConfig,
  injectScriptRuntimeConfig,
  runtimeConfigFromEnv,
  verifyReleaseRuntimeConfig,
} from './runtime-client-config.mjs'

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const gamePath = resolve(projectRoot, 'build/wechatgame/game.js')
const checkOnly = process.argv.includes('--check')
const release = process.argv.includes('--release')
const requested = runtimeConfigFromEnv(process.env, { release })
let source = await readFile(gamePath, 'utf8')

if (!checkOnly && requested) {
  source = injectScriptRuntimeConfig(source, requested)
  await writeFile(gamePath, source, 'utf8')
}
const embedded = extractRuntimeConfig(source)
if (release) verifyReleaseRuntimeConfig(embedded)
if (requested && JSON.stringify(embedded) !== JSON.stringify(requested)) throw new Error('WeChat build runtime config does not match the requested environment.')
console.log(checkOnly ? 'WeChat runtime client config verified.' : 'WeChat runtime client config injected.')
