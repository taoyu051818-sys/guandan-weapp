import { Color, Node, Tween, UITransform, Vec3 } from 'cc'
import type { FriendRoomSettings } from '../../network/LobbyModels'
import type { SessionSettings } from '../../session/GameSession'
import type { ScreenAdapter } from '../../ui/ScreenAdapter'
import { RuntimeUiFactory } from '../../ui/RuntimeUiFactory'
import type { PageRouter } from '../PageRouter'
import {
  createDefaultFriendRoomSettings,
  FRIEND_ROOM_MODES,
  FRIEND_ROOM_ROUNDS,
  FRIEND_ROOM_SETTINGS_TABS,
  friendRoomChoiceRows,
  type FriendRoomSettingsTab,
  updateFriendRoomChoice,
  updateFriendRoomRounds,
} from './FriendRoomSettingsPolicy'

export type FriendRoomSettingsPresenterDependencies = {
  router: PageRouter
  screen: ScreenAdapter
  backgroundArt: string
  updateSessionSettings: (settings: Partial<SessionSettings>) => void
  joinRoom: () => void
  createRoom: (settings: FriendRoomSettings) => void
  goBack: () => void
}

/** Owns the friend-room settings draft, runtime view tree, and page-local interactions. */
export class FriendRoomSettingsPresenter {
  private settingsDraft: FriendRoomSettings = createDefaultFriendRoomSettings()
  private selectedTab: FriendRoomSettingsTab = 'rules'
  private viewRoot: Node | null = null
  private generation = 0
  private disposed = false

  public constructor (private readonly dependencies: FriendRoomSettingsPresenterDependencies) {}

  public get settings (): Readonly<FriendRoomSettings> { return { ...this.settingsDraft } }

  public get tab (): FriendRoomSettingsTab { return this.selectedTab }

  public show (): void {
    if (this.disposed) return
    this.releaseView()
    const generation = ++this.generation
    const pageUi = this.dependencies.router.open('friend-room-settings')
    const viewport = this.dependencies.screen.viewport
    const viewRoot = new Node('FriendRoomSettingsView')
    viewRoot.parent = pageUi.parent
    viewRoot.addComponent(UITransform).setContentSize(viewport.width, viewport.height)
    this.viewRoot = viewRoot
    const ui = new RuntimeUiFactory(viewRoot)

    const sourceWidth = 1672
    const sourceHeight = 941
    const coverScale = Math.max(viewport.width / sourceWidth, viewport.height / sourceHeight)
    ui.image('FriendRoomBackdrop', this.dependencies.backgroundArt, 0, 0, sourceWidth * coverScale, sourceHeight * coverScale)
    ui.panel('FriendRoomTint', 0, 0, viewport.width, viewport.height, { fill: new Color(7, 42, 24, 78), lineWidth: 0, radius: 0 })
    const safeWidth = this.dependencies.screen.safeSize().x
    const safeHeight = this.dependencies.screen.safeSize().y
    const leftWidth = Math.min(205, Math.max(138, safeWidth * 0.18))
    const leftX = this.dependencies.screen.safeLeftX(leftWidth / 2 + 14)
    const panelHeight = Math.min(525, safeHeight - 84)
    const contentLeft = leftX + leftWidth / 2 + 18
    const contentRight = this.dependencies.screen.safeRightX(18)
    const contentWidth = Math.max(310, contentRight - contentLeft)
    const contentX = (contentLeft + contentRight) / 2
    ui.panel('FriendModePanel', leftX, -8, leftWidth, panelHeight, {
      fill: new Color(12, 58, 36, 208), lineWidth: 0, radius: 0,
    })
    ui.outlinedLabel('好友房', leftX, this.dependencies.screen.safeTopY(94), Math.min(32, Math.max(26, safeHeight * 0.058)), {
      width: leftWidth, color: new Color(255, 239, 174), outlineColor: new Color(38, 68, 31), outlineWidth: 4,
    })
    FRIEND_ROOM_MODES.forEach((mode, index) => {
      const node = ui.button('FriendModeTab', mode.available ? mode.label : `${mode.label}  锁`, leftX, leftWidth - 18, 50, Math.max(22, Math.min(24, leftWidth * 0.13)), {
        fill: mode.available ? new Color(222, 170, 54, 245) : new Color(24, 76, 49, 225),
        stroke: mode.available ? new Color(255, 240, 165) : new Color(112, 151, 105, 190),
        textColor: mode.available ? new Color(61, 43, 20) : new Color(183, 198, 181),
        disabled: !mode.available,
        radius: 5,
      })
      node.setPosition(new Vec3(leftX, panelHeight / 2 - 62 - index * Math.min(64, (panelHeight - 75) / 5), 0))
    })

    const tabY = panelHeight / 2 - 30
    const tabWidth = Math.min(136, Math.max(102, contentWidth * 0.2))
    const tabGap = 10
    FRIEND_ROOM_SETTINGS_TABS.forEach((tab, index) => {
      const active = this.selectedTab === tab.id
      const x = contentLeft + tabWidth / 2 + index * (tabWidth + tabGap)
      const node = ui.button('FriendSettingsTab', tab.label, x, tabWidth, 44, 22, {
        fill: active ? new Color(45, 137, 70, 242) : new Color(10, 52, 34, 205),
        stroke: active ? new Color(249, 214, 92, 250) : new Color(117, 157, 105, 210),
        textColor: active ? new Color(255, 246, 203) : new Color(210, 225, 207),
        textOutlineColor: new Color(35, 65, 41), textOutlineWidth: 2, radius: 6,
      })
      node.setPosition(new Vec3(x, tabY, 0))
      if (!active) node.on(Node.EventType.TOUCH_END, this.guard(generation, () => {
        this.selectedTab = tab.id
        this.show()
      }))
    })
    this.compactButton(ui, '重置', contentRight - 44, tabY, 82, 42, 22, generation, () => {
      this.setSettings(createDefaultFriendRoomSettings(), true)
    })
    ui.outlinedLabel('经典过A · 四人组队 · 服务器验牌', contentX, tabY - 42, Math.max(20, Math.min(22, safeHeight * 0.036)), {
      width: contentWidth - 20, height: 28, color: new Color(223, 239, 215), outlineColor: new Color(28, 61, 38), outlineWidth: 2,
    })

    const rowGap = Math.max(37, Math.min(57, (panelHeight - 100) / 5))
    const rowStart = tabY - 72
    if (this.selectedTab === 'rules') {
      this.stepperRow(ui, FRIEND_ROOM_ROUNDS.label, contentX, contentWidth, rowStart, this.settingsDraft.rounds, FRIEND_ROOM_ROUNDS.suffix, FRIEND_ROOM_ROUNDS.minimum, FRIEND_ROOM_ROUNDS.maximum, FRIEND_ROOM_ROUNDS.step, generation, value => {
        this.setSettings(updateFriendRoomRounds(this.settingsDraft, value))
      })
    }
    const choiceOffset = this.selectedTab === 'rules' ? 1 : 0
    friendRoomChoiceRows(this.settingsDraft, this.selectedTab).forEach((row, index) => {
      this.choiceRow(ui, row.label, contentX, contentWidth, rowStart - rowGap * (index + choiceOffset), row.options, row.selected, generation, value => {
        const nextSettings = updateFriendRoomChoice(this.settingsDraft, row.id, value)
        this.setSettings(nextSettings, nextSettings.sortOrder !== this.settingsDraft.sortOrder)
      })
    })
    const actionY = -panelHeight / 2 + 34
    this.coloredButton(ui, '加入房间', contentX - Math.min(145, contentWidth * 0.2), actionY, Math.min(240, contentWidth * 0.34), 52, 22, new Color(44, 151, 103), generation, this.dependencies.joinRoom)
    this.coloredButton(ui, '创建房间', contentX + Math.min(145, contentWidth * 0.2), actionY, Math.min(240, contentWidth * 0.34), 52, 22, new Color(223, 164, 47), generation, () => this.dependencies.createRoom({ ...this.settingsDraft }))
    this.compactButton(ui, '返回', this.dependencies.screen.safeLeftX(62), this.dependencies.screen.safeTopY(44), 84, 42, 22, generation, this.dependencies.goBack)
  }

  public hide (): void {
    this.generation += 1
    this.releaseView()
  }

  public dispose (): void {
    if (this.disposed) return
    this.disposed = true
    this.hide()
  }

  private setSettings (settings: FriendRoomSettings, synchronizeSortOrder = false): void {
    if (this.disposed) return
    this.settingsDraft = settings
    if (synchronizeSortOrder) this.dependencies.updateSessionSettings({ sortOrder: settings.sortOrder })
    this.show()
  }

  private stepperRow (
    ui: RuntimeUiFactory,
    label: string,
    centerX: number,
    width: number,
    y: number,
    value: number,
    suffix: string,
    minimum: number,
    maximum: number,
    step: number,
    generation: number,
    onChange: (value: number) => void,
  ): void {
    ui.panel('FriendSettingsRowBand', centerX, y, width, 42, { fill: new Color(8, 47, 31, 138), lineWidth: 0, radius: 4 })
    const labelWidth = Math.min(112, width * 0.19)
    const labelX = centerX - width / 2 + labelWidth / 2 + 14
    ui.outlinedLabel(label, labelX, y, Math.max(20, Math.min(22, width * 0.036)), {
      width: labelWidth, color: new Color(235, 242, 217), outlineColor: new Color(31, 65, 40), outlineWidth: 2,
    })
    const controlsCenter = centerX + labelWidth * 0.36
    const valueWidth = Math.min(150, Math.max(92, width * 0.22))
    ui.panel('FriendStepperValuePill', controlsCenter, y, valueWidth, 34, { fill: new Color(224, 234, 213, 245), stroke: new Color(129, 158, 117), lineWidth: 1, radius: 17 })
    ui.outlinedLabel(`${value}${suffix}`, controlsCenter, y, 20, {
      width: valueWidth - 12, height: 28, color: new Color(49, 82, 54), outlineColor: new Color(255, 255, 255), outlineWidth: 1,
    })
    this.compactButton(ui, '-', controlsCenter - valueWidth / 2 - 28, y, 38, 34, 22, generation, () => onChange(Math.max(minimum, value - step)))
    this.compactButton(ui, '+', controlsCenter + valueWidth / 2 + 28, y, 38, 34, 22, generation, () => onChange(Math.min(maximum, value + step)))
  }

  private choiceRow (
    ui: RuntimeUiFactory,
    label: string,
    centerX: number,
    width: number,
    y: number,
    values: readonly string[],
    selected: string,
    generation: number,
    onSelect: (value: string) => void,
  ): void {
    ui.panel('FriendSettingsRowBand', centerX, y, width, 42, { fill: new Color(8, 47, 31, 138), lineWidth: 0, radius: 4 })
    const labelWidth = Math.min(112, width * 0.19)
    const labelX = centerX - width / 2 + labelWidth / 2 + 14
    ui.outlinedLabel(label, labelX, y, Math.max(20, Math.min(22, width * 0.036)), {
      width: labelWidth, color: new Color(235, 242, 217), outlineColor: new Color(31, 65, 40), outlineWidth: 2,
    })
    const choicesLeft = centerX - width / 2 + labelWidth + 24
    const choicesWidth = width - labelWidth - 42
    const gap = 9
    const buttonWidth = Math.min(158, (choicesWidth - gap * (values.length - 1)) / values.length)
    const usedWidth = buttonWidth * values.length + gap * (values.length - 1)
    const firstX = choicesLeft + (choicesWidth - usedWidth) / 2 + buttonWidth / 2
    values.forEach((value, index) => {
      const active = value === selected
      const node = ui.button('FriendChoice', value, firstX + index * (buttonWidth + gap), buttonWidth, 44, Math.max(22, Math.min(24, buttonWidth * 0.17)), {
        fill: active ? new Color(71, 174, 83, 248) : new Color(223, 232, 212, 245),
        pressedFill: new Color(57, 150, 70, 248),
        stroke: active ? new Color(232, 201, 77, 255) : new Color(124, 150, 113, 220),
        textColor: active ? new Color(255, 252, 225) : new Color(59, 82, 61),
        textOutlineColor: active ? new Color(40, 86, 39) : new Color(255, 255, 255),
        textOutlineWidth: 2,
        radius: 5,
      })
      node.setPosition(new Vec3(firstX + index * (buttonWidth + gap), y, 0))
      if (!active) node.on(Node.EventType.TOUCH_END, this.guard(generation, () => onSelect(value)))
    })
  }

  private compactButton (ui: RuntimeUiFactory, text: string, x: number, y: number, width: number, height: number, fontSize: number, generation: number, action: () => void): Node {
    const node = ui.button('CompactButton', text, x, width, height, fontSize, {
      fill: new Color(26, 51, 56, 224), pressedFill: new Color(52, 83, 72, 240), stroke: new Color(241, 207, 101, 245), textColor: new Color(255, 240, 181), textOutlineWidth: 2, radius: 6,
    })
    node.setPosition(new Vec3(x, y, 0))
    node.on(Node.EventType.TOUCH_END, this.guard(generation, action))
    return node
  }

  private coloredButton (ui: RuntimeUiFactory, text: string, x: number, y: number, width: number, height: number, fontSize: number, fill: Color, generation: number, action: () => void): Node {
    const node = ui.button('ColoredButton', text, x, width, height, fontSize, {
      fill,
      pressedFill: new Color(Math.max(0, fill.r - 28), Math.max(0, fill.g - 28), Math.max(0, fill.b - 28), fill.a),
      stroke: new Color(255, 235, 151, 255),
      textColor: new Color(255, 252, 224),
      textOutlineColor: new Color(43, 58, 37, 255),
      textOutlineWidth: 3,
      radius: 7,
    })
    node.setPosition(new Vec3(x, y, 0))
    node.on(Node.EventType.TOUCH_END, this.guard(generation, action))
    return node
  }

  private guard (generation: number, action: () => void): () => void {
    return () => {
      if (this.disposed || generation !== this.generation || this.dependencies.router.current !== 'friend-room-settings') return
      action()
    }
  }

  private releaseView (): void {
    if (!this.viewRoot?.isValid) {
      this.viewRoot = null
      return
    }
    this.viewRoot.active = false
    this.stopTweens(this.viewRoot)
    this.viewRoot.destroy()
    this.viewRoot = null
  }

  private stopTweens (node: Node): void {
    Tween.stopAllByTarget(node)
    node.children.forEach(child => this.stopTweens(child))
  }
}
