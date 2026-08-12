import { BlockInputEvents, Color, Label, Node, Vec3 } from 'cc'
import type { GameSession } from '../../session/GameSession'
import type { ScreenAdapter } from '../../ui/ScreenAdapter'
import type { RuntimeUiFactory } from '../../ui/RuntimeUiFactory'
import { projectRuleHelp } from '../../ui/RuleHelpProjection'
import type { PageRouter } from '../PageRouter'

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
    const rulePages = projectRuleHelp(this.dependencies.session.ruleProfile)
    this.rulesPage = Math.max(0, Math.min(rulePages.length - 1, this.rulesPage))
    const rule = rulePages[this.rulesPage]
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
    ui.outlinedLabel(`第 ${this.rulesPage + 1} / ${rulePages.length} 页`, centerX + modalWidth / 2 - 91, headerY, 20, {
      width: 112, height: 30, color: new Color(216, 232, 222), outlineColor: new Color(24, 42, 37), outlineWidth: 2,
    })

    const bodyHeight = modalHeight - (compact ? 150 : 174)
    const body = ui.outlinedLabel(rule.content, centerX, centerY - 4, compact ? 20 : 22, {
      width: modalWidth - 72, height: bodyHeight, color: new Color(245, 239, 215), outlineColor: new Color(24, 35, 31), outlineWidth: 2,
    })
    body.horizontalAlign = Label.HorizontalAlign.LEFT
    body.verticalAlign = Label.VerticalAlign.TOP

    this.compactButton(ui, '关闭', centerX + modalWidth / 2 - 42, centerY + modalHeight / 2 - 28, 64, 38, 22, () => this.closeRules())
    const navigationY = centerY - modalHeight / 2 + (compact ? 31 : 36)
    const previous = ui.button('RulesPrevious', '<  上一页', centerX - 115, 190, compact ? 44 : 46, 22, {
      fill: new Color(31, 61, 58, 238), pressedFill: new Color(57, 89, 77, 245), stroke: new Color(225, 183, 74, 235),
      textColor: new Color(255, 239, 180), textOutlineWidth: 2, disabled: this.rulesPage === 0, radius: 7,
    })
    previous.setPosition(new Vec3(centerX - 115, navigationY, 0))
    if (this.rulesPage > 0) previous.on(Node.EventType.TOUCH_END, () => { this.rulesPage -= 1; this.showRules() })
    const next = ui.button('RulesNext', '下一页  >', centerX + 115, 190, compact ? 44 : 46, 22, {
      fill: new Color(31, 61, 58, 238), pressedFill: new Color(57, 89, 77, 245), stroke: new Color(225, 183, 74, 235),
      textColor: new Color(255, 239, 180), textOutlineWidth: 2, disabled: this.rulesPage === rulePages.length - 1, radius: 7,
    })
    next.setPosition(new Vec3(centerX + 115, navigationY, 0))
    if (this.rulesPage + 1 < rulePages.length) next.on(Node.EventType.TOUCH_END, () => { this.rulesPage += 1; this.showRules() })
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

  public reflow (): void {
    if (this.dependencies.router.current === 'settings') this.showSettings()
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
