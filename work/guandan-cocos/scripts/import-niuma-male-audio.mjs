import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { access, copyFile, mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const sourceRoot = process.env.NIUMA_CLIENT_COCOS_DIR
const sourceRevision = 'f9d037feaef5a80867fd97c8dd39b9a7486fbeca'
const male = 'assets/GuanDan/Audio/ChuPai/Male'
const malePhrase = 'assets/GuanDan/Audio/Phrase/Male'
const runtimeDirectory = 'assets/game-assets/audio/voices/niuma-male'
const runtimeRoot = path.join(projectRoot, runtimeDirectory)
const manifestPath = path.join(projectRoot, 'third_party/licenses/niuma-client-cocos-male-audio.json')
const retainedLicensePath = path.join(projectRoot, 'third_party/licenses/NiuMa-client-cocos-MIT.txt')
const phraseRoutingPath = 'assets/Scripts/Game/GuanDan/AudioControl.ts'
const phraseMappingPaths = ['assets/Scripts/Game/GuanDan/GuanDanPlayer.ts', 'assets/Scripts/Game/GuanDan/SeatPanel.ts']
const exactQuickChatText = '你的牌打得太好啦'

if (!sourceRoot) throw new Error('Set NIUMA_CLIENT_COCOS_DIR to the checked-out NiuMa client-cocos repository.')

const entries = [
  ...[
    ['2', '2'], ['3', '3'], ['4', '4'], ['5', '5'], ['6', '6'], ['7', '7'], ['8', '8'], ['9', '9'], ['10', '10'],
    ['j', '11'], ['q', '12'], ['k', '13'], ['a', '14'], ['small_joker', '15'], ['big_joker', '16'],
  ].map(([key, source]) => ({ label: `单张 ${key}（男声）`, key: `niuma-male/single_${key}`, file: `single_${key}.mp3`, sourcePath: `${male}/1_${source}.mp3` })),
  ...[
    ['2', '2'], ['3', '3'], ['4', '4'], ['5', '5'], ['6', '6'], ['7', '7'], ['8', '8'], ['9', '9'], ['10', '10'],
    ['j', '11'], ['q', '12'], ['k', '13'], ['a', '14'],
  ].map(([key, source]) => ({ label: `对子 ${key}（男声）`, key: `niuma-male/pair_${key}`, file: `pair_${key}.mp3`, sourcePath: `${male}/2_${source}.mp3` })),
  { label: '对子（男声，王对子通用）', key: 'niuma-male/pair_joker_generic', file: 'pair_joker_generic.mp3', sourcePath: `${male}/duizi.mp3` },
  { label: '三张（男声）', key: 'niuma-male/triple', file: 'triple.mp3', sourcePath: `${male}/sanzhang.mp3` },
  { label: '顺子（男声）', key: 'niuma-male/straight', file: 'straight.mp3', sourcePath: `${male}/shunzi.mp3` },
  { label: '三带二（男声）', key: 'niuma-male/triple_with_pair', file: 'triple_with_pair.mp3', sourcePath: `${male}/sandaier.mp3` },
  { label: '三连对（男声）', key: 'niuma-male/tube', file: 'tube.mp3', sourcePath: `${male}/sanliandui.mp3` },
  { label: '同花顺（男声）', key: 'niuma-male/straight_flush', file: 'straight_flush.mp3', sourcePath: `${male}/tonghuashun.mp3` },
  { label: '炸弹（男声）', key: 'niuma-male/bomb', file: 'bomb.mp3', sourcePath: `${male}/zhadan.mp3` },
  { label: '王炸（男声）', key: 'niuma-male/king_bomb', file: 'king_bomb.mp3', sourcePath: `${male}/wangzha.mp3` },
  ...[1, 2, 3].map(index => ({ label: `不要 ${index}（男声）`, key: `niuma-male/pass_${index}`, file: `pass_${index}.mp3`, sourcePath: `${male}/pass${index}.mp3` })),
  {
    label: '快捷语：称赞出牌（男声）', key: 'niuma-male/chat_nice_play', file: 'chat_nice_play.ogg',
    sourcePath: `${malePhrase}/phrase02.ogg`, sourcePhraseIndex: 2, sourceText: exactQuickChatText,
    runtimePhraseId: 'nice-play', runtimeText: exactQuickChatText,
  },
]

const excluded = [
  { sourcePath: `${male}/feiji.mp3`, reason: '“飞机”与当前“钢板”术语冲突。' },
  { sourcePath: `${male}/yapai.mp3`, reason: '旧客户端随机播放，当前没有稳定且权威的“压住上一手”语义事件。' },
  ...[1, 3, 4, 5, 6, 7, 8, 9].map(index => ({
    sourcePath: `${malePhrase}/phrase${String(index).padStart(2, '0')}.ogg`,
    sourcePhraseIndex: index,
    reason: '与当前中性快捷语白名单没有逐字一致的安全映射。',
  })),
]

const exists = async filePath => access(filePath).then(() => true, () => false)
const sha256 = buffer => createHash('sha256').update(buffer).digest('hex')
const normalizeText = buffer => buffer.toString('utf8').replace(/\r\n/g, '\n').trimEnd()
const deterministicUuid = key => {
  const chars = createHash('sha256').update(`niuma-male-audio:${sourceRevision}:${key}`).digest('hex').slice(0, 32).split('')
  chars[12] = '5'
  chars[16] = ((Number.parseInt(chars[16], 16) & 0x3) | 0x8).toString(16)
  const hex = chars.join('')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

let checkedOutRevision
try { checkedOutRevision = execFileSync('git', ['-C', sourceRoot, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim() } catch {
  throw new Error('NiuMa source must be a Git checkout so its pinned revision can be verified.')
}
if (checkedOutRevision !== sourceRevision) throw new Error(`NiuMa source revision mismatch: expected ${sourceRevision}, received ${checkedOutRevision}.`)
if (normalizeText(await readFile(path.join(sourceRoot, 'LICENSE'))) !== normalizeText(await readFile(retainedLicensePath))) {
  throw new Error('Retained NiuMa MIT license does not match the selected source checkout.')
}
const router = normalizeText(await readFile(path.join(sourceRoot, phraseRoutingPath)))
if (!router.includes('male ? "ChuPai/Male/" : "ChuPai/Female/"') || !router.includes('male ? "Phrase/Male/phrase0"')) throw new Error('Cannot verify the NiuMa Male routing.')
for (const mappingPath of phraseMappingPaths) {
  if (!normalizeText(await readFile(path.join(sourceRoot, mappingPath))).includes(`"${exactQuickChatText}"`)) throw new Error(`Cannot verify quick-chat copy in ${mappingPath}.`)
}

await mkdir(runtimeRoot, { recursive: true })
const directoryMetaPath = `${runtimeRoot}.meta`
if (!(await exists(directoryMetaPath))) {
  await writeFile(directoryMetaPath, `${JSON.stringify({
    ver: '1.2.0', importer: 'directory', imported: true, uuid: deterministicUuid('directory'), files: [], subMetas: {}, userData: {},
  }, null, 2)}\n`)
}

const assets = []
for (const entry of entries) {
  const sourceBuffer = await readFile(path.join(sourceRoot, entry.sourcePath))
  const digest = sha256(sourceBuffer)
  const destinationPath = path.join(runtimeRoot, entry.file)
  if (await exists(destinationPath)) {
    if (sha256(await readFile(destinationPath)) !== digest) throw new Error(`Refusing to overwrite changed runtime asset: ${destinationPath}`)
  } else await copyFile(path.join(sourceRoot, entry.sourcePath), destinationPath)
  const metaPath = `${destinationPath}.meta`
  if (!(await exists(metaPath))) {
    await writeFile(metaPath, `${JSON.stringify({
      ver: '1.0.0', importer: 'audio-clip', imported: true, uuid: deterministicUuid(entry.key),
      files: ['.json', path.extname(entry.file)], subMetas: {}, userData: { downloadMode: 0 },
    }, null, 2)}\n`)
  }
  assets.push({ ...entry, bytes: sourceBuffer.length, sha256: digest })
}

await writeFile(manifestPath, `${JSON.stringify({
  schemaVersion: 1, source: 'https://github.com/niuma-wj/client-cocos', sourceRevision, license: 'MIT',
  licenseFile: 'third_party/licenses/NiuMa-client-cocos-MIT.txt', runtimeDirectory,
  selection: 'Optional Male voice pack; never mixed with the default Female human-voice fallback chain.',
  routingEvidence: { phraseAndPlayRouter: phraseRoutingPath, phraseTextArrays: phraseMappingPaths },
  assets, excluded,
}, null, 2)}\n`)
process.stdout.write(`Imported and verified ${assets.length} NiuMa Male audio assets.\n`)
