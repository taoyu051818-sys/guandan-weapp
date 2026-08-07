import { _decorator, AudioClip, AudioSource, Component, Node } from 'cc'
import type { PlayAction } from '../core/generated'
import { GameSession } from '../session/GameSession'
import { loadGameAsset } from '../services/GameAssetLoader'
import { resolveAudioEvent, resolveAudioProfile, resolveCountdownProfile, type AudioEvent, type AudioProfile } from './AudioProfiles'
import { resolvePlayVoiceProfile } from './PlayVoiceProfiles'

const { ccclass, property } = _decorator
export type BgmMode = 'lobby' | 'battle'
const BGM_ASSETS: Readonly<Record<BgmMode, string>> = Object.freeze({
  lobby: 'audio/music/niuma/table_theme',
  battle: 'audio/music/duizhan',
})

/** Cocos replacement for the browser-only AudioManager. Audio files live in the game-assets bundle. */
@ccclass('CocosAudioController')
export class CocosAudioController extends Component {
  @property(GameSession)
  public session: GameSession | null = null

  @property(AudioSource)
  public bgmSource: AudioSource | null = null

  private effectSource: AudioSource | null = null
  private readonly clips = new Map<string, AudioClip>()
  private readonly unavailableAssets = new Set<string>()
  private readonly pendingLoads = new Map<string, Array<(clip: AudioClip | null) => void>>()
  private readonly lastRequests = new Map<AudioEvent, number>()
  private readonly lastPlayedAssets = new Map<string, number>()
  private readonly variantCursors = new Map<AudioEvent, number>()
  private playbackEpoch = 0
  private roundStartEpoch = 0
  private lastQuickVoiceAt = -Infinity
  private soundEnabled = true
  private bgmMode: BgmMode = 'lobby'
  private readonly bgmClips = new Map<string, AudioClip>()
  private readonly pendingBgmAssets = new Set<string>()
  private readonly unavailableBgmAssets = new Set<string>()

  protected onLoad (): void {
    if (!this.session) this.session = this.getComponent(GameSession)
    this.effectSource = this.getComponent(AudioSource) ?? this.addComponent(AudioSource)
    this.ensureBgmSource()
    this.session?.events.on('guandan:session', this.applySettings, this)
    this.applySettings()
  }

  protected onDestroy (): void {
    this.playbackEpoch += 1
    this.roundStartEpoch += 1
    this.session?.events.off('guandan:session', this.applySettings, this)
    this.bgmSource?.stop()
    this.pendingLoads.clear()
    this.clips.clear()
    this.bgmClips.clear()
    this.pendingBgmAssets.clear()
    this.unavailableBgmAssets.clear()
    this.effectSource = null
  }

  /** The scene owns the lobby/table boundary; this controller owns the audible transition. */
  public setBgmMode (mode: BgmMode): void {
    if (this.bgmMode !== mode) {
      this.bgmMode = mode
      const source = this.ensureBgmSource()
      source.stop()
      source.clip = null
    }
    this.applySettings()
  }

  public playPass (): void { this.playEvent('pass') }

  /** Plays the semantic start cue, then the existing deal event as a separate layer. */
  public playRoundStart (): void {
    const token = ++this.roundStartEpoch
    this.playEvent('game-start')
    this.scheduleOnce(() => {
      if (token === this.roundStartEpoch) this.playEvent('deal')
    }, 0.45)
  }

  /** Selects the dedicated 0-5 clip without leaking file names into the scene. */
  public playCountdown (remaining: number): void {
    const settings = this.session?.snapshot.settings
    if (settings && !settings.soundEnabled) return
    const profile = resolveCountdownProfile(remaining)
    if (profile) this.playProfile(profile)
  }

  /** Quick-chat clips are optional and intentionally do not fall back to game SFX. */
  public playVoice (key: string): void {
    const settings = this.session?.snapshot.settings
    if (settings && !settings.soundEnabled) return
    const now = Date.now()
    if (now - this.lastQuickVoiceAt < 650) return
    this.lastQuickVoiceAt = now
    this.playFirstAvailable(this.selectHumanVoiceKeys([key]), 1)
  }

  /** Announces only the card groups for which the imported pack is unambiguous. */
  public playActionVoice (action: PlayAction): void {
    const settings = this.session?.snapshot.settings
    if (settings && !settings.soundEnabled) return
    const profile = resolvePlayVoiceProfile(action)
    if (profile) this.playFirstAvailable(this.selectHumanVoiceKeys(profile.assetKeys), profile.volumeScale)
  }

  public playEvent (event: AudioEvent): void {
    const settings = this.session?.snapshot.settings
    if (settings && !settings.soundEnabled) return
    const profile = resolveAudioProfile(event)
    if (profile) this.playProfile(profile)
  }

  /** @deprecated Prefer playEvent; retained for existing scene and extension callers. */
  public playEffect (key: string): void {
    const event = resolveAudioEvent(key)
    if (event) return this.playEvent(event)
    this.playVoice(key)
  }

  private applySettings (): void {
    const settings = this.session?.snapshot.settings
    const nextSoundEnabled = settings?.soundEnabled ?? true
    if (this.soundEnabled && !nextSoundEnabled) {
      this.playbackEpoch += 1
      this.roundStartEpoch += 1
    }
    this.soundEnabled = nextSoundEnabled
    if (!settings) return
    const source = this.ensureBgmSource()
    source.volume = Math.max(0, Math.min(1, settings.bgmVolume))
    source.loop = true
    if (!settings.bgmEnabled) {
      source.stop()
      return
    }
    const assetPath = BGM_ASSETS[this.bgmMode]
    const clip = this.bgmClips.get(assetPath)
    if (!clip) {
      source.stop()
      source.clip = null
      this.ensureBgmLoaded(assetPath)
      return
    }
    if (source.clip !== clip) {
      source.stop()
      source.clip = clip
    }
    if (!source.playing) source.play()
  }

  /** BGM uses an isolated AudioSource so one-shot card sounds never interrupt it. */
  private ensureBgmSource (): AudioSource {
    if (this.bgmSource?.node.isValid) return this.bgmSource
    const node = new Node('BackgroundMusic')
    node.parent = this.node
    this.bgmSource = node.addComponent(AudioSource)
    this.bgmSource.loop = true
    return this.bgmSource
  }

  /** Each track is optional; late loads may only activate the mode that still requests them. */
  private ensureBgmLoaded (assetPath: string): void {
    if (this.bgmClips.has(assetPath) || this.pendingBgmAssets.has(assetPath) || this.unavailableBgmAssets.has(assetPath)) return
    this.pendingBgmAssets.add(assetPath)
    loadGameAsset(assetPath, AudioClip, (error, clip) => {
      this.pendingBgmAssets.delete(assetPath)
      if (error || !clip) {
        this.unavailableBgmAssets.add(assetPath)
        return
      }
      this.bgmClips.set(assetPath, clip)
      if (this.node.isValid && BGM_ASSETS[this.bgmMode] === assetPath) this.applySettings()
    })
  }

  private acceptCooldown (profile: AudioProfile): boolean {
    const now = Date.now()
    const previous = this.lastRequests.get(profile.event) ?? -Infinity
    if (now - previous < profile.cooldownMs) return false
    this.lastRequests.set(profile.event, now)
    return true
  }

  private playProfile (profile: AudioProfile): void {
    if (!this.acceptCooldown(profile)) return
    const keys = this.selectAssetKeys(profile)
    this.playFirstAvailable(profile.event === 'pass' ? this.selectHumanVoiceKeys(keys) : keys, profile.volumeScale)
  }

  /** Human announcements stay inside one selected voice pack; generated neutral
   * effects may remain as fallback, but another recorded voice never leaks in. */
  private selectHumanVoiceKeys (assetKeys: readonly string[]): readonly string[] {
    if (this.session?.snapshot.settings.voicePack !== 'male') return assetKeys
    const male = assetKeys.filter(key => key.startsWith('niuma/')).map(key => key.replace(/^niuma\//, 'niuma-male/'))
    const neutral = assetKeys.filter(key => !key.startsWith('niuma/') && !key.startsWith('licensed/'))
    return male.concat(neutral)
  }

  /** Round-robin keeps all curated pass variants audible and deterministic. */
  private selectAssetKeys (profile: AudioProfile): readonly string[] {
    if (!profile.assetVariants?.length) return profile.assetKeys
    const cursor = this.variantCursors.get(profile.event) ?? 0
    this.variantCursors.set(profile.event, cursor + 1)
    return profile.assetVariants[cursor % profile.assetVariants.length]
  }

  private playFirstAvailable (assetKeys: readonly string[], volumeScale: number, index = 0, epoch = this.playbackEpoch): void {
    if (index >= assetKeys.length || !this.effectSource?.node.isValid) return
    this.loadOptionalClip(assetKeys[index], clip => {
      if (!this.isPlaybackCurrent(epoch)) return
      if (!clip) return this.playFirstAvailable(assetKeys, volumeScale, index + 1, epoch)
      const assetKey = assetKeys[index]
      const now = Date.now()
      if (now - (this.lastPlayedAssets.get(assetKey) ?? -Infinity) < 60) return
      this.lastPlayedAssets.set(assetKey, now)
      const settings = this.session?.snapshot.settings
      const volume = Math.max(0, Math.min(1, (settings?.volume ?? 0.5) * volumeScale))
      if (this.effectSource?.node.isValid) this.effectSource.playOneShot(clip, volume)
    })
  }

  private isPlaybackCurrent (epoch: number): boolean {
    if (epoch !== this.playbackEpoch || !this.effectSource?.node.isValid) return false
    const settings = this.session?.snapshot.settings
    return !settings || settings.soundEnabled
  }

  /** Missing/failed resources are cached as unavailable and degrade to the next candidate. */
  private loadOptionalClip (assetKey: string, done: (clip: AudioClip | null) => void): void {
    const cached = this.clips.get(assetKey)
    if (cached) return done(cached)
    if (this.unavailableAssets.has(assetKey)) return done(null)
    const pending = this.pendingLoads.get(assetKey)
    if (pending) { pending.push(done); return }
    this.pendingLoads.set(assetKey, [done])
    loadGameAsset(`audio/voices/${assetKey}`, AudioClip, (error, clip) => {
      const listeners = this.pendingLoads.get(assetKey) ?? []
      this.pendingLoads.delete(assetKey)
      if (error || !clip) this.unavailableAssets.add(assetKey)
      else this.clips.set(assetKey, clip)
      listeners.forEach(listener => listener(error || !clip ? null : clip))
    })
  }
}
