import { BlockInputEvents, Color, Label, Node, Vec3 } from 'cc'
import type { GameSession } from '../../session/GameSession'
import type { ScreenAdapter } from '../../ui/ScreenAdapter'
import type { RuntimeUiFactory } from '../../ui/RuntimeUiFactory'
import type { PageRouter } from '../PageRouter'

const RULE_PAGES = Object.freeze([
  Object.freeze({
    icon: '♠',
    title: '基础与目标',
    content: '四人分成两队，对面座位互为队友，使用两副牌共108张。\n每局按座位顺序轮流行动；首家可出任意合法牌型，其他玩家依次压牌或选择不出。\n一轮中其余三家都不出时，最后出牌者获得下一轮首出权。先出完手牌者为头游。',
  }),
  Object.freeze({
    icon: '♦',
    title: '牌型与识别',
    content: '普通牌型：单张、对子、三张、三带二。\n连续牌型：五张顺子、三连对（连续三组对子）、钢板（连续两组三张）。\n特殊牌型：四张及以上同点数炸弹、五张同花顺、四王炸。\n除红桃级牌“逢人配”外，其他花色的级牌不能直接组成连续牌型；一次选牌必须组成一种完整合法牌型。',
  }),
  Object.freeze({
    icon: '↕',
    title: '大小与压牌',
    content: '普通牌只能用相同牌型、相同张数比较，比较该牌型的主点数。\n炸弹可以压普通牌；同为炸弹时先比较张数，再比较点数。\n经典规则中，同花顺按五张半炸弹比较：高于五张炸弹、低于六张及以上炸弹。\n四王炸为最高牌型。没有合法更大牌时应选择不出。',
  }),
  Object.freeze({
    icon: '★',
    title: '出牌与配合',
    content: '红桃级牌是“逢人配”，可代替除大小王外的点数，系统会显示它代表的牌。\n队友坐在正对面：队友接近出完时应优先送出其可能接住的小牌，避免无意义压队友牌。\n对手接近出完时要控制出牌权，必要时用炸弹拦截。提示只给合法候选，最终选择仍由玩家确认。',
  }),
  Object.freeze({
    icon: '杯',
    title: '升级与胜负',
    content: '头游与队友包揽前二为“双下”，本队升3级；队友第三名升2级；队友末游升1级。\n下一局通常由末游向头游进贡最大合法牌，赢家还一张不高于10的牌；双下时双方各进贡一次。\n单贡方持有至少两张王可抗贡；双贡两人合计四张王，或合计至少两张大王，也可抗贡。打到A级后仍需取得至少升2级的结果才能“过A”。',
  }),
] as const)

export type SettingsRulesPageDependencies = {
  router: PageRouter
  screen: ScreenAdapter
  session: GameSession
  renderMenu: () => void
  showMoreMenu: () => void
}

/** Owns the rules modal and the persistent game-settings page. */
export class SettingsRulesPageDomain {
  private rulesPage = 0
  private rulesDialogVisible = false

  public constructor (private readonly dependencies: SettingsRulesPageDependencies) {}

  public get rulesVisible (): boolean { return this.rulesDialogVisible }

  public dismissRulesState (): void { this.rulesDialogVisible = false }

  public showRules (): void {
    this.rulesDialogVisible = true
    this.rulesPage = Math.max(0, Math.min(RULE_PAGES.length - 1, this.rulesPage))
    const rule = RULE_PAGES[this.rulesPage]
    const ui = this.dependencies.router.openModal('rules')
    const safeWidth = this.dependencies.screen.safeSize().x
    const safeHeight = this.dependencies.screen.safeSize().y
    const centerX = (this.dependencies.screen.safeLeftX() + this.dependencies.screen.safeRightX()) / 2
    const centerY = (this.dependencies.screen.safeBottomY() + this.dependencies.screen.safeTopY()) / 2
    const modalWidth = Math.min(790, safeWidth - 42)
    const modalHeight = Math.min(510, safeHeight - 34)
    const compact = modalHeight < 430

    const shade = ui.panel('RulesModalShade', 0, 0, this.dependencies.screen.viewport.width, this.dependencies.screen.viewport.height, {
      fill: new Color(0, 4, 7, 168), lineWidth: 0, radius: 0,
    })
    shade.addComponent(BlockInputEvents)
    const modal = ui.panel('RulesModal', centerX, centerY, modalWidth, modalHeight, {
      fill: new Color(12, 34, 31, 246), stroke: new Color(234, 194, 89, 250), lineWidth: 3, radius: 8,
    })
    modal.addComponent(BlockInputEvents)

    const headerY = centerY + modalHeight / 2 - (compact ? 46 : 54)
    const iconSize = compact ? 42 : 48
    ui.panel('RulesPageIcon', centerX - modalWidth / 2 + 54, headerY, iconSize, iconSize, {
      fill: new Color(180, 126, 35, 245), stroke: new Color(255, 231, 142, 255), lineWidth: 2, radius: iconSize / 2,
    })
    ui.outlinedLabel(rule.icon, centerX - modalWidth / 2 + 54, headerY, compact ? 24 : 28, {
      width: iconSize - 6, height: iconSize - 6, color: new Color(255, 247, 210), outlineColor: new Color(67, 40, 17), outlineWidth: 2,
    })
    ui.outlinedLabel(`掼蛋规则 · ${rule.title}`, centerX, headerY, compact ? 27 : 32, {
      width: modalWidth - 190, height: 48, color: new Color(255, 226, 132), outlineColor: new Color(46, 28, 18), outlineWidth: 3,
    })
    ui.outlinedLabel(`第 ${this.rulesPage + 1} / ${RULE_PAGES.length} 页`, centerX + modalWidth / 2 - 91, headerY, 20, {
      width: 112, height: 30, color: new Color(216, 232, 222), outlineColor: new Color(24, 42, 37), outlineWidth: 2,
    })

    const bodyHeight = modalHeight - (compact ? 150 : 174)
    const body = ui.outlinedLabel(rule.content, centerX, centerY - 4, compact ? 20 : 22, {
      width: modalWidth - 72, height: bodyHeight, color: new Color(245, 239, 215), outlineColor: new Color(24, 35, 31), outlineWidth: 2,
    })
    body.horizontalAlign = Label.HorizontalAlign.LEFT
    body.verticalAlign = Label.VerticalAlign.TOP

    this.compactButton(ui, '×', centerX + modalWidth / 2 - 28, centerY + modalHeight / 2 - 28, 38, 38, 24, () => this.closeRules())
    const navigationY = centerY - modalHeight / 2 + (compact ? 31 : 36)
    const previous = ui.button('RulesPrevious', '<  上一页', centerX - 115, 190, compact ? 44 : 46, 22, {
      fill: new Color(31, 61, 58, 238), pressedFill: new Color(57, 89, 77, 245), stroke: new Color(225, 183, 74, 235),
      textColor: new Color(255, 239, 180), textOutlineWidth: 2, disabled: this.rulesPage === 0, radius: 7,
    })
    previous.setPosition(new Vec3(centerX - 115, navigationY, 0))
    if (this.rulesPage > 0) previous.on(Node.EventType.TOUCH_END, () => { this.rulesPage -= 1; this.showRules() })
    const next = ui.button('RulesNext', '下一页  >', centerX + 115, 190, compact ? 44 : 46, 22, {
      fill: new Color(31, 61, 58, 238), pressedFill: new Color(57, 89, 77, 245), stroke: new Color(225, 183, 74, 235),
      textColor: new Color(255, 239, 180), textOutlineWidth: 2, disabled: this.rulesPage === RULE_PAGES.length - 1, radius: 7,
    })
    next.setPosition(new Vec3(centerX + 115, navigationY, 0))
    if (this.rulesPage + 1 < RULE_PAGES.length) next.on(Node.EventType.TOUCH_END, () => { this.rulesPage += 1; this.showRules() })
  }

  public showSettings (): void {
    this.dismissRulesState()
    const snapshot = this.dependencies.session.snapshot
    const ui = this.dependencies.router.open('settings')
    ui.menuLabel('游戏设置', 0, 215, 42)
    const qualityName = snapshot.settings.effectQuality === 'full' ? '完整' : snapshot.settings.effectQuality === 'reduced' ? '精简' : '关闭'
    ui.menuLabel(`手牌：${snapshot.settings.sortOrder === 'desc' ? '大牌在左' : '小牌在左'}    规则：${snapshot.settings.rulePreset === 'classic' ? '经典' : '竞技'}\n特效：${qualityName}    震动：${snapshot.settings.hapticEnabled ? '开' : '关'}    报牌：${snapshot.settings.voicePack === 'male' ? '男声' : '女声'}`, 0, 155, 20)
    const order = this.pageButton(ui, '切换手牌排序', 82, () => { this.dependencies.session.updateSettings({ sortOrder: snapshot.settings.sortOrder === 'desc' ? 'asc' : 'desc' }); this.showSettings() })
    const rule = this.pageButton(ui, '切换规则预设', 82, () => { this.dependencies.session.updateSettings({ rulePreset: snapshot.settings.rulePreset === 'classic' ? 'tournament' : 'classic' }); this.showSettings() })
    const sound = this.pageButton(ui, snapshot.settings.soundEnabled ? '关闭音效' : '开启音效', 20, () => { this.dependencies.session.updateSettings({ soundEnabled: !snapshot.settings.soundEnabled }); this.showSettings() })
    const bgm = this.pageButton(ui, snapshot.settings.bgmEnabled ? '关闭音乐' : '开启音乐', 20, () => { this.dependencies.session.updateSettings({ bgmEnabled: !snapshot.settings.bgmEnabled }); this.showSettings() })
    const soundVolume = this.pageButton(ui, `音效音量 ${Math.round(snapshot.settings.volume * 100)}%`, -42, () => { this.dependencies.session.updateSettings({ volume: Number(((snapshot.settings.volume + 0.1) % 1.1).toFixed(1)) }); this.showSettings() })
    const musicVolume = this.pageButton(ui, `音乐音量 ${Math.round(snapshot.settings.bgmVolume * 100)}%`, -42, () => { this.dependencies.session.updateSettings({ bgmVolume: Number(((snapshot.settings.bgmVolume + 0.1) % 1.1).toFixed(1)) }); this.showSettings() })
    const effectQuality = this.pageButton(ui, `特效质量 ${qualityName}`, -104, () => {
      const qualities = ['full', 'reduced', 'off'] as const
      this.dependencies.session.updateSettings({ effectQuality: qualities[(qualities.indexOf(snapshot.settings.effectQuality) + 1) % qualities.length] })
      this.showSettings()
    })
    const haptic = this.pageButton(ui, snapshot.settings.hapticEnabled ? '关闭震动' : '开启震动', -104, () => { this.dependencies.session.updateSettings({ hapticEnabled: !snapshot.settings.hapticEnabled }); this.showSettings() })
    const voicePack = this.pageButton(ui, `切换报牌声线 · ${snapshot.settings.voicePack === 'male' ? '男声' : '女声'}`, -166, () => {
      this.dependencies.session.updateSettings({ voicePack: snapshot.settings.voicePack === 'male' ? 'female' : 'male' })
      this.showSettings()
    })
    this.pageButton(ui, '返回更多功能', -240, this.dependencies.showMoreMenu)
    ;[rule, sound, soundVolume, effectQuality, voicePack].forEach(node => node.setPosition(new Vec3(-145, node.position.y, 0)))
    ;[order, bgm, musicVolume, haptic].forEach(node => node.setPosition(new Vec3(145, node.position.y, 0)))
  }

  private closeRules (): void {
    this.rulesDialogVisible = false
    this.dependencies.router.closeModal()
    if (this.dependencies.router.current === 'menu') this.dependencies.renderMenu()
  }

  private compactButton (ui: RuntimeUiFactory, text: string, x: number, y: number, width: number, height: number, fontSize: number, action: () => void): Node {
    const node = ui.button('CompactButton', text, x, width, height, fontSize, {
      fill: new Color(26, 51, 56, 224), pressedFill: new Color(52, 83, 72, 240), stroke: new Color(241, 207, 101, 245), textColor: new Color(255, 240, 181), textOutlineWidth: 2, radius: 6,
    })
    node.setPosition(new Vec3(x, y, 0))
    node.on(Node.EventType.TOUCH_END, action)
    return node
  }

  private pageButton (ui: RuntimeUiFactory, text: string, y: number, action: () => void): Node {
    const node = ui.button('MenuButton', text, 0)
    node.setPosition(new Vec3(0, y, 0))
    node.on(Node.EventType.TOUCH_END, action)
    return node
  }
}
