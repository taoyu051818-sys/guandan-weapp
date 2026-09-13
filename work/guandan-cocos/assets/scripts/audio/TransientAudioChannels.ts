import { AudioClip, AudioSource, Node } from 'cc'

/** Each cue owns a normal AudioSource, including its asynchronous engine load.
 * Never reuse a cancelled source: an old load of the same clip must not attach
 * to a new cue. Clearing clip invalidates Cocos' pending load before destruction.
 */
export class TransientAudioChannels {
  private readonly channels = new Set<AudioSource>()

  public constructor (private readonly owner: () => Node) {}

  public play (clip: AudioClip, volume: number): void {
    const owner = this.owner()
    if (!owner.isValid) return
    const limit = Math.max(1, AudioSource.maxAudioChannel || 32)
    if (this.channels.size >= limit) this.release(this.channels.values().next().value!)
    const node = new Node('TransientAudio')
    node.parent = owner
    const source = node.addComponent(AudioSource)
    source.playOnAwake = false
    source.loop = false
    source.volume = volume
    this.channels.add(source)
    node.once(AudioSource.EventType.ENDED, () => this.release(source))
    try { source.clip = clip; source.play() }
    catch (error) { this.release(source); throw error }
  }

  public stopAll (): void {
    for (const source of Array.from(this.channels)) this.release(source)
  }

  private release (source: AudioSource): void {
    if (!this.channels.delete(source)) return
    source.stop()
    source.clip = null
    if (source.node.isValid) source.node.destroy()
  }
}
