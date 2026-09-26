// Mechanical offline crop/resize/packing of user-supplied frames. Originals stay in the ZIP.
// Usage: SHARP_MODULE=/path/to/sharp node scripts/build-classic-entry-atlas.cjs /path/to.zip
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const { execFileSync } = require('node:child_process')
const { createHash } = require('node:crypto')
const sharp = require(process.env.SHARP_MODULE || 'sharp')
const ts = require('typescript')
const root = path.resolve(__dirname, '..')
const exportsObject = {}
vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(root, 'assets/scripts/ui/ClassicEntryAnimationPolicy.ts'), 'utf8'),
  { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText, { exports: exportsObject })
const p = exportsObject.CLASSIC_ENTRY_ANIMATION
const zip = process.argv[2]
if (!zip) throw new Error('Pass the source ZIP path')
const entries = execFileSync('unzip', ['-Z1', zip], { encoding: 'utf8' }).split('\n')
  // Both original ZIP and updated Finder export (one extra enclosing folder).
  // Ignore __MACOSX, resource forks and .DS_Store rather than importing them.
  .filter(name => /^(?:entry-classic-animation-final-4s-frames\/)?entry-classic-animation-final-4s\/entry-classic-animation-final-4s_\d{5}\.png$/.test(name)).sort()
if (entries.length !== p.frames) throw new Error(`Expected ${p.frames} frames, found ${entries.length}`)
const out = path.join(root, 'assets/game-assets/effects/lobby-v1')
const perPage = p.columns * p.rows, cellW = p.width + 2 * p.padding, cellH = p.height + 2 * p.padding
function writeImage (name, data) {
  const dest = path.join(out, name + '.jpg')
  fs.writeFileSync(dest, data)
  if (!fs.existsSync(dest + '.meta')) {
    const hex = createHash('sha256').update('guandan-classic-entry:' + name).digest('hex')
    const uuid = `${hex.slice(0,8)}-${hex.slice(8,12)}-4${hex.slice(13,16)}-a${hex.slice(17,20)}-${hex.slice(20,32)}`
    fs.writeFileSync(dest + '.meta', JSON.stringify({ ver:'1.0.27', importer:'image', imported:true, uuid, files:['.json','.jpg'],
      subMetas:{'6c48a':{ver:'1.0.22',importer:'texture',imported:true,uuid:uuid+'@6c48a',displayName:name,id:'6c48a',name:'texture',files:['.json'],subMetas:{},
        userData:{wrapModeS:'clamp-to-edge',wrapModeT:'clamp-to-edge',minfilter:'linear',magfilter:'linear',mipfilter:'none',anisotropy:0,isUuid:true,imageUuidOrDatabaseUri:uuid,visible:false}}},
      userData:{type:'texture',hasAlpha:false,redirect:uuid+'@6c48a'}}, null, 2) + '\n')
  }
  console.log(`${name}: ${data.length} bytes`)
}
;(async () => {
  let composite = []
  for (let i=0; i<entries.length; i++) {
    if (!entries[i].endsWith(`_${String(i).padStart(5,'0')}.png`)) throw new Error('Missing or unordered frame')
    const input = execFileSync('unzip', ['-p',zip,entries[i]], { maxBuffer: 4*1024*1024 })
    const meta = await sharp(input).metadata()
    if (meta.width !== 675 || meta.height !== 900) throw new Error('Unexpected source dimensions')
    // Same .74 top-art cover crop as the approved lobby, excluding baked text.
    const cropHeight = Math.round(meta.width * p.height / p.width)
    const cropTop = Math.round((meta.height * .74 - cropHeight) / 2)
    const cropped = await sharp(input).extract({left:0,top:cropTop,width:meta.width,height:cropHeight}).resize(p.width,p.height).png().toBuffer()
    if (i === 0) writeImage('classic-entry-idle-poster', await sharp(cropped).jpeg({quality:86,chromaSubsampling:'4:4:4'}).toBuffer())
    const padded = await sharp(cropped).extend({top:p.padding,bottom:p.padding,left:p.padding,right:p.padding,extendWith:'copy'}).png().toBuffer()
    const cell = i % perPage
    composite.push({input:padded,left:cell%p.columns*cellW,top:Math.floor(cell/p.columns)*cellH})
    if (cell === perPage-1) {
      const jpg = await sharp({create:{width:cellW*p.columns,height:cellH*p.rows,channels:3,background:'#ffffff'}})
        .composite(composite).jpeg({quality:82,chromaSubsampling:'4:4:4'}).toBuffer()
      writeImage('classic-entry-idle-'+Math.floor(i/perPage), jpg)
      composite = []
    }
  }
})().catch(error=>{console.error(error);process.exitCode=1})
