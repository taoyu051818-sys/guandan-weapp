import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'

const files = ['index.js', 'ranking-model.js', 'ranking-renderer.js']
/** Creator's game.json is generated, so declare and verify the domain at finalization. */
export async function finalizeOpenDataPackage (projectRoot, checkOnly = false) {
  const folder = 'openDataContext'
  const output = resolve(projectRoot, 'build/wechatgame')
  if (!checkOnly) await mkdir(resolve(output, folder), { recursive: true })
  for (const file of files) {
    const source = await readFile(resolve(projectRoot, 'build-templates/wechatgame', folder, file), 'utf8')
    const target = resolve(output, folder, file)
    if (!checkOnly) await writeFile(target, source)
    if (await readFile(target, 'utf8') !== source) throw new Error(`Open data domain out of date: ${file}`)
  }
  const path = resolve(output, 'game.json')
  const config = JSON.parse(await readFile(path, 'utf8'))
  if (!checkOnly) { config.openDataContext = folder; await writeFile(path, `${JSON.stringify(config, null, 2)}\n`) }
  if (config.openDataContext !== folder) throw new Error('WeChat game.json does not declare the friend ranking open data domain.')
}
