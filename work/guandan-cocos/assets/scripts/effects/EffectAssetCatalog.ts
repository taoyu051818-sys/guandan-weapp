import type { EffectQuality } from './EffectTypes'

export type EffectAssetDecision = 'allow' | 'deny'
export type EffectAssetAvailability = 'bundled' | 'migration-candidate' | 'rejected'
export type EffectAssetKind = 'sprite' | 'animation-clip' | 'animation-graph' | 'prefab' | 'audio' | 'other'

export type EffectAssetLicense = Readonly<{
  spdxId: string
  name: string
  licenseFile: string
  attribution?: string
}>

export type EffectAssetSource = Readonly<{
  packageName: string
  repository: string
  revision?: string
  path: string
}>

export type EffectAssetEntry = Readonly<{
  id: string
  kind: EffectAssetKind
  source: EffectAssetSource
  license: EffectAssetLicense
  /** Lower-case SHA-256 of the reviewed bundled artifact. */
  sha256: string
  decision: EffectAssetDecision
  decisionReason: string
  availability: EffectAssetAvailability
  /** Extension-free path used by the game-assets bundle loader. */
  resourcePath?: string
  allowedQualities: readonly Exclude<EffectQuality, 'off'>[]
}>

const KENNEY_LICENSE: EffectAssetLicense = Object.freeze({
  spdxId: 'CC0-1.0',
  name: 'Creative Commons Zero v1.0 Universal',
  licenseFile: 'assets/game-assets/effects/kenney/LICENSE.txt',
  attribution: 'Kenney Particle Pack 1.1 (credit optional)',
})

const BOMB_V1_LICENSE: EffectAssetLicense = Object.freeze({
  spdxId: 'CC0-1.0',
  name: 'Creative Commons Zero v1.0 Universal',
  licenseFile: 'assets/game-assets/effects/bomb-v1/LICENSE.txt',
  attribution: 'Project-generated Guandan Bomb VFX v1',
})

const LEGACY_LICENSE: EffectAssetLicense = Object.freeze({
  spdxId: 'MIT',
  name: 'MIT License',
  licenseFile: 'third_party/legacy-effects/LICENSE',
  attribution: 'Copyright (c) 2025 NiuMa',
})

const bundledKenney = (id: string, file: string, sha256: string): EffectAssetEntry => Object.freeze({
  id,
  kind: 'sprite',
  source: Object.freeze({ packageName: 'Kenney Particle Pack', repository: 'https://kenney.nl/assets/particle-pack', revision: '1.1', path: `assets/game-assets/effects/kenney/${file}` }),
  license: KENNEY_LICENSE,
  sha256,
  decision: 'allow',
  decisionReason: 'CC0 通用粒子素材，视觉风格已在当前牌桌中验证',
  availability: 'bundled',
  resourcePath: `effects/kenney/${file.replace(/\.png$/, '')}/texture`,
  allowedQualities: Object.freeze(['full', 'reduced'] as const),
})

const bundledBombV1 = (id: string, file: string, sha256: string): EffectAssetEntry => Object.freeze({
  id,
  kind: 'sprite',
  source: Object.freeze({
    packageName: 'Guandan Bomb VFX',
    repository: 'local',
    revision: 'v1-seed-0x20260806',
    path: `assets/game-assets/effects/bomb-v1/${file}`,
  }),
  license: BOMB_V1_LICENSE,
  sha256,
  decision: 'allow',
  decisionReason: '项目内确定性生成的海岛夜局炸弹素材，已通过透明边缘与移动端采样检查',
  availability: 'bundled',
  resourcePath: `effects/bomb-v1/${file.replace(/\.png$/, '')}/texture`,
  allowedQualities: Object.freeze(['full', 'reduced'] as const),
})

const legacyCandidate = (id: string, path: string, kind: EffectAssetKind, sha256: string, reason: string): EffectAssetEntry => Object.freeze({
  id,
  kind,
  source: Object.freeze({ packageName: 'NiuMa GuanDan Cocos Client', repository: 'https://github.com/niuma-wj/client-cocos.git', revision: 'f9d037feaef5a80867fd97c8dd39b9a7486fbeca', path }),
  license: LEGACY_LICENSE,
  sha256,
  decision: 'allow',
  decisionReason: reason,
  availability: 'migration-candidate',
  allowedQualities: Object.freeze(['full', 'reduced'] as const),
})

const rejectedLegacySprite = (id: string, path: string, sha256: string, reason = '旧房间未实际引用，且视觉质量与当前海蓝金色牌桌不一致；仅留哈希审计，不进入构建'): EffectAssetEntry => Object.freeze({
  id,
  kind: 'sprite',
  source: Object.freeze({ packageName: 'NiuMa GuanDan Cocos Client', repository: 'https://github.com/niuma-wj/client-cocos.git', revision: 'f9d037feaef5a80867fd97c8dd39b9a7486fbeca', path }),
  license: LEGACY_LICENSE,
  sha256,
  decision: 'deny',
  decisionReason: reason,
  availability: 'rejected',
  allowedQualities: Object.freeze([]),
})

/**
 * Runtime-facing subset of the audited baseline in
 * `third_party/legacy-effects/manifest.json`. An allowed migration candidate
 * is not runtime-loadable until a reviewed copy receives a `resourcePath`.
 */
export const DEFAULT_EFFECT_ASSET_MANIFEST: readonly EffectAssetEntry[] = Object.freeze([
  bundledKenney('common.flame', 'flame.png', '366678a08a7d22ebb87baa7b42005aaaeb0fd51ab751f2d4e7c9edfa61a33e38'),
  bundledKenney('common.impact-ring', 'impact-ring.png', '925b8ac284436f74f9cadf0ecd058da1c08fba65c098e4e34fd220603022f02e'),
  bundledKenney('common.smoke', 'smoke.png', '2db2f69874cdb1e5203f2f86803d5debde30402590cf50a810afaba882184616'),
  bundledBombV1('bomb.body', 'bomb-body.png', '7ad5d3ecc4715e5bc9809b161b7707809631dc6769c56e5c77f20e951b29ebef'),
  bundledBombV1('bomb.trail', 'trail-soft.png', 'd5ef21587ab4248dc55d60475f9adfa769dc146d0c5ab14fb4e1574ebbfc9949'),
  bundledBombV1('bomb.hot-core', 'hot-core.png', 'bf79dac949bc0ec4f6b2111d926a56a169669beba0199b3041e8ca68237bf4c5'),
  bundledBombV1('bomb.spark-streak', 'spark-streak.png', 'd17636715dd07c3fdd14aad510f4e6ad2abced7fd4354496b9a699f5c168383d'),
  bundledBombV1('bomb.debris', 'debris-shard.png', '10da753e1a9168bf147b0917d254220981642d5a7bac9ce85bccf6dd6ac04f5c'),
  bundledBombV1('bomb.noise', 'noise-tile.png', 'bcfe8996bbdbf24e79f308dce6ef8673befaa8baf8afceabbb2059b11a9cc359'),

  legacyCandidate('legacy.deal.clip', 'assets/GuanDan/Room/Main/deal_card.anim', 'animation-clip', '3a19b905c29c8da0ea8e2b167272a3aeecaf682dcc2b7d63e844c684cf6fc13f', '独立发牌时间曲线，可重定向到当前牌背节点'),
  legacyCandidate('legacy.deal.graph', 'assets/GuanDan/Room/Main/deal_card.animgraph', 'animation-graph', '8a48d212a049997b9c585ddf8097ca00b1aa3effe55f22a00cbb913ebe467a08', '与发牌动画配套，迁移时需要重新绑定当前参数'),
  legacyCandidate('legacy.chat.left.clip', 'assets/Talk/TalkLeft.anim', 'animation-clip', '1c0ad1d6a7a4480c87731f54b92cbb41dbdcb5754a8e9c671b84a131b9bf14a1', '左右座位气泡的独立序列帧节奏'),
  legacyCandidate('legacy.chat.right.clip', 'assets/Talk/TalkRight.anim', 'animation-clip', '1ecc7a33858359688184fddca93a60d68f9a96a61780000ee727d4cbb6923111', '左右座位气泡的独立序列帧节奏'),
  legacyCandidate('legacy.trusteeship.clip', 'assets/Game/TuoGuan/ani.anim', 'animation-clip', '83bd115f667343ead28e8f24351531014f0dd1999f1dd51c0e51eb591a729c0b', '独立托管提示动画，可在改色后复用'),

  rejectedLegacySprite('legacy.rejected.chat.left.01', 'assets/Talk/TalkLeft01.png', '1a9ae3fbef0e610c29a8eaafb503e3a0260b67f6139aa3bce0fb123019273301', '旧式语音指示器不符合当前视觉系统；只提取动画节奏'),
  rejectedLegacySprite('legacy.rejected.chat.left.02', 'assets/Talk/TalkLeft02.png', '3614041f54c3daaa005e204b9cda9ccafce21e40f494569fa3412c9816d87063', '旧式语音指示器不符合当前视觉系统；只提取动画节奏'),
  rejectedLegacySprite('legacy.rejected.chat.left.03', 'assets/Talk/TalkLeft03.png', '651ed487f7378af2638ae5dbc6334976ed409a81825fa4fbe875272ee24d1e4a', '旧式语音指示器不符合当前视觉系统；只提取动画节奏'),
  rejectedLegacySprite('legacy.rejected.chat.right.01', 'assets/Talk/TalkRight01.png', '07eccb922490bd39cbc595b956ceba501c79920f34aad1d97f04f643cee1cb2d', '旧式语音指示器不符合当前视觉系统；只提取动画节奏'),
  rejectedLegacySprite('legacy.rejected.chat.right.02', 'assets/Talk/TalkRight02.png', '502de1829f981f7eb5c960a90043bf35a86d6c363c828d663ec5aa80549b77c8', '旧式语音指示器不符合当前视觉系统；只提取动画节奏'),
  rejectedLegacySprite('legacy.rejected.chat.right.03', 'assets/Talk/TalkRight03.png', '06d1f87bc31820fd6d9aec67b879735a0cd4f38df22812fda46d68bd1f2fd270', '旧式语音指示器不符合当前视觉系统；只提取动画节奏'),
  rejectedLegacySprite('legacy.rejected.trusteeship.cancel', 'assets/Game/TuoGuan/tip_qu_xiao.png', '3e9a9bf740e8198a2d99dfb36e4d05d7a38f09e7f4877351e3df0b7a8345bf8a', '旧蓝色托管条幅不符合当前视觉系统；使用代码动画重做'),
  rejectedLegacySprite('legacy.rejected.trusteeship.label', 'assets/Game/TuoGuan/tuo_guan.png', '8c96db7d0f8ee1927e92216b07a97fca2ec089ece2f57bdc70f49ee84efedc50', '旧蓝色托管图标不符合当前视觉系统；使用代码动画重做'),
  rejectedLegacySprite('legacy.rejected.trusteeship.background', 'assets/Game/TuoGuan/tuo_guan_bg.png', 'c063e91e2e3f68e3e81655a19224f5053b5f6c77f780481838cb002f0f4a4951', '旧蓝色托管背景不符合当前视觉系统；使用代码动画重做'),

  rejectedLegacySprite('legacy.rejected.blast.imprint', 'assets/GuanDan/Room/Effect/Blast/DustYinJi.png', '265e2b8a5f122fa11a7961ce58bd433988bf7eba6a3f82d4eb72cc07b842fedf'),
  rejectedLegacySprite('legacy.rejected.blast.nuclear-beam', 'assets/GuanDan/Room/Effect/Blast/核爆炸_光柱.png', '013f373b1b83983ae30b374e1be2ff1dffcc76ebfda6cd05988edcea3f93914c'),
  rejectedLegacySprite('legacy.rejected.blast.mushroom', 'assets/GuanDan/Room/Effect/Blast/核爆炸_蘑菇云.png', '951505957aca7583e158ea2991c7472f6e6ef6cf593c86db46620f043e33160f'),
  rejectedLegacySprite('legacy.rejected.blast.background', 'assets/GuanDan/Room/Effect/Blast/爆炸_BG.png', '3a3c7ad7962d84b1122ac6ec15489a265ae0aa280ace1db40f8e92bcdcb658b3'),
  rejectedLegacySprite('legacy.rejected.blast.beam', 'assets/GuanDan/Room/Effect/Blast/爆炸_光柱.png', '238254315787401292c0fae93abc4051ba6a1ea1ca96ade4ddf8d51b7d07d8eb'),
  rejectedLegacySprite('legacy.rejected.blast.ring', 'assets/GuanDan/Room/Effect/Blast/爆炸_光环.png', 'e17c9284769b35f16b7a08c4b4060a95950097693215b7a214f65710567ea7ea'),
  rejectedLegacySprite('legacy.rejected.blast.orb', 'assets/GuanDan/Room/Effect/Blast/爆炸_光球.png', '4e983a6e4859953aef5c2d7b637afc8c15efd23bf74e8a80262d444cc28dddcb'),
  rejectedLegacySprite('legacy.rejected.blast.spark', 'assets/GuanDan/Room/Effect/Blast/爆炸_火星.png', 'afded1dee50f58ac41a25d9125a64583bc11ca08743eab41acca4c82c212bb72'),
  rejectedLegacySprite('legacy.rejected.blast.dust', 'assets/GuanDan/Room/Effect/Blast/爆炸_灰尘.png', '54bb0bbc7a4f9142d0829ec3b75048ca4f0b35b8dcffd75ca411f5dcdfb45b0e'),
  rejectedLegacySprite('legacy.rejected.blast.smoke', 'assets/GuanDan/Room/Effect/Blast/爆炸_烟.png', '882c44f3e7c2f2403d1d502661727dc648a4e58b298889252cd94d01338590ac'),
  rejectedLegacySprite('legacy.rejected.blast.hot', 'assets/GuanDan/Room/Effect/Blast/爆炸_白热化.png', '7579b5bed9990b2e492fdc7209c57ab845ba68b1218be2111e98463f3a086235'),
  rejectedLegacySprite('legacy.rejected.flush.title', 'assets/GuanDan/Room/Effect/Flush/同花顺.png', '5e38a6fff7b9835a692b165394c9aada37a90ebabd4881e854b64f8ebfd21e01'),
  rejectedLegacySprite('legacy.rejected.flush.particle', 'assets/GuanDan/Room/Effect/Flush/同花顺粒子.png', '718e113149dbc8dfe9b0c46741dbe3cf7bb6b881eaa3d950c46b2020747a71e0'),
  rejectedLegacySprite('legacy.rejected.plane.flame', 'assets/GuanDan/Room/Effect/Plane/huojianyan.png', '7de31af2eb908132ec66539bafc3958fe34f7eeef45b6e6958012b08665e5be7'),
  rejectedLegacySprite('legacy.rejected.plane.body', 'assets/GuanDan/Room/Effect/Plane/掼蛋飞机.png', 'a0afc83bef6f8dac216d2b42eafd4aab47e74bceaba97144390b0c5e0305d947'),

  rejectedLegacySprite('legacy.rejected.grade.frame', 'assets/GuanDan/Room/Desk/grade_point_frame.png', 'a89c2666214a03a4c95ea32476e00581e8d074dc500fcbb5223c6e77fd242ba0', '旧橙蓝拟物级分组件与当前视觉系统不一致；级分弹出仅迁移时间曲线'),
  rejectedLegacySprite('legacy.rejected.grade.indicator', 'assets/GuanDan/Room/Desk/grade_point_indicator.png', 'bd3b54b0a1b5ca9cfdd0a78bca363d968b4b73195992e245ca8e90a7fee8fe51', '旧橙蓝拟物级分组件与当前视觉系统不一致；级分弹出仅迁移时间曲线'),
  rejectedLegacySprite('legacy.rejected.grade.widget', 'assets/GuanDan/Room/Desk/grade_point_widget.png', '0e83c0b091d830f07704186b2963757b8c1860ad1cab1e887d5d77dcd927dad6', '旧橙蓝拟物级分组件与当前视觉系统不一致；级分弹出仅迁移时间曲线'),
  rejectedLegacySprite('legacy.rejected.result.exit', 'assets/GuanDan/Room/Result/button_exit.png', 'beee9c1ee3da9332944a9e043ebde5ef252912e94d283141b5c713fc6b476495'),
  rejectedLegacySprite('legacy.rejected.result.next', 'assets/GuanDan/Room/Result/button_next.png', 'a6cf9b7aea631c183d2a825b044b78ff1c7a44fa545d9bc38a59e168c8817748'),
  rejectedLegacySprite('legacy.rejected.result.enemy', 'assets/GuanDan/Room/Result/flag_enemy.png', 'ff3aba124825bb53cdc911ccfb04972227c7f6c20f519bdb50bfe85bbe1b9233'),
  rejectedLegacySprite('legacy.rejected.result.friend', 'assets/GuanDan/Room/Result/flag_friend.png', 'be4db4d77d3c32d15f519ec90248c51faa102ac48ab189d0e4ed012c729d50b3'),
  rejectedLegacySprite('legacy.rejected.result.lose-flag', 'assets/GuanDan/Room/Result/flag_lose.png', '737db614690c26195e8cf1a75928c12f48e711db9684fe505a420d812c7da81f'),
  rejectedLegacySprite('legacy.rejected.result.win-flag', 'assets/GuanDan/Room/Result/flag_win.png', '9b07ac11b7afeedc5e90c9ea2ac16ff260b73a32316a3c4b3d9e53db88e9d72c'),
  rejectedLegacySprite('legacy.rejected.result.frame', 'assets/GuanDan/Room/Result/frame.png', 'c38d238b8c6f048dc41892346d8fa0f29640d175ef26fc05a79e5b62a64d2e33'),
  rejectedLegacySprite('legacy.rejected.result.grade-next', 'assets/GuanDan/Room/Result/grade_point_next.png', '7e20382a9e688f182dd3a6352c2c904ca41a8ab7e99c0efdae819a9844e4ba58'),
  rejectedLegacySprite('legacy.rejected.result.light', 'assets/GuanDan/Room/Result/light.png', '4378d379e334a17acaae1cecbe116485efb29e9c9edbfb74f46b975951c0a626'),
  rejectedLegacySprite('legacy.rejected.result.player-bottom', 'assets/GuanDan/Room/Result/player_bottom.png', 'dda34c74ce5b6fd169a74ed464f3adf739468dde3dbfa370d41cf70c92a87c6c'),
  rejectedLegacySprite('legacy.rejected.result.lose-title', 'assets/GuanDan/Room/Result/title_lose.png', '17f831715dc1f40257c610a14456c3b4048873cc04c09c485924664057937edf'),
  rejectedLegacySprite('legacy.rejected.result.win-title', 'assets/GuanDan/Room/Result/title_win.png', '29c517097f0f9d9a310923c509bd6ab697baa0c6e35eec3053bfaa4b3ed27fd1'),
])

/** Runtime index plus auditable allow/deny inventory. */
export class EffectAssetCatalog {
  private readonly entries = new Map<string, EffectAssetEntry>()

  public constructor (entries: readonly EffectAssetEntry[] = DEFAULT_EFFECT_ASSET_MANIFEST) { this.register(entries) }

  public get size (): number { return this.entries.size }

  public register (entryOrEntries: EffectAssetEntry | readonly EffectAssetEntry[], replace = false): void {
    const entries = Array.isArray(entryOrEntries) ? entryOrEntries : [entryOrEntries]
    const incomingIds = new Set<string>()
    entries.forEach(entry => {
      if (incomingIds.has(entry.id)) throw new Error(`Duplicate effect asset in registration batch: ${entry.id}`)
      incomingIds.add(entry.id)
    })
    entries.forEach(entry => this.validate(entry, replace))
    entries.forEach(entry => this.entries.set(entry.id, entry))
  }

  public get (id: string): EffectAssetEntry | null { return this.entries.get(id) ?? null }
  public list (): EffectAssetEntry[] { return Array.from(this.entries.values()) }
  public listAllowed (): EffectAssetEntry[] { return this.list().filter(entry => entry.decision === 'allow') }
  public listDenied (): EffectAssetEntry[] { return this.list().filter(entry => entry.decision === 'deny') }

  public resolve (id: string, quality: EffectQuality): EffectAssetEntry | null {
    const entry = this.get(id)
    if (!entry || quality === 'off' || entry.decision !== 'allow' || !entry.allowedQualities.includes(quality)) return null
    return entry
  }

  public resolveRuntimePath (id: string, quality: EffectQuality): string | null {
    const entry = this.resolve(id, quality)
    return entry?.availability === 'bundled' ? entry.resourcePath ?? null : null
  }

  public verifyHash (id: string, actualSha256: string): boolean {
    const expected = this.get(id)?.sha256
    return Boolean(expected && expected === actualSha256.trim().toLowerCase())
  }

  public clear (): void { this.entries.clear() }

  private validate (entry: EffectAssetEntry, replace: boolean): void {
    if (!entry.id.trim()) throw new Error('Effect asset id cannot be empty')
    if (!/^[a-f0-9]{64}$/.test(entry.sha256)) throw new Error(`Invalid SHA-256 for effect asset: ${entry.id}`)
    if (!replace && this.entries.has(entry.id)) throw new Error(`Effect asset already registered: ${entry.id}`)
    if (entry.decision === 'deny' && entry.allowedQualities.length) throw new Error(`Denied effect asset cannot allow qualities: ${entry.id}`)
    if (entry.availability === 'bundled' && !entry.resourcePath) throw new Error(`Bundled effect asset requires resourcePath: ${entry.id}`)
  }
}
