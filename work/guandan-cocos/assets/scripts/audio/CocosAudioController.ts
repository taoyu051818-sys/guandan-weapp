import { _decorator, AudioClip, AudioSource, Component, Node } from 'cc'
import type { PlayAction } from '../core/generated'
import { GameSession } from '../session/GameSession'
import { loadGameAsset } from '../services/GameAssetLoader'
import { RETIRED_AUDIO_ROUTES, resolveAudioEvent, resolveAudioProfile, resolveCountdownProfile, type AudioEvent, type AudioProfile } from './AudioProfiles'
import { resolvePlayVoiceProfile } from './PlayVoiceProfiles'
import { OptionalAudioAssetCache } from './OptionalAudioAssetCache'
import { ActionVoiceGate } from './ActionVoiceGate'

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
  private readonly assets = new OptionalAudioAssetCache<AudioClip>((path, done) => loadGameAsset(path, AudioClip, done))
  private readonly actionVoices = new ActionVoiceGate()
  private disposed = false
  private readonly lastRequests = new Map<AudioEvent, number>()
  private readonly lastPlayedAssets = new Map<string, number>()
  private readonly variantCursors = new Map<AudioEvent, number>()
  private playbackEpoch = 0
  private roundStartEpoch = 0
  private lastQuickVoiceAt = -Infinity
  private soundEnabled = true
  private bgmMode: BgmMode = 'lobby'
  private readonly pendingBgmAssets = new Set<string>()

  protected onLoad (): void {
    if (!this.session) this.session = this.getComponent(GameSession)
    this.effectSource = this.getComponent(AudioSource) ?? this.addComponent(AudioSource)
    this.ensureBgmSource()
    this.session?.events.on('guandan:session', this.applySettings, this)
    this.applySettings()
  }

  protected onDestroy (): void {
    this.disposed = true
    this.cancelTransientPlayback()
    this.session?.events.off('guandan:session', this.applySettings, this)
    this.bgmSource?.stop()
    if (this.bgmSource) this.bgmSource.clip = null
    this.assets.dispose()
    this.pendingBgmAssets.clear()
    this.effectSource = null
  }

  /** The scene owns the lobby/table boundary; this controller owns the audible transition. */
  public setBgmMode (mode: BgmMode): void {
    if (this.disposed) return
    if (this.bgmMode !== mode) {
      this.bgmMode = mode
      const source = this.ensureBgmSource()
      source.stop()
      source.clip = null
    }
    this.applySettings()
  }

  public playPass (): void { this.playEvent('pass') }

  /** Invalidates delayed cues and in-flight optional loads at a table/session boundary. */
  public cancelTransientPlayback (): void {
    this.actionVoices.invalidate()
    this.playbackEpoch += 1
    this.roundStartEpoch += 1
    this.effectSource?.stop()
  }

  /** Plays the semantic start cue, then the existing deal event as a separate layer. */
  public playRoundStart (): void {
    this.cancelTransientPlayback()
    const token = this.roundStartEpoch
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
    if (key in RETIRED_AUDIO_ROUTES) return
    const settings = this.session?.snapshot.settings
    if (settings && !settings.soundEnabled) return
    const now = Date.now()
    if (now - this.lastQuickVoiceAt < 650) return
    this.lastQuickVoiceAt = now
    this.playFirstAvailable(this.selectHumanVoiceKeys([key]), 1)
  }

  /** Announces only the card groups for which the imported pack is unambiguous. */
  public playActionVoice (action: PlayAction): void {
    const current = this.actionVoices.begin()
    const settings = this.session?.snapshot.settings
    if (settings && !settings.soundEnabled) return
    const profile = resolvePlayVoiceProfile(action)
    if (profile) this.playFirstAvailable(this.selectHumanVoiceKeys(profile.assetKeys), profile.volumeScale, 0, this.playbackEpoch, current)
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
    if (this.disposed) return
    const settings = this.session?.snapshot.settings
    const nextSoundEnabled = settings?.soundEnabled ?? true
    if (this.soundEnabled && !nextSoundEnabled) {
      this.cancelTransientPlayback()
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
    const clip = this.assets.peek(assetPath)
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
    if (this.disposed || this.pendingBgmAssets.has(assetPath)) return
    this.pendingBgmAssets.add(assetPath)
    this.assets.get(assetPath, clip => {
      this.pendingBgmAssets.delete(assetPath)
      if (!this.disposed && clip && this.node.isValid && BGM_ASSETS[this.bgmMode] === assetPath) this.applySettings()
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
    const current = profile.event === 'pass' ? this.actionVoices.begin() : () => true
    if (!this.acceptCooldown(profile)) return
    const keys = this.selectAssetKeys(profile)
    this.playFirstAvailable(profile.event === 'pass' ? this.selectHumanVoiceKeys(keys) : keys, profile.volumeScale, 0, this.playbackEpoch, current)
  }

  /** Only curated Female announcements are allowed, including old cached sessions.
   * Unclassified licensed speech must not reintroduce another voice as fallback. */
  private selectHumanVoiceKeys (assetKeys: readonly string[]): readonly string[] {
    return assetKeys.filter(key => key.startsWith('niuma/') || key === 'licensed/single_5_female' || key === 'tts/steel_plate')
  }

  /** Round-robin keeps all curated pass variants audible and deterministic. */
  private selectAssetKeys (profile: AudioProfile): readonly string[] {
    if (!profile.assetVariants?.length) return profile.assetKeys
    const cursor = this.variantCursors.get(profile.event) ?? 0
    this.variantCursors.set(profile.event, cursor + 1)
    return profile.assetVariants[cursor % profile.assetVariants.length]
  }

  private playFirstAvailable (assetKeys: readonly string[], volumeScale: number, index = 0,
    epoch = this.playbackEpoch, current: () => boolean = () => true): void {
    if (index >= assetKeys.length || !this.isPlaybackCurrent(epoch) || !current()) return
    this.assets.get(`audio/voices/${assetKeys[index]}`, clip => {
      if (!this.isPlaybackCurrent(epoch)) return
      if (!current()) return
      if (!clip) return this.playFirstAvailable(assetKeys, volumeScale, index + 1, epoch, current)
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
    if (this.disposed || epoch !== this.playbackEpoch || !this.effectSource?.node.isValid) return false
    const settings = this.session?.snapshot.settings
    return !settings || settings.soundEnabled
  }

}
