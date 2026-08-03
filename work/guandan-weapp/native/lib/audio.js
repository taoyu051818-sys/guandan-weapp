let config = { soundEnabled: true, bgmEnabled: true, volume: 0.5, bgmVolume: 0.3 }
let bgm = null
const { AUDIO_BASE_URL } = require('./audio-config')
const baseUrl = String(AUDIO_BASE_URL || '').replace(/\/$/, '')
const path = (name) => baseUrl ? `${baseUrl}/voices/${name}.mp3` : ''
function play(name) {
  if (!config.soundEnabled || !baseUrl) return
  const context = wx.createInnerAudioContext()
  context.src = path(name)
  context.volume = config.volume
  context.onEnded(() => context.destroy())
  context.onError(() => context.destroy())
  context.play()
}
function playAction(action) {
  if (!action) return
  if (action.type === 'Bomb' || action.type === 'StraightFlush' || action.type === 'Rocket') { play('bomb'); playVoice(action.type === 'Rocket' ? 'rocket' : 'bomb'); return }
  const card = action.cards && action.cards.find(item => !item.isRedJoker) || action.cards && action.cards[0]
  const rank = card && card.rank
  if (action.type === 'Single' && rank) playVoice(`single_${rank}`)
  else if (action.type === 'Pair' && rank) playVoice(`pair_${rank}`)
  else if (action.type === 'Plate') playVoice('plate')
  else play('card')
}
function playVoice(name) { play(name) }
function playBgm() {
  if (!config.bgmEnabled || !baseUrl) return
  if (!bgm) { bgm = wx.createInnerAudioContext(); bgm.src = `${baseUrl}/bgm.mp3`; bgm.loop = true }
  bgm.volume = config.bgmVolume; bgm.play()
}
function stopBgm() { if (bgm) bgm.stop() }
function configure(next) { config = { ...config, ...next }; if (!config.bgmEnabled) stopBgm() }
module.exports = { configure, playCard: () => play('single_2'), playPass: () => play(`pass_${1 + Math.floor(Math.random() * 3)}`), playBomb: () => play('bomb'), playVoice, playAction, playBgm, stopBgm }
