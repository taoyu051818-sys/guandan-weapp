import { _decorator, AudioClip, AudioSource, Component, resources } from 'cc'
import { GameSession } from '../session/GameSession'

const { ccclass, property } = _decorator

/** Cocos replacement for the browser-only AudioManager. Audio files are loaded from assets/resources/audio. */
@ccclass('CocosAudioController')
export class CocosAudioController extends Component {
  @property(GameSession)
  public session: GameSession | null = null

  @property(AudioSource)
  public bgmSource: AudioSource | null = null

  private effectSource: AudioSource | null = null

  protected onLoad (): void {
    if (!this.session) this.session = this.getComponent(GameSession)
    this.effectSource = this.getComponent(AudioSource) ?? this.addComponent(AudioSource)
    this.session?.events.on('guandan:session', this.applySettings, this)
    this.applySettings()
  }

  protected onDestroy (): void { this.session?.events.off('guandan:session', this.applySettings, this) }

  public playCard (): void { this.playEffect('card') }
  public playPass (): void { this.playEffect('pass_1') }
  public playBomb (): void { this.playEffect('bomb') }
  public playVoice (key: string): void { this.playEffect(key) }

  public playEffect (key: string): void {
    const settings = this.session?.snapshot.settings
    if (settings && !settings.soundEnabled) return
    resources.load(`audio/voices/${key}`, AudioClip, (error, clip) => {
      if (!error && clip && this.effectSource) this.effectSource.playOneShot(clip, settings?.volume ?? 0.5)
    })
  }

  private applySettings (): void {
    const settings = this.session?.snapshot.settings
    if (!settings || !this.bgmSource) return
    this.bgmSource.volume = settings.bgmVolume
    if (!settings.bgmEnabled) this.bgmSource.stop()
  }
}
