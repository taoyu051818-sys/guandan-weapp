import type { UserProfile } from './FrontPageGatewayContracts'
import type { ProfileSaveCoordinator } from './ProfileSaveCoordinator'
import type { WechatProfileApi } from './WechatProfileProvider'
import { readWechatProfile, type WechatProfile } from './WechatProfileResult'

/** Silent means no consent dialogs: both privacy and scope must already be granted. */
export function readAuthorizedWechatProfile (api: WechatProfileApi, timeoutMs = 4000): Promise<WechatProfile | null> {
  return new Promise(resolve => {
    let finished = false
    const finish = (profile: WechatProfile | null): void => {
      if (finished) return
      finished = true
      clearTimeout(timer)
      resolve(profile)
    }
    const timer = setTimeout(() => finish(null), timeoutMs)
    try {
      if (!api.getPrivacySetting || !api.getSetting || !api.getUserInfo) { finish(null); return }
      api.getPrivacySetting({ fail: () => finish(null), success: privacy => {
        if (finished) return
        if (privacy.needAuthorization !== false) { finish(null); return }
        try {
          api.getSetting!({ fail: () => finish(null), success: setting => {
            if (finished) return
            if (setting.authSetting?.['scope.userInfo'] !== true) { finish(null); return }
            try {
              api.getUserInfo!({ withCredentials: false, lang: 'zh_CN', fail: () => finish(null), success: result => {
                if (finished) return
                try { finish(readWechatProfile(result)) } catch { finish(null) }
              } })
            } catch { finish(null) }
          } })
        } catch { finish(null) }
      } })
    } catch { finish(null) }
  })
}

/** Shares the editor's write queue. Never overrides an edit opened during an async read. */
export class WechatProfileSync {
  private revision = 0
  private pending = false
  private lastUser = ''
  private lastAttempt = 0
  public constructor (private readonly saves: ProfileSaveCoordinator, private readonly allowed: () => boolean) {}
  public cancel (): void { this.revision++ }
  public async run (user: UserProfile): Promise<void> {
    // Generated and explicitly saved identities change only through the editor, even after restart.
    if (user.profileSource) return
    const api = (globalThis as unknown as { wx?: WechatProfileApi }).wx
    if (!api || !this.allowed() || this.pending || (this.lastUser === user.id && Date.now() - this.lastAttempt < 30_000)) return
    this.pending = true
    this.lastUser = user.id
    this.lastAttempt = Date.now()
    const revision = this.revision
    try {
      const profile = await readAuthorizedWechatProfile(api)
      if (!profile || revision !== this.revision || !this.allowed()) return
      if (profile.displayName === user.displayName && profile.avatarUrl === user.avatarUrl) return
      await this.saves.save(profile, user.id)
    } catch { console.warn('[WechatProfile] Authorized profile sync failed; keeping confirmed platform profile') }
    finally { this.pending = false }
  }
}
