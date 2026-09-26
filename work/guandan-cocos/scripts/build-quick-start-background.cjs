// Mechanical downsampling only. Preserve the source and existing Cocos UUID.
const fs = require('node:fs')
const path = require('node:path')
const sharp = require(process.env.SHARP_MODULE || 'sharp')
const root = path.resolve(__dirname, '..')
;(async () => {
  const source = path.join(root, 'art-source/ui/lobby/quick-start-beach-source.png')
  const target = path.join(root, 'assets/game-assets/ui/lobby/quick-start-beach.png')
  const input = sharp(source)
  const meta = await input.metadata()
  if (meta.width !== 2172 || meta.height !== 724) throw Error('Unexpected beach source dimensions')
  // Preserve the original cover crop (208:44) without the unused white margins.
  // Keep >3x logical size for high-density screens; never change button geometry.
  const height = Math.round(meta.width * 44 / 208)
  await input.extract({ left: 0, top: Math.round((meta.height-height)/2), width: meta.width, height })
    .resize(832, 176).png({ compressionLevel: 9 }).toFile(target)
  console.log(`Quick-start background: 832 × 176, ${fs.statSync(target).size} bytes`)
})().catch(error => { console.error(error); process.exitCode = 1 })
