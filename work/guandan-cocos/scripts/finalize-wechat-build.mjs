import { readFile, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { finalizeOpenDataPackage } from './wechat-open-data-package.mjs'
import {
  extractRuntimeConfig,
  injectScriptRuntimeConfig,
  runtimeConfigFromEnv,
  verifyWechatRuntimeConfig,
} from './runtime-client-config.mjs'

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const gamePath = resolve(projectRoot, 'build/wechatgame/game.js')
const checkOnly = process.argv.includes('--check')
// Every WeChat package is strict, including debug/package-only builds. Defaults live in the Creator template.
const template = await readFile(resolve(projectRoot, 'build-templates/wechatgame/game.ejs'), 'utf8')
const defaults = verifyWechatRuntimeConfig(extractRuntimeConfig(template))
const requested = verifyWechatRuntimeConfig(runtimeConfigFromEnv({
  ...process.env,
  GUANDAN_PLATFORM_ENDPOINT: process.env.GUANDAN_PLATFORM_ENDPOINT ?? defaults.platformEndpoint,
  GUANDAN_LOBBY_ENDPOINT: process.env.GUANDAN_LOBBY_ENDPOINT ?? defaults.lobbyEndpoint,
}, { release: true }))
let source = await readFile(gamePath, 'utf8')

if (!checkOnly && requested) {
  source = injectScriptRuntimeConfig(source, requested)
  await writeFile(gamePath, source, 'utf8')
}
const embedded = extractRuntimeConfig(source)
verifyWechatRuntimeConfig(embedded)
if (requested && JSON.stringify(embedded) !== JSON.stringify(requested)) throw new Error('WeChat build runtime config does not match the requested environment.')
await finalizeOpenDataPackage(projectRoot, checkOnly)
console.log(checkOnly ? 'WeChat runtime config and open data domain verified.' : 'WeChat runtime config and open data domain installed.')
