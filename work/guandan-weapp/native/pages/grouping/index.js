const { createDeck, shuffleDeck } = require('../../core/lib/deck')
const storage = require('../../lib/storage')
const labels = { spade: '♠', heart: '♥', club: '♣', diamond: '♦', joker: '王' }
const names = { p1: '玩家', p2: '电脑2', p3: '电脑3（对家）', p4: '电脑4' }
const view = card => ({ rank: card.suit === 'joker' ? (card.rank === 'Big' ? '大王' : '小王') : String(card.rank), suit: labels[card.suit], red: card.suit === 'heart' || card.suit === 'diamond' })
Page({
  data: { cards: {}, ready: false, drawing: false, dealerName: '' },
  draw() {
    if (this.data.drawing || this.data.ready) return
    this.setData({ drawing: true })
    const deck = shuffleDeck(createDeck(2)); const reds = deck.filter(card => card.suit === 'heart' || card.suit === 'diamond'); const blacks = deck.filter(card => card.suit === 'spade' || card.suit === 'club')
    const draws = { p1: reds[0], p2: blacks[0], p3: reds[1], p4: blacks[1] }
    const cards = {}
    ;['p1', 'p2', 'p3', 'p4'].forEach((id, index) => setTimeout(() => { cards[id] = view(draws[id]); this.setData({ cards: { ...cards } }) }, 280 * (index + 1)))
    setTimeout(() => { const dealer = Object.keys(draws).reduce((best, id) => draws[id].value > draws[best].value ? id : best, 'p1'); this.dealer = dealer; this.setData({ ready: true, dealerName: names[dealer] }) }, 1400)
  },
  begin() { storage.saveLaunch({ ...storage.loadLaunch(), dealer: this.dealer || 'p1' }); wx.redirectTo({ url: '/pages/index/index' }) },
})
