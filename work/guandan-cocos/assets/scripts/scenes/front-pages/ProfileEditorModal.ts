import { BlockInputEvents, Color, EditBox, Game, game, Label, Node, Tween, UITransform, Vec3, view } from 'cc'
import type { AuthGateway, UserProfile } from '../../services/FrontPageGatewayContracts'
import { ProfileSaveCoordinator } from '../../services/ProfileSaveCoordinator'
import { mountWechatProfileButton, type WechatProfileApi, type WechatProfileControl } from '../../services/WechatProfileProvider'
import { mountProfileAvatar } from '../../ui/ProfileAvatar'
import { pickProfileImage } from '../../services/ProfileImagePicker'
import { RuntimeUiFactory } from '../../ui/RuntimeUiFactory'
import type { ScreenAdapter } from '../../ui/ScreenAdapter'
import type { WechatWindowApi } from '../../ui/WechatCapsuleLayout'

/** Modal shared by the lobby and own table avatar; never leaves a running game. */
export class ProfileEditorModal {
  private root: Node | null = null
  private input: EditBox | null = null
  private status: Label | null = null
  private draft: UserProfile | null = null
  private busy = false
  private generation = 0
  private cancelWechat: WechatProfileControl | null = null
  private wechatDraftApplied = false
  private readonly saves: ProfileSaveCoordinator

  public constructor (private readonly parent: Node, private readonly screen: ScreenAdapter,
    private readonly auth: AuthGateway, saved: (profile: UserProfile) => void, saves?: ProfileSaveCoordinator) {
    this.saves = saves ?? new ProfileSaveCoordinator(auth, saved)
  }

  public get open (): boolean { return Boolean(this.root) }

  public async show (cached: UserProfile | null): Promise<void> {
    this.close()
    const generation = this.generation
    this.draft = cached ? { ...cached } : null
    this.render()
    game.on(Game.EVENT_HIDE, this.suspendNative, this)
    game.on(Game.EVENT_SHOW, this.resumeNative, this)
    if (cached) return
    try {
      const profile = await this.auth.getProfile()
      if (generation !== this.generation) return
      this.draft = { ...profile }
      this.render()
    } catch { if (generation === this.generation && this.status) this.status.string = '资料暂时无法获取，请关闭后重试' }
  }

  public close (): void {
    this.generation += 1
    this.hideNative()
    game.off(Game.EVENT_HIDE, this.suspendNative, this)
    game.off(Game.EVENT_SHOW, this.resumeNative, this)
    if (this.root?.isValid) { this.root.active = false; this.root.destroy() }
    this.root = null
    this.input = null
    this.status = null
    this.draft = null
    this.busy = false
    this.wechatDraftApplied = false
  }

  public reflow (): void {
    if (!this.root) return
    if (this.draft && this.input) this.draft.displayName = this.input.string
    this.render()
  }

  private render (): void {
    this.hideNative()
    if (this.root?.isValid) { this.root.active = false; this.root.destroy() }
    const root = new Node('ProfileEditorModal')
    root.parent = this.parent
    this.root = root
    const viewport = this.screen.viewport
    root.addComponent(UITransform).setContentSize(viewport.width, viewport.height)
    root.addComponent(BlockInputEvents)
    const ui = new RuntimeUiFactory(root)
    ui.panel('ProfileShade', 0, 0, viewport.width, viewport.height, { fill: new Color(2, 12, 14, 185), lineWidth: 0, frame: 'square' })
    const panel = ui.panel('ProfilePanel', 0, 0, 650, 450, { fill: new Color(26, 43, 43, 255), stroke: new Color(218, 179, 79), frame: 'panel' })
    panel.setScale(new Vec3(Math.min(1, (viewport.width - 32) / 650, (viewport.height - 32) / 450), Math.min(1, (viewport.width - 32) / 650, (viewport.height - 32) / 450), 1))
    const body = new RuntimeUiFactory(panel)
    body.outlinedLabel('修改个人资料', 0, 178, 32)
    if (this.draft) mountProfileAvatar(panel, this.draft, this.auth, -225, 83, 90)
    body.outlinedLabel('昵称', -90, 115, 23, { width: 80, height: 38 })
    this.input = body.formInput('ProfileNickname', '请输入昵称', 65, 65, { width: 370, height: 66, maxLength: 24, fontSize: 26, inputMode: EditBox.InputMode.SINGLE_LINE, initialValue: this.draft?.displayName ?? '' })
    this.input.node.on('text-changed', () => { if (this.draft && this.input) this.draft.displayName = this.input.string })
    body.outlinedLabel('可上传头像、修改昵称，或使用微信资料', 0, 4, 21, { width: 580, height: 38 })
    this.status = body.outlinedLabel(this.draft ? '选择的头像将居中裁剪，点击保存后生效' : '正在读取资料…', 0, -122, 20, { width: 600, height: 44 })
    const button = (name: string, text: string, x: number, y: number, width: number, action: () => void): Node => {
      const node = body.button(name, text, x, width, 64, 23)
      node.setPosition(new Vec3(x, y, 0))
      node.on(Node.EventType.TOUCH_END, action)
      return node
    }
    button('UploadProfileAvatar', '上传头像', -190, -62, 160, () => { void this.pickAvatar() })
    const wxButton = button('UseWechatProfile', '授权微信昵称和头像', 92, -62, 376, () => this.requestWechat(wxButton))
    button('ProfileCancel', '取消', -145, -187, 220, () => this.close())
    button('ProfileSave', this.busy ? '保存中…' : '保存', 145, -187, 220, () => { void this.save() })
    // Opening the editor is explicit intent; mount the native button without a hidden second tap.
    if (this.draft && !this.busy && !this.wechatDraftApplied && (globalThis as unknown as { wx?: WechatProfileApi }).wx) this.requestWechat(wxButton)
  }

  private async pickAvatar (): Promise<void> {
    if (this.busy || !this.draft) return
    const generation = this.generation
    this.busy = true; this.hideNative()
    if (this.status) this.status.string = '请选择头像…'
    try {
      const image = await pickProfileImage()
      if (generation !== this.generation || !this.draft) return
      if (image) { this.draft.avatarUrl = image; this.wechatDraftApplied = true }
      this.busy = false; this.render()
    } catch (error) { if (generation === this.generation && this.status) this.status.string = error instanceof Error ? error.message : '头像选择失败' }
    finally { if (generation === this.generation) this.busy = false }
  }

  private requestWechat (node: Node): void {
    if (this.busy || !this.draft) return
    const api = (globalThis as unknown as { wx?: WechatProfileApi & WechatWindowApi }).wx
    if (!api) { if (this.status) this.status.string = '请在微信内授权头像；浏览器可手动修改昵称'; return }
    this.hideNative()
    if (this.status) this.status.string = '请点击微信授权按钮确认，不授权也可继续游戏'
    try {
      const window = api.getWindowInfo?.() ?? api.getSystemInfoSync?.()
      if (!window) throw new Error('window unavailable')
      // Native controls cannot follow the Cocos button's entrance/press scaling.
      Tween.stopAllByTarget(node)
      node.setScale(Vec3.ONE)
      const visible = view.getVisibleSize()
      const rect = node.getComponent(UITransform)!.getBoundingBoxToWorld()
      const left = rect.x * window.windowWidth / visible.width
      const top = (visible.height - rect.y - rect.height) * window.windowHeight / visible.height
      const generation = this.generation
      this.cancelWechat = mountWechatProfileButton(api, { left, top, width: rect.width * window.windowWidth / visible.width,
        height: rect.height * window.windowHeight / visible.height }, profile => {
        if (generation !== this.generation || !this.draft) return
        this.draft = { ...this.draft, ...profile }
        this.wechatDraftApplied = true
        this.hideNative()
        if (this.input) this.input.string = profile.displayName
        const panel = this.root?.getChildByName('ProfilePanel')
        const avatar = panel?.getChildByName('ProfileAvatar')
        if (avatar) { avatar.active = false; avatar.destroy() }
        if (panel) mountProfileAvatar(panel, this.draft, this.auth, -225, 83, 90)
        void this.save()
      }, message => { if (generation === this.generation && this.status) this.status.string = message })
    } catch { if (this.status) this.status.string = '微信授权暂不可用，请重试或手动修改' }
  }

  private async save (): Promise<void> {
    if (this.busy || !this.draft || !this.input) return
    const displayName = this.input.string.trim()
    if (!displayName || Array.from(displayName).length > 24 || /[\u0000-\u001f\u007f]/.test(displayName)) {
      if (this.status) this.status.string = '请输入1—24字的昵称，不含换行或控制字符'
      return
    }
    const generation = this.generation
    this.busy = true
    this.hideNative()
    if (this.status) this.status.string = '正在保存…'
    try {
      const avatar = this.draft.avatarUrl ?? ''
      await this.saves.save({ displayName, ...(avatar.startsWith('data:') ? { avatarDataUri: avatar } : { avatarUrl: avatar }) }, this.draft.id)
      if (generation === this.generation) this.close()
    } catch (error) {
      if (generation === this.generation && this.status) this.status.string = error instanceof Error ? error.message : '保存失败，请稍后重试'
    } finally { if (generation === this.generation) this.busy = false }
  }

  private readonly hideNative = (): void => { this.cancelWechat?.(); this.cancelWechat = null }
  private readonly suspendNative = (): void => { this.cancelWechat?.hide() }
  private readonly resumeNative = (): void => { if (this.root && !this.busy) this.cancelWechat?.show() }
}
