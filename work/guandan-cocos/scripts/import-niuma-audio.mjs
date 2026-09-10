import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { access, copyFile, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const sourceRoot = process.env.NIUMA_CLIENT_COCOS_DIR
const sourceRevision = 'f9d037feaef5a80867fd97c8dd39b9a7486fbeca'
const runtimeDirectory = 'assets/game-assets/audio/voices/niuma'
const runtimeRoot = path.join(projectRoot, runtimeDirectory)
const manifestPath = path.join(projectRoot, 'third_party/licenses/niuma-client-cocos-audio.json')
const licensePath = path.join(projectRoot, 'third_party/licenses/NiuMa-client-cocos-MIT.txt')

if (!sourceRoot) {
  throw new Error('Set NIUMA_CLIENT_COCOS_DIR to the checked-out NiuMa client-cocos repository.')
}

const female = 'assets/GuanDan/Audio/ChuPai/Female'
const femalePhrase = 'assets/GuanDan/Audio/Phrase/Female'
const clock = 'assets/GuanDan/Audio/Clock'
const audioRoot = 'assets/GuanDan/Audio'
const phraseMappingSources = [
  'assets/Scripts/Game/GuanDan/GuanDanPlayer.ts',
  'assets/Scripts/Game/GuanDan/SeatPanel.ts',
]
const phraseRoutingSource = 'assets/Scripts/Game/GuanDan/AudioControl.ts'
const sourcePhraseTexts = [
  '快点儿吧，等到花儿都谢了',
  '你的牌打得太好啦',
  '整个一个悲剧啊',
  '一手烂牌臭到底',
  '你家里是开银行的吧',
  '不要吵啦，专心玩牌吧',
  '大清早，鸡都还没叫慌什么',
  '再见了，我会想念大家的',
  '别墨迹，快点出牌',
]
const entries = [
  ...[
    ['2', '2'], ['3', '3'], ['4', '4'], ['5', '5'], ['6', '6'], ['7', '7'], ['8', '8'], ['9', '9'], ['10', '10'],
    ['j', '11'], ['q', '12'], ['k', '13'], ['a', '14'], ['small_joker', '15'], ['big_joker', '16'],
  ].map(([key, source]) => ({ label: `单张 ${key}（女声）`, key: `niuma/single_${key}`, file: `single_${key}.mp3`, sourcePath: `${female}/1_${source}.mp3` })),
  ...[
    ['2', '2'], ['3', '3'], ['4', '4'], ['5', '5'], ['6', '6'], ['7', '7'], ['8', '8'], ['9', '9'], ['10', '10'],
    ['j', '11'], ['q', '12'], ['k', '13'], ['a', '14'],
  ].map(([key, source]) => ({ label: `对子 ${key}（女声）`, key: `niuma/pair_${key}`, file: `pair_${key}.mp3`, sourcePath: `${female}/2_${source}.mp3` })),
  { label: '对子（女声，王对子通用）', key: 'niuma/pair_joker_generic', file: 'pair_joker_generic.mp3', sourcePath: `${female}/duizi.mp3` },
  { label: '三张（女声）', key: 'niuma/triple', file: 'triple.mp3', sourcePath: `${female}/sanzhang.mp3` },
  { label: '顺子（女声）', key: 'niuma/straight', file: 'straight.mp3', sourcePath: `${female}/shunzi.mp3` },
  { label: '三带二（女声）', key: 'niuma/triple_with_pair', file: 'triple_with_pair.mp3', sourcePath: `${female}/sandaier.mp3` },
  { label: '三连对（女声）', key: 'niuma/tube', file: 'tube.mp3', sourcePath: `${female}/sanliandui.mp3` },
  { label: '同花顺（女声）', key: 'niuma/straight_flush', file: 'straight_flush.mp3', sourcePath: `${female}/tonghuashun.mp3` },
  { label: '炸弹（女声）', key: 'niuma/bomb', file: 'bomb.mp3', sourcePath: `${female}/zhadan.mp3` },
  { label: '王炸（女声）', key: 'niuma/king_bomb', file: 'king_bomb.mp3', sourcePath: `${female}/wangzha.mp3` },
  ...[1, 2, 3].map(index => ({ label: `不要 ${index}（女声）`, key: `niuma/pass_${index}`, file: `pass_${index}.mp3`, sourcePath: `${female}/pass${index}.mp3` })),
  ...[0, 1, 2, 3, 4, 5].map(index => ({ label: `倒计时 ${index}`, key: `niuma/countdown_${index}`, file: `countdown_${index}.mp3`, sourcePath: `${clock}/warning${index}.mp3` })),
  { label: '本局开始', key: 'niuma/game_start', file: 'game_start.mp3', sourcePath: `${audioRoot}/gamestart.mp3` },
  { label: '胜利', key: 'niuma/victory', file: 'victory.mp3', sourcePath: `${audioRoot}/win.mp3` },
  { label: '失败', key: 'niuma/defeat', file: 'defeat.mp3', sourcePath: `${audioRoot}/lose.mp3` },
]

const excluded = [
  {
    label: '飞机（旧工程用于钢板）',
    sourcePath: `${female}/feiji.mp3`,
    reason: '项目统一使用“钢板”术语；旧控制器把该文件路由给钢板，文件名则指向“飞机”，禁止接入。',
  },
  {
    label: '压牌',
    sourcePath: `${female}/yapai.mp3`,
    reason: '旧控制器以随机概率播放，缺少能由规则层稳定判定的语义事件，禁止自动接入。',
  },
  {
    label: '旧发牌循环',
    sourcePath: `${audioRoot}/dealcard.ogg`,
    reason: '当前已有用户授权 MP3 发牌音，旧 OGG 既重复又未纳入微信端格式回归，暂不进入运行时。',
  },
  ...[
    [1, '快点儿吧，等到花儿都谢了', '虽属于催牌，但与当前“请尽快出牌”不一一对应且带催促反讽，不进入运行映射。'],
    [3, '整个一个悲剧啊', '负面评价且可能形成嘲讽，与当前六条中性快捷语不符。'],
    [4, '一手烂牌臭到底', '贬损牌局体验，不能安全映射为中性快捷语。'],
    [5, '你家里是开银行的吧', '语境和指向不明确，可能带讽刺意味。'],
    [6, '不要吵啦，专心玩牌吧', '当前没有对应语义，且带有训斥语气。'],
    [7, '大清早，鸡都还没叫慌什么', '时间语境固定且带反讽，不能映射为通用“大家加油”。'],
    [8, '再见了，我会想念大家的', '表达离场，与当前“再来一局”语义相反。'],
    [9, '别墨迹，快点出牌', '虽属于催牌，但“别墨迹”不符合中性文案标准，不进入当前中性白名单。'],
  ].map(([sourcePhraseIndex, sourceText, reason]) => ({
    label: `快捷语 ${sourcePhraseIndex}（女声）`,
    sourcePath: `${femalePhrase}/phrase${String(sourcePhraseIndex).padStart(2, '0')}.ogg`,
    sourcePhraseIndex,
    sourceText,
    reason,
  })),
]

const exists = async filePath => access(filePath).then(() => true, () => false)
const sha256 = buffer => createHash('sha256').update(buffer).digest('hex')
const deterministicUuid = key => {
  const chars = createHash('sha256').update(`niuma-audio:${sourceRevision}:${key}`).digest('hex').slice(0, 32).split('')
  chars[12] = '5'
  chars[16] = ((Number.parseInt(chars[16], 16) & 0x3) | 0x8).toString(16)
  const hex = chars.join('')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

const normalizeText = buffer => buffer.toString('utf8').replace(/\r\n/g, '\n').trimEnd()
let checkedOutRevision
try {
  checkedOutRevision = execFileSync('git', ['-C', sourceRoot, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim()
} catch {
  throw new Error('NiuMa source must be a Git checkout so its pinned revision can be verified.')
}
if (checkedOutRevision !== sourceRevision) throw new Error(`NiuMa source revision mismatch: expected ${sourceRevision}, received ${checkedOutRevision}.`)

const sourceLicense = await readFile(path.join(sourceRoot, 'LICENSE'))
const retainedLicense = await readFile(licensePath)
if (normalizeText(sourceLicense) !== normalizeText(retainedLicense)) throw new Error('Retained NiuMa MIT license does not match the selected source checkout.')

// Do not infer phrase meaning from file numbers. The pinned old client binds
// array index N to phraseNN in playPhrase; verify both halves before copying.
for (const mappingSource of phraseMappingSources) {
  const phraseMappingCode = normalizeText(await readFile(path.join(sourceRoot, mappingSource)))
  let mappingCursor = -1
  for (const text of sourcePhraseTexts) {
    mappingCursor = phraseMappingCode.indexOf(`"${text}"`, mappingCursor + 1)
    if (mappingCursor < 0) throw new Error(`Cannot verify NiuMa quick-chat mapping in ${mappingSource} for: ${text}`)
  }
}
const phraseRoutingCode = normalizeText(await readFile(path.join(sourceRoot, phraseRoutingSource)))
if (!phraseRoutingCode.includes('phrase = phrase + 1;') || !phraseRoutingCode.includes('"Phrase/Female/phrase0"')) {
  throw new Error('Cannot verify NiuMa phrase index-to-Female-file routing.')
}

await mkdir(runtimeRoot, { recursive: true })
// Prune only assets previously owned by this manifest, and only when their
// bytes still match the recorded hash. This keeps newly excluded clips out of
// runtime packages without deleting local edits or unrelated files.
if (await exists(manifestPath)) {
  const previousManifest = JSON.parse(await readFile(manifestPath, 'utf8'))
  const selectedFiles = new Set(entries.map(entry => entry.file))
  for (const previous of previousManifest.assets ?? []) {
    if (selectedFiles.has(previous.file)) continue
    if (path.basename(previous.file) !== previous.file) throw new Error(`Unsafe managed audio path in previous manifest: ${previous.file}`)
    const stalePath = path.join(runtimeRoot, previous.file)
    if (!(await exists(stalePath))) continue
    const staleBuffer = await readFile(stalePath)
    if (sha256(staleBuffer) !== previous.sha256) throw new Error(`Refusing to remove changed runtime asset: ${stalePath}`)
    await rm(stalePath)
    await rm(`${stalePath}.meta`, { force: true })
  }
}
const assets = []
for (const entry of entries) {
  const sourcePath = path.join(sourceRoot, entry.sourcePath)
  const destinationPath = path.join(runtimeRoot, entry.file)
  const sourceBuffer = await readFile(sourcePath)
  const digest = sha256(sourceBuffer)
  if (await exists(destinationPath)) {
    const destinationBuffer = await readFile(destinationPath)
    if (sha256(destinationBuffer) !== digest) throw new Error(`Refusing to overwrite changed runtime asset: ${destinationPath}`)
  } else {
    await copyFile(sourcePath, destinationPath)
  }

  const metaPath = `${destinationPath}.meta`
  if (!(await exists(metaPath))) {
    const extension = path.extname(entry.file)
    const meta = {
      ver: '1.0.0',
      importer: 'audio-clip',
      imported: true,
      uuid: deterministicUuid(entry.key),
      files: ['.json', extension],
      subMetas: {},
      userData: { downloadMode: 0 },
    }
    await writeFile(metaPath, `${JSON.stringify(meta, null, 2)}\n`)
  }

  assets.push({ ...entry, bytes: sourceBuffer.length, sha256: digest })
}

const manifest = {
  schemaVersion: 3,
  source: 'https://github.com/niuma-wj/client-cocos',
  sourceRevision,
  license: 'MIT',
  licenseFile: 'third_party/licenses/NiuMa-client-cocos-MIT.txt',
  selection: 'Complete semantically explicit Female announcements, pass variants, countdown 0-5, game start/results, and the single quick-chat phrase whose runtime text exactly matches the verified Female sentence.',
  mappingEvidence: {
    phraseTextArrays: phraseMappingSources,
    phraseAudioRouter: phraseRoutingSource,
    rule: 'The old client displays zero-based phrase array index N and AudioControl.playPhrase routes it to one-based Phrase/Female/phraseNN.',
  },
  runtimeDirectory,
  assets,
  excluded,
}
await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`)
process.stdout.write(`Imported and verified ${assets.length} NiuMa audio assets.\n`)
