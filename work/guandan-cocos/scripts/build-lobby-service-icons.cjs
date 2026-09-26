// Offline export of the seven approved, unmodified Phosphor Fill geometries.
const fs = require('node:fs')
const path = require('node:path')
const { createHash } = require('node:crypto')
const sharp = require(process.env.SHARP_MODULE || 'sharp')
const root = path.resolve(__dirname, '..')
const source = path.join(root, 'third_party/assets/phosphor-lobby')
const output = path.join(root, 'assets/game-assets/ui/lobby-services')
const icons = {
  messages: 'envelope-simple', share: 'share-fat', feedback: 'chat-circle-dots',
  tasks: 'clipboard-text', records: 'cards', ranking: 'ranking', membership: 'crown-simple',
}
const stableId = name => {
  const hex = createHash('sha256').update('phosphor-lobby-2.1.1:' + name).digest('hex')
  return `${hex.slice(0,8)}-${hex.slice(8,12)}-4${hex.slice(13,16)}-a${hex.slice(17,20)}-${hex.slice(20,32)}`
}
;(async () => {
  fs.mkdirSync(output, { recursive: true })
  for (const [id, name] of Object.entries(icons)) {
    const svg = fs.readFileSync(path.join(source, name + '-fill.svg'), 'utf8')
    const face = await sharp(Buffer.from(svg.replace(/currentColor/g, '#23485c')))
      .resize(128, 128).png().toBuffer()
    // A faint ivory edge separates deep-sea blue from the coast's shaded areas.
    // No added frame, altered path geometry, runtime filter or extra draw call.
    const halo = await sharp(Buffer.from(svg.replace(/currentColor/g, '#fff9e8').replace('<svg ', '<svg opacity="0.55" ')))
      .resize(128, 128).blur(1.5).png().toBuffer()
    const png = await sharp(halo).composite([{ input: face }]).png({ compressionLevel: 9 }).toBuffer()
    const target = path.join(output, id + '.png')
    fs.writeFileSync(target, png)
    if (!fs.existsSync(target + '.meta')) {
      const uuid = stableId(id)
      fs.writeFileSync(target + '.meta', JSON.stringify({ ver: '1.0.27', importer: 'image', imported: true,
        uuid, files: ['.json', '.png'], subMetas: { '6c48a': {
          ver: '1.0.22', importer: 'texture', imported: true, uuid: uuid + '@6c48a',
          displayName: id, id: '6c48a', name: 'texture', files: ['.json'], subMetas: {},
          userData: { wrapModeS: 'clamp-to-edge', wrapModeT: 'clamp-to-edge', minfilter: 'linear', magfilter: 'linear',
            mipfilter: 'none', anisotropy: 0, isUuid: true, imageUuidOrDatabaseUri: uuid, visible: false },
        } }, userData: { type: 'texture', hasAlpha: true, fixAlphaTransparencyArtifacts: false, redirect: uuid + '@6c48a' } }, null, 2) + '\n')
    }
    console.log(`${id}: 128 × 128, ${png.length} bytes`)
  }
})().catch(error => { console.error(error); process.exitCode = 1 })
