import { EditBox, Node, Vec3 } from 'cc'
import type { FrontPageGateways, MerchantConsole, MerchantRole } from '../../services/DevelopmentApis'
import { PlatformApiError } from '../../services/PlatformApi'
import type { ScreenAdapter } from '../../ui/ScreenAdapter'
import type { RuntimeUiFactory } from '../../ui/RuntimeUiFactory'
import type { FrontPageId, PageRouter } from '../PageRouter'

type MerchantAction = 'apply' | 'store' | 'employee' | 'grant'
type MerchantPageId = Extract<FrontPageId, 'merchant-console' | 'merchant-apply' | 'merchant-store' | 'merchant-employee' | 'merchant-grant'>

export type MerchantPageDependencies = {
  router: PageRouter
  screen: ScreenAdapter
  gateways: FrontPageGateways
  isDisposed: () => boolean
  issuePageRequest: () => number
  currentPageRequest: () => number
  showMore: () => void
  showNotice: (title: string, detail?: string) => void
}

/** Owns merchant permission, onboarding, store, employee, and point-grant pages. */
export class MerchantPageDomain {
  private pendingAction: MerchantAction | null = null

  public constructor (private readonly dependencies: MerchantPageDependencies) {}

  public async show (successMessage = ''): Promise<void> {
    if (this.dependencies.isDisposed()) return
    const token = this.dependencies.issuePageRequest()
    this.renderLoading(this.dependencies.gateways.configured ? '正在同步商户权限与经营数据…' : '正在载入只读演示数据…')
    try {
      const merchantConsole = await this.dependencies.gateways.merchant.getConsole()
      if (!this.isCurrent(token, 'merchant-console')) return
      const status = successMessage || (this.dependencies.gateways.configured ? '已同步平台商户数据' : '只读演示 · 未连接平台服务 · 不会提交任何写入')
      this.renderConsole(merchantConsole, status)
    } catch (error) {
      if (!this.isCurrent(token, 'merchant-console')) return
      if (this.dependencies.gateways.configured && error instanceof PlatformApiError && error.status === 403) {
        this.renderApplication('当前账号没有商户权限，可填写资料申请入驻。提交后需等待外部审核。')
        return
      }
      this.renderUnavailable(this.errorDetail(error, '商户后台暂时无法获取'))
    }
  }

  private renderLoading (status: string): void {
    const ui = this.dependencies.router.open('merchant-console')
    ui.menuLabel('商户后台 · 技术预览', 0, 220, 40)
    ui.menuLabel(status, 0, 155, 20)
    this.pageButton(ui, '返回更多功能', -210, this.dependencies.showMore)
  }

  private renderUnavailable (status: string): void {
    const ui = this.dependencies.router.open('merchant-console')
    ui.menuLabel('商户后台 · 技术预览', 0, 220, 40)
    ui.menuLabel(status, 0, 125, 22)
    this.sizedButton(ui, '重新同步', -150, -65, 250, 48, 19, () => { void this.show() })
    this.sizedButton(ui, '返回更多功能', 150, -65, 250, 48, 19, this.dependencies.showMore)
  }

  private renderConsole (merchantConsole: MerchantConsole, status: string): void {
    const ui = this.dependencies.router.open('merchant-console')
    const merchantStatus = this.merchantStatusText(merchantConsole.merchant.status)
    const role = this.merchantRoleText(merchantConsole.role)
    ui.menuLabel('商户后台 · 技术预览', 0, 225, 38)
    ui.menuLabel(status, 0, 187, 16)
    ui.menuLabel(`${merchantConsole.merchant.name} · ${merchantStatus} · 当前角色：${role}\n日发放限额 ${merchantConsole.merchant.dailyPointLimit} · 最近记录发放 ${merchantConsole.grantedPoints} 积分`, 0, 137, 21)

    if (merchantConsole.merchant.status !== 'active') {
      const detail = merchantConsole.merchant.status === 'pending'
        ? '申请已经提交，审核通过前不能创建门店、管理员工或发放积分。'
        : merchantConsole.merchant.status === 'rejected'
          ? '申请未通过；当前接口没有重新提交或申诉流程，请联系运营人员。'
          : '商户账户当前不可用，所有写入按钮已关闭。'
      ui.menuLabel(detail, 0, 45, 21)
      this.sizedButton(ui, '刷新审核状态', -150, -85, 250, 46, 18, () => { void this.show() })
      this.sizedButton(ui, '返回更多功能', 150, -85, 250, 46, 18, this.dependencies.showMore)
      return
    }

    const columnX = Math.min(300, Math.max(220, this.dependencies.screen.safeSize().x * 0.24))
    const storeLines = merchantConsole.stores.slice(0, 3).map(store => `${store.status === 'active' ? '营业' : '停用'} · ${store.name}\n${store.address || '未填写地址'} · ${store.id}`).join('\n')
    const employeeLines = merchantConsole.employees.slice(0, 3).map(employee => `${employee.role === 'manager' ? '管理员' : '收银员'} · ${employee.userId} · ${employee.status === 'active' ? '启用' : '停用'}`).join('\n')
    ui.menuLabel(`门店（${merchantConsole.stores.length}）\n${storeLines || '暂无门店'}`, -columnX, 65, 17)
    ui.menuLabel(`员工（${merchantConsole.employees.length}）\n${employeeLines || '暂无员工'}`, columnX, 65, 17)
    const grantLines = merchantConsole.grants.slice(0, 2).map(grant => `${grant.amount} 积分 → ${grant.recipientUserId} · ${grant.note || '无备注'}`).join('\n')
    ui.menuLabel(`最近发放\n${grantLines || '暂无积分发放记录'}`, 0, -45, 17)

    if (!this.dependencies.gateways.configured) {
      ui.menuLabel('以上均为合成演示数据；写入按钮仅在已配置平台并取得 active 权限后出现。', 0, -135, 17)
    } else {
      const actions: Array<[string, () => void]> = []
      if (merchantConsole.role === 'owner' || merchantConsole.role === 'manager') actions.push(['创建门店', () => this.showStoreForm()])
      if (merchantConsole.role === 'owner') actions.push(['添加员工', () => this.showEmployeeForm()])
      actions.push(['发放积分', () => this.showGrantForm(merchantConsole)])
      const actionGap = actions.length === 3 ? 260 : 300
      actions.forEach(([label, action], index) => {
        const x = (index - (actions.length - 1) / 2) * actionGap
        this.sizedButton(ui, label, x, -150, 220, 44, 18, action)
      })
    }
    this.sizedButton(ui, '刷新', -145, -218, 240, 44, 18, () => { void this.show() })
    this.sizedButton(ui, '返回更多功能', 145, -218, 240, 44, 18, this.dependencies.showMore)
  }

  private renderApplication (status: string): void {
    const ui = this.dependencies.router.open('merchant-apply')
    ui.menuLabel('申请商户入驻', 0, 220, 39)
    ui.menuLabel(status, 0, 174, 17)
    ui.menuLabel('商户名称', 0, 122, 18)
    const nameInput = ui.formInput('MerchantNameInput', '输入商户名称', 0, 83, { width: 480, maxLength: 60 })
    ui.menuLabel('联系人（可选）', 0, 35, 18)
    const contactInput = ui.formInput('MerchantContactInput', '输入联系人姓名', 0, -4, { width: 480, maxLength: 40 })
    this.sizedButton(ui, '提交入驻申请', -150, -95, 250, 48, 19, () => {
      void this.submitApplication(nameInput.string, contactInput.string)
    })
    this.sizedButton(ui, '返回更多功能', 150, -95, 250, 48, 19, this.dependencies.showMore)
    ui.menuLabel('提交只会创建 pending 申请；审核、撤回与申诉仍由运营系统处理。', 0, -165, 16)
  }

  private async submitApplication (name: string, contactName: string): Promise<void> {
    if (this.dependencies.isDisposed() || this.pendingAction) return
    const pageToken = this.dependencies.currentPageRequest()
    this.pendingAction = 'apply'
    try {
      await this.dependencies.gateways.merchant.apply({ name, contactName })
      if (!this.isCurrent(pageToken, 'merchant-apply')) return
      void this.show('入驻申请已提交 · 当前状态以平台返回为准')
    } catch (error) {
      if (this.isCurrent(pageToken, 'merchant-apply')) this.dependencies.showNotice('商户申请失败', this.errorDetail(error, '请核对资料后重试'))
    } finally {
      if (this.pendingAction === 'apply') this.pendingAction = null
    }
  }

  private showStoreForm (): void {
    if (this.dependencies.isDisposed() || !this.dependencies.gateways.configured) return
    this.dependencies.issuePageRequest()
    const ui = this.dependencies.router.open('merchant-store')
    ui.menuLabel('创建门店', 0, 220, 39)
    ui.menuLabel('仅 active 的负责人或管理员可提交；重复响应会复用同一幂等键。', 0, 174, 17)
    ui.menuLabel('门店名称', 0, 122, 18)
    const nameInput = ui.formInput('MerchantStoreNameInput', '输入门店名称', 0, 83, { width: 500, maxLength: 60 })
    ui.menuLabel('门店地址（可选）', 0, 35, 18)
    const addressInput = ui.formInput('MerchantStoreAddressInput', '输入门店地址', 0, -4, { width: 620, maxLength: 120, fontSize: 19 })
    this.sizedButton(ui, '确认创建', -150, -100, 250, 48, 19, () => { void this.submitStore(nameInput.string, addressInput.string) })
    this.sizedButton(ui, '取消', 150, -100, 250, 48, 19, () => { void this.show() })
  }

  private async submitStore (name: string, address: string): Promise<void> {
    if (this.dependencies.isDisposed() || this.pendingAction) return
    const pageToken = this.dependencies.currentPageRequest()
    this.pendingAction = 'store'
    try {
      await this.dependencies.gateways.merchant.createStore({ name, address })
      if (!this.isCurrent(pageToken, 'merchant-store')) return
      void this.show('门店创建成功 · 已重新同步商户数据')
    } catch (error) {
      if (this.isCurrent(pageToken, 'merchant-store')) this.dependencies.showNotice('创建门店失败', this.errorDetail(error, '请核对门店资料后重试'))
    } finally {
      if (this.pendingAction === 'store') this.pendingAction = null
    }
  }

  private showEmployeeForm (): void {
    if (this.dependencies.isDisposed() || !this.dependencies.gateways.configured) return
    this.dependencies.issuePageRequest()
    const ui = this.dependencies.router.open('merchant-employee')
    let role: Exclude<MerchantRole, 'owner'> = 'cashier'
    ui.menuLabel('添加或更新员工', 0, 220, 39)
    ui.menuLabel('只有商户负责人可操作；请输入对方平台用户 ID，不会自动选择真实用户。', 0, 174, 17)
    ui.menuLabel('员工用户 ID', 0, 118, 18)
    const userInput = ui.formInput('MerchantEmployeeUserInput', '输入平台用户 ID', 0, 78, { width: 560, maxLength: 100, fontSize: 19 })
    const roleLabel = ui.menuLabel('当前角色：收银员', 0, 25, 18)
    this.sizedButton(ui, '收银员', -135, -20, 220, 44, 18, () => { role = 'cashier'; roleLabel.string = '当前角色：收银员' })
    this.sizedButton(ui, '管理员', 135, -20, 220, 44, 18, () => { role = 'manager'; roleLabel.string = '当前角色：管理员' })
    this.sizedButton(ui, '确认添加', -150, -100, 250, 48, 19, () => { void this.submitEmployee(userInput.string, role) })
    this.sizedButton(ui, '取消', 150, -100, 250, 48, 19, () => { void this.show() })
  }

  private async submitEmployee (employeeUserId: string, role: Exclude<MerchantRole, 'owner'>): Promise<void> {
    if (this.dependencies.isDisposed() || this.pendingAction) return
    const pageToken = this.dependencies.currentPageRequest()
    this.pendingAction = 'employee'
    try {
      await this.dependencies.gateways.merchant.addEmployee({ employeeUserId, role })
      if (!this.isCurrent(pageToken, 'merchant-employee')) return
      void this.show('员工信息已更新 · 已重新同步商户数据')
    } catch (error) {
      if (this.isCurrent(pageToken, 'merchant-employee')) this.dependencies.showNotice('添加员工失败', this.errorDetail(error, '请确认用户 ID 和操作权限'))
    } finally {
      if (this.pendingAction === 'employee') this.pendingAction = null
    }
  }

  private showGrantForm (merchantConsole: MerchantConsole): void {
    if (this.dependencies.isDisposed() || !this.dependencies.gateways.configured) return
    const firstStore = merchantConsole.stores.find(store => store.status === 'active')
    if (!firstStore) {
      this.dependencies.showNotice('暂时不能发放积分', '请先由负责人或管理员创建一个启用门店')
      return
    }
    this.dependencies.issuePageRequest()
    const ui = this.dependencies.router.open('merchant-grant')
    const columnX = Math.min(270, Math.max(220, this.dependencies.screen.safeSize().x * 0.22))
    ui.menuLabel('商户积分发放', 0, 220, 39)
    ui.menuLabel('每次提交都需明确门店、接收用户和积分数；不能向负责人或员工自发分。', 0, 174, 17)
    ui.menuLabel('门店 ID', -columnX, 125, 18)
    const storeInput = ui.formInput('MerchantGrantStoreInput', '输入门店 ID', -columnX, 86, { width: 420, maxLength: 100, fontSize: 17, initialValue: firstStore.id })
    ui.menuLabel('接收用户 ID', columnX, 125, 18)
    const recipientInput = ui.formInput('MerchantGrantRecipientInput', '输入平台用户 ID', columnX, 86, { width: 420, maxLength: 100, fontSize: 17 })
    ui.menuLabel('积分数（1—1000）', -columnX, 28, 18)
    const amountInput = ui.formInput('MerchantGrantAmountInput', '输入积分数', -columnX, -11, { width: 420, maxLength: 4, inputMode: EditBox.InputMode.NUMERIC })
    ui.menuLabel('备注（可选）', columnX, 28, 18)
    const noteInput = ui.formInput('MerchantGrantNoteInput', '输入发放备注', columnX, -11, { width: 420, maxLength: 80, fontSize: 18 })
    this.sizedButton(ui, '确认发放', -150, -105, 250, 48, 19, () => {
      void this.submitGrant(storeInput.string, recipientInput.string, Number(amountInput.string.trim()), noteInput.string)
    })
    this.sizedButton(ui, '取消', 150, -105, 250, 48, 19, () => { void this.show() })
  }

  private async submitGrant (storeId: string, recipientUserId: string, amount: number, note: string): Promise<void> {
    if (this.dependencies.isDisposed() || this.pendingAction) return
    const pageToken = this.dependencies.currentPageRequest()
    this.pendingAction = 'grant'
    try {
      await this.dependencies.gateways.merchant.grantPoints({ storeId, recipientUserId, amount, note })
      if (!this.isCurrent(pageToken, 'merchant-grant')) return
      void this.show('积分发放成功 · 已重新同步最近记录')
    } catch (error) {
      if (this.isCurrent(pageToken, 'merchant-grant')) this.dependencies.showNotice('积分发放失败', this.errorDetail(error, '请核对门店、接收用户和积分数'))
    } finally {
      if (this.pendingAction === 'grant') this.pendingAction = null
    }
  }

  private isCurrent (token: number, page: MerchantPageId): boolean {
    return !this.dependencies.isDisposed() && token === this.dependencies.currentPageRequest() && this.dependencies.router.current === page
  }

  private merchantStatusText (status: MerchantConsole['merchant']['status']): string {
    return status === 'active' ? '已启用' : status === 'pending' ? '审核中' : status === 'rejected' ? '未通过' : '已停用'
  }

  private merchantRoleText (role: MerchantRole): string {
    return role === 'owner' ? '负责人' : role === 'manager' ? '管理员' : '收银员'
  }

  private pageButton (ui: RuntimeUiFactory, text: string, y: number, action: () => void): Node {
    const node = ui.button('MenuButton', text, 0)
    node.setPosition(new Vec3(0, y, 0))
    node.on(Node.EventType.TOUCH_END, action)
    return node
  }

  private sizedButton (ui: RuntimeUiFactory, text: string, x: number, y: number, width: number, height: number, fontSize: number, action: () => void): Node {
    const node = ui.button('PageButton', text, x, width, height, fontSize)
    node.setPosition(new Vec3(x, y, 0))
    node.on(Node.EventType.TOUCH_END, action)
    return node
  }

  private errorDetail (error: unknown, fallback: string): string {
    return error instanceof Error ? error.message : fallback
  }
}
