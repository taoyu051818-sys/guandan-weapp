/** Semantic audio events. Callers describe what happened, never a file name. */
export const AUDIO_EVENTS = [
  'game-start',
  'deal',
  'play',
  'pass',
  'countdown',
  'bomb',
  'king-bomb',
  'victory',
  'defeat',
] as const

export type AudioEvent = typeof AUDIO_EVENTS[number]

export type AudioProfile = Readonly<{
  event: AudioEvent
  /** Keys below game-assets/audio/voices, ordered from specific to generic. */
  assetKeys: readonly string[]
  /** Optional complete alternatives. The controller rotates them without losing fallbacks. */
  assetVariants?: readonly (readonly string[])[]
  volumeScale: number
  cooldownMs: number
}>

const audioProfile = (event: AudioEvent, assetKeys: readonly string[], volumeScale: number, cooldownMs: number, assetVariants?: readonly (readonly string[])[]): AudioProfile =>
  Object.freeze({
    event,
    assetKeys: Object.freeze([...assetKeys]),
    ...(assetVariants?.length ? { assetVariants: Object.freeze(assetVariants.map(keys => Object.freeze([...keys]))) } : {}),
    volumeScale,
    cooldownMs,
  })

export const COUNTDOWN_SECONDS = [0, 1, 2, 3, 4, 5] as const
export type CountdownSecond = typeof COUNTDOWN_SECONDS[number]

export const COUNTDOWN_AUDIO_PROFILES: Readonly<Record<CountdownSecond, AudioProfile>> = Object.freeze({
  0: audioProfile('countdown', ['niuma/countdown_0', 'card'], 0.72, 700),
  1: audioProfile('countdown', ['niuma/countdown_1', 'card'], 0.72, 700),
  2: audioProfile('countdown', ['niuma/countdown_2', 'card'], 0.72, 700),
  3: audioProfile('countdown', ['niuma/countdown_3', 'card'], 0.72, 700),
  4: audioProfile('countdown', ['niuma/countdown_4', 'card'], 0.72, 700),
  5: audioProfile('countdown', ['niuma/countdown_5', 'card'], 0.72, 700),
})

/**
 * User-authorized production clips and pinned MIT NiuMa clips live in isolated
 * namespaces ahead of generated rFXGen fallbacks. Every candidate is optional
 * and ultimately degrades to silence without affecting gameplay.
 */
export const AUDIO_EVENT_PROFILES: Readonly<Record<AudioEvent, AudioProfile>> = Object.freeze({
  'game-start': audioProfile('game-start', ['niuma/game_start'], 0.88, 1200),
  deal: audioProfile('deal', ['licensed/deal', 'card'], 0.72, 70),
  play: audioProfile('play', ['card'], 0.82, 45),
  pass: audioProfile('pass', ['niuma/pass_1', 'pass_1'], 0.9, 160, [
    ['niuma/pass_1', 'pass_1'],
    ['niuma/pass_2', 'pass_1'],
    ['niuma/pass_3', 'pass_1'],
  ]),
  countdown: COUNTDOWN_AUDIO_PROFILES[5],
  bomb: audioProfile('bomb', ['licensed/bomb', 'bomb', 'card'], 1, 120),
  'king-bomb': audioProfile('king-bomb', ['king_bomb', 'licensed/bomb', 'bomb', 'card'], 1, 220),
  victory: audioProfile('victory', ['niuma/victory', 'win', 'card'], 1, 800),
  defeat: audioProfile('defeat', ['licensed/defeat', 'niuma/defeat', 'pass_1', 'card'], 0.62, 800),
})

const LEGACY_AUDIO_EVENTS: Readonly<Record<string, AudioEvent>> = Object.freeze({
  game_start: 'game-start',
  card: 'play',
  pass_1: 'pass',
  bomb: 'bomb',
  king_bomb: 'king-bomb',
  win: 'victory',
  lose: 'defeat',
})

export const RETIRED_AUDIO_ROUTES = Object.freeze({
  wildcard: Object.freeze({ runtimeAllowed: false, reason: '级牌／逢人配专属提示音已移除，只保留正常报牌女声。' }),
  'straight-flush': Object.freeze({
    runtimeAllowed: false,
    reason: '同花顺已由 playActionVoice 唯一播报；第二条语义语音会造成重复报牌，禁止恢复。',
  }),
  straight_flush: Object.freeze({
    runtimeAllowed: false,
    reason: '旧文件名路由已退役，禁止绕过唯一报牌入口。',
  }),
})

export const isAudioEvent = (value: string): value is AudioEvent =>
  (AUDIO_EVENTS as readonly string[]).includes(value)

/** Keeps older callers working while all new code uses AudioEvent directly. */
export const resolveAudioEvent = (value: string): AudioEvent | null =>
  isAudioEvent(value) ? value : LEGACY_AUDIO_EVENTS[value] ?? null

export const resolveAudioProfile = (value: string): AudioProfile | null => {
  const event = resolveAudioEvent(value)
  return event ? AUDIO_EVENT_PROFILES[event] : null
}

export const resolveCountdownProfile = (remaining: number): AudioProfile | null =>
  Number.isInteger(remaining) && remaining >= 0 && remaining <= 5
    ? COUNTDOWN_AUDIO_PROFILES[remaining as CountdownSecond]
    : null
