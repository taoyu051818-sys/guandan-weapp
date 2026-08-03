const { createGame, dealNextRound, playCards, passTurn, runAiTurns, isRoundOver } = require('../../core/lib/engine')
const { AiExecutor } = require('../../lib/ai-executor')
const { WeappNetwork } = require('../../lib/network')
const { getPlayInfo, setRuleProfileByPreset } = require('../../core/lib/rules')
const { settle } = require('../../core/lib/settlement')
const { createTribute, giveTribute, returnTribute, tributeLeader, highestCard, lowestCard } = require('../../core/lib/tribute')
const audio = require('../../lib/audio')
const storage = require('../../lib/storage')

const suitLabel = { spade: '♠', heart: '♥', club: '♣', diamond: '♦', joker: '王' }
const playerName = { p1: '玩家', p2: '电脑2（下家）', p3: '电脑3（对家）', p4: '电脑4（上家）' }
const viewCard = (card) => ({
  ...card,
  rank: card.suit === 'joker' ? (card.rank === 'Big' ? '大王' : '小王') : String(card.rank),
  suit: suitLabel[card.suit],
  red: card.suit === 'heart' || card.suit === 'diamond',
  selected: false,
})

Page({
  data: {
    hand: [], hint: '请选择手牌', selectedCount: 0, counts: {}, turn: 'p1', lastPlay: '等待首发',
    level: 2, teamLevels: { teamA: 2, teamB: 2 }, scores: { teamA: 0, teamB: 0 }, lastCards: [], showP3: false, p3Hand: [], effect: '', theme: 'luxury', seats: { self: 'p1', top: 'p3', left: 'p4', right: 'p2' }, names: { self: '玩家', top: '电脑3（对家）', left: '电脑4', right: '电脑2' },
    phase: 'playing', settlement: null, tribute: null, isMultiplayer: false, showChat: false, chats: { self: '', top: '', left: '', right: '' },
  },

  onLoad() {
    this.settings = storage.loadSettings()
    setRuleProfileByPreset(this.settings.rulePreset)
    this.aiExecutor = new AiExecutor()
    this.online = storage.loadOnline()
    this.isMultiplayer = Boolean(this.online)
    this.myPlayerId = this.online ? this.online.myPlayerId : 'p1'
    if (this.online && this.online.state) {
      this.game = this.online.state
      this.teamLevels = this.game.teamLevels || { teamA: 2, teamB: 2 }
      this.aFailStreaks = this.game.aFailStreaks || { teamA: 0, teamB: 0 }
      this.scores = this.game.scores || { teamA: 0, teamB: 0 }
      this.phase = 'playing'
      this.network = new WeappNetwork(this.online.url)
      this.network.on('gameState', ({ state }) => { this.game = state; storage.saveOnline({ ...this.online, state }); this.sync('已同步服务器回合') })
      this.network.on('roundEnded', ({ result }) => { this.phase = 'settlement'; this.setData({ settlement: { ...result, rankText: result.fullRank.map(id => playerName[id]).join(' · '), nextLevel: result.currentLevel } }); this.sync(result.message) })
      this.network.on('error', ({ message }) => this.setData({ hint: message }))
      this.network.on('roomRejoined', ({ state }) => { if (state) { this.game = state; this.sync('已恢复联机对局') } })
      this.network.on('chat', ({ playerId, text }) => this.showChat(playerId, text))
      const receiveTribute = ({ state, tribute }) => { this.game = state; this.tribute = tribute; this.phase = 'tribute'; this.sync(tribute.isAntiTribute ? '抗贡成立，请开始本局' : '请完成进贡与还贡') }
      this.network.on('roundPrepared', receiveTribute)
      this.network.on('tributeUpdated', receiveTribute)
      this.network.connect().then(() => this.network.send('rejoinRoom', { roomId: this.online.roomId, myPlayerId: this.myPlayerId })).catch(() => this.setData({ hint: '联机重连失败' }))
      this.sync('正在恢复联机对局')
      return
    }
    this.launch = storage.loadLaunch()
    this.settings = { ...this.settings, difficulty: this.launch.difficulty || this.settings.difficulty }
    audio.configure(this.settings)
    if (this.settings.bgmEnabled) audio.playBgm()
    this.gameMode = this.launch.gameMode || 'standard'
    this.campaign = this.gameMode === 'campaign' ? { wins: 0, losses: 0, targetWins: 3 } : null
    this.teamLevels = { teamA: 2, teamB: 2 }
    this.aFailStreaks = { teamA: 0, teamB: 0 }
    this.scores = { teamA: 0, teamB: 0 }
    this.lastRoundRank = []
    this.deal()
  },

  onUnload() { if (this.aiExecutor) this.aiExecutor.dispose(); if (this.network) this.network.close() },

  sync(hint) {
    const me = this.myPlayerId || 'p1'
    const cards = [...this.game.players[me].hand].sort((a, b) => this.settings.sortOrder === 'asc' ? a.value - b.value : b.value - a.value)
    const hand = cards.map(viewCard)
    const last = this.game.playArea[this.game.playArea.length - 1]
    const tribute = this.tribute ? {
      phase: this.tribute.phase,
      anti: this.tribute.isAntiTribute,
      actions: this.tribute.actions.map(action => ({
        from: playerName[action.from], to: playerName[action.to],
        card: action.card ? viewCard(action.card) : null,
        returnCard: action.returnCard ? viewCard(action.returnCard) : null,
      })),
    } : null
    const order = ['p1', 'p2', 'p3', 'p4']
    const index = order.indexOf(me)
    const seats = { self: me, right: order[(index + 1) % 4], top: order[(index + 2) % 4], left: order[(index + 3) % 4] }
    const names = Object.keys(seats).reduce((all, position) => ({ ...all, [position]: playerName[seats[position]] || seats[position] }), {})
    this.setData({
      hand, hint, selectedCount: 0, turn: this.game.currentTurn, isMultiplayer: this.isMultiplayer, theme: this.settings.visualTheme,
      level: this.game.currentLevel, teamLevels: this.teamLevels, scores: this.scores,
      lastPlay: last ? (last.type === 'Pass' ? `${playerName[last.playerId]}：不要` : `${playerName[last.playerId]}：${last.type}`) : '等待首发',
      lastCards: last && last.type !== 'Pass' ? last.cards.map(viewCard) : [],
      showP3: !this.isMultiplayer && this.gameMode === 'double_open',
      p3Hand: !this.isMultiplayer && this.gameMode === 'double_open' ? this.game.players.p3.hand.map(viewCard) : [],
      effect: last && ['Bomb', 'StraightFlush', 'Rocket', 'Tube', 'Plate', 'Straight'].includes(last.type) ? last.type : '',
      counts: { self: hand.length, right: this.game.players[seats.right].hand.length, top: this.game.players[seats.top].hand.length, left: this.game.players[seats.left].hand.length }, seats, names,
      phase: this.phase, tribute,
    })
  },

  showChat(playerId, text) {
    const seats = this.data.seats || {}
    const position = Object.keys(seats).find(key => seats[key] === playerId)
    if (!position) return
    const chats = { ...(this.data.chats || {}), [position]: text }
    this.setData({ chats })
    setTimeout(() => { if (this.data.chats[position] === text) this.setData({ chats: { ...this.data.chats, [position]: '' } }) }, 2500)
  },

  toggleChat() { this.setData({ showChat: !this.data.showChat }) },

  sendChat(e) {
    const { text, voice } = e.currentTarget.dataset
    const me = this.myPlayerId || 'p1'
    this.showChat(me, text)
    if (this.settings.soundEnabled && voice) audio.playVoice(voice)
    if (this.isMultiplayer) this.network.send('chat', { roomId: this.online.roomId, text })
    this.setData({ showChat: false })
  },

  leaveOnline() {
    if (!this.isMultiplayer) return
    try { this.network.send('leaveRoom', { roomId: this.online.roomId }) } catch (_) { /* 断线时只清理本地会话 */ }
    storage.clearOnline()
    if (this.network) this.network.close()
    wx.reLaunch({ url: '/pages/menu/index' })
  },

  deal() {
    this.phase = 'playing'
    this.tribute = null
    this.game = createGame(2, this.launch.dealer || 'p1')
    this.teamLevels = { teamA: 2, teamB: 2 }
    this.aFailStreaks = { teamA: 0, teamB: 0 }
    this.scores = { teamA: 0, teamB: 0 }
    this.lastRoundRank = []
    this.campaign = this.gameMode === 'campaign' ? { wins: 0, losses: 0, targetWins: 3 } : null
    const stats = storage.loadStats()
    storage.saveStats({ gamesPlayed: stats.gamesPlayed + 1 })
    this.setData({ settlement: null })
    this.sync('新对局开始，轮到你出牌')
  },

  toggle(e) {
    if (this.phase === 'settlement') return
    const id = e.currentTarget.dataset.id
    const hand = this.data.hand.map(card => card.id === id ? { ...card, selected: !card.selected } : card)
    const selected = hand.filter(card => card.selected)
    if (this.phase === 'tribute') {
      this.setData({ hand, selectedCount: selected.length, hint: selected.length === 1 ? '确认这张牌' : '进贡或还贡只能选择一张牌' })
      return
    }
    const play = getPlayInfo(selected)
    this.setData({ hand, selectedCount: selected.length, hint: selected.length ? (play ? `牌型：${play.type}` : '当前组合不符合掼蛋牌型') : '请选择手牌' })
  },

  selectedCoreCards() {
    const me = this.myPlayerId || 'p1'
    return this.data.hand.filter(card => card.selected).map(view => this.game.players[me].hand.find(card => card.id === view.id)).filter(Boolean)
  },

  maybeSettle() {
    if (!isRoundOver(this.game)) return false
    const result = settle(this.game, this.teamLevels, this.aFailStreaks)
    if (!result) return false
    this.teamLevels = result.teamLevels
    this.aFailStreaks = result.aFailStreaks
    if (result.levelUp > 0) this.scores[result.winnerTeam] += result.levelUp
    this.lastRoundRank = result.fullRank
    let isCampaignEnd = false
    if (this.campaign) {
      if (result.winnerTeam === 'teamA') this.campaign.wins += 1
      else this.campaign.losses += 1
      isCampaignEnd = this.campaign.wins >= this.campaign.targetWins || this.campaign.losses >= 2
      result.message = isCampaignEnd
        ? (this.campaign.wins >= this.campaign.targetWins ? '闯关成功，三胜达成！' : '闯关结束，已累计两负。')
        : `${result.message} 闯关进度：${this.campaign.wins}/${this.campaign.targetWins} 胜，${this.campaign.losses}/2 负。`
    }
    const stats = storage.loadStats()
    const isMyWin = result.winnerTeam === 'teamA'
    storage.saveStats({
      wins: stats.wins + (isMyWin ? 1 : 0),
      firstPlaceFinishes: stats.firstPlaceFinishes + (result.fullRank[0] === 'p1' ? 1 : 0),
      elo: Math.max(0, stats.elo + (isMyWin ? Math.max(1, Math.abs(result.levelUp)) * 10 : -Math.max(1, Math.abs(result.levelUp)) * 5)),
      recentMatch: { winnerTeam: result.winnerTeam, levelUp: result.levelUp, currentLevel: result.currentLevel, scores: this.scores },
    })
    this.phase = 'settlement'
    this.setData({ settlement: { ...result, isGameWon: result.isGameWon || isCampaignEnd, rankText: result.fullRank.map(id => playerName[id]).join(' · '), nextLevel: result.currentLevel } })
    this.sync(result.message)
    return true
  },

  takeAiTurns() {
    if (this.isMultiplayer) return
    if (this.maybeSettle()) return
    if (['hard', 'master'].includes(this.settings.difficulty)) { this.takeAiTurnsAsync(); return }
    this.game = runAiTurns(this.game, this.settings.difficulty, 60)
    if (this.maybeSettle()) return
    this.sync(this.game.currentTurn === 'p1' ? '电脑出牌完成，轮到你出牌' : '电脑正在思考')
  },

  takeAiTurnsAsync() {
    if (this.maybeSettle()) return
    const id = this.game.currentTurn
    if (id === 'p1') { this.sync('电脑出牌完成，轮到你出牌'); return }
    const current = this.game.players[id]
    this.sync(`${playerName[id]} 正在思考…`)
    this.aiExecutor.decide({
      hand: current.hand, lastPlay: this.game.lastValidPlay, difficulty: this.settings.difficulty,
      myTeam: current.team, players: this.game.players, myPlayerId: id,
      aiContext: { currentLevel: this.game.currentLevel, teamLevels: this.teamLevels, roundMeta: null },
    }).then((cards) => {
      if (this.phase !== 'playing' || this.game.currentTurn !== id) return
      this.game = cards && cards.length ? playCards(this.game, id, cards) : passTurn(this.game, id)
      if (this.maybeSettle()) return
      setTimeout(() => this.takeAiTurnsAsync(), 180)
    }).catch(() => {
      // Worker 不可用时仍可完成对局，避免因平台差异卡住回合。
      this.game = runAiTurns(this.game, this.settings.difficulty, 60)
      if (!this.maybeSettle()) this.sync('电脑出牌完成，轮到你出牌')
    })
  },

  play() {
    if (this.phase !== 'playing') return
    try {
      const cards = this.selectedCoreCards()
      const me = this.myPlayerId || 'p1'
      if (this.isMultiplayer) { this.network.send('play', { roomId: this.online.roomId, cardIds: cards.map(card => card.id) }); this.setData({ hint: '已提交出牌，等待服务器确认' }); return }
      this.game = playCards(this.game, me, cards)
      if (this.settings.soundEnabled) audio.playAction({ type: getPlayInfo(cards).type, cards })
      if (getPlayInfo(cards).type === 'Bomb' || getPlayInfo(cards).type === 'StraightFlush' || getPlayInfo(cards).type === 'Rocket') { const stats = storage.loadStats(); storage.saveStats({ bombsPlayed: stats.bombsPlayed + 1 }) }
      this.takeAiTurns()
    } catch (error) { this.setData({ hint: error.message }) }
  },

  pass() {
    if (this.phase !== 'playing') return
    try {
      const me = this.myPlayerId || 'p1'
      if (this.isMultiplayer) { this.network.send('pass', { roomId: this.online.roomId }); this.setData({ hint: '已提交不要，等待服务器确认' }); return }
      this.game = passTurn(this.game, me)
      if (this.settings.soundEnabled) audio.playPass()
      this.takeAiTurns()
    } catch (error) { this.setData({ hint: error.message }) }
  },

  nextRound() {
    const settlement = this.data.settlement
    if (this.isMultiplayer) {
      if (!settlement) return
      if (settlement.isGameWon) { storage.clearOnline(); wx.reLaunch({ url: '/pages/menu/index' }); return }
      this.network.send('nextRound', { roomId: this.online.roomId })
      this.setData({ hint: '等待房主准备下一局' })
      return
    }
    if (!settlement || settlement.isGameWon) { this.deal(); return }
    const dealer = this.lastRoundRank[0] || 'p1'
    this.game = dealNextRound(this.game, settlement.nextLevel, dealer)
    this.tribute = createTribute(this.game, this.lastRoundRank)
    this.phase = this.tribute ? 'tribute' : 'playing'
    this.setData({ settlement: null })
    if (this.tribute) {
      this.runTributeAi()
      this.sync(this.tribute.isAntiTribute ? '抗贡成立，请开始下一局' : '请完成进贡与还贡')
    } else {
      this.takeAiTurns()
    }
  },

  runTributeAi() {
    if (!this.tribute || this.tribute.isAntiTribute) return
    if (this.tribute.phase === 'tributing') {
      this.tribute.actions.filter(action => this.game.players[action.from].isAI && !action.card).forEach(action => {
        const hand = this.game.players[action.from].hand
        const eligible = hand.filter(card => !(card.isLevelCard && card.suit === 'heart'))
        const card = highestCard(eligible.length ? eligible : hand)
        const result = giveTribute(this.game, this.tribute, action.from, card.id)
        this.game = result.state; this.tribute = result.tribute
      })
    }
    if (this.tribute.phase === 'returning') {
      this.tribute.actions.filter(action => this.game.players[action.to].isAI && !action.returnCard).forEach(action => {
        const card = lowestCard(this.game.players[action.to].hand.filter(item => item.value <= 10))
        if (!card) throw new Error('电脑没有可还贡的牌')
        const result = returnTribute(this.game, this.tribute, action.to, card.id)
        this.game = result.state; this.tribute = result.tribute
      })
    }
  },

  confirmTribute() {
    if (this.phase !== 'tribute' || !this.tribute || this.tribute.isAntiTribute) return
    try {
      const cards = this.selectedCoreCards()
      if (cards.length !== 1) throw new Error('请选择一张牌')
      const me = this.myPlayerId || 'p1'
      if (this.isMultiplayer) {
        const action = this.tribute.phase === 'tributing'
          ? this.tribute.actions.find(item => item.from === me && !item.card)
          : this.tribute.actions.find(item => item.to === me && !item.returnCard)
        if (!action) throw new Error('当前等待其他玩家操作')
        this.network.send(this.tribute.phase === 'tributing' ? 'tribute' : 'returnTribute', { roomId: this.online.roomId, cardId: cards[0].id })
        this.setData({ hint: '已提交贡还，等待服务器确认' })
        return
      }
      const action = this.tribute.phase === 'tributing'
        ? this.tribute.actions.find(item => item.from === 'p1' && !item.card)
        : this.tribute.actions.find(item => item.to === 'p1' && !item.returnCard)
      if (!action) throw new Error('当前等待其他玩家操作')
      const result = this.tribute.phase === 'tributing'
        ? giveTribute(this.game, this.tribute, 'p1', cards[0].id)
        : returnTribute(this.game, this.tribute, 'p1', cards[0].id)
      this.game = result.state; this.tribute = result.tribute
      this.runTributeAi()
      this.sync(this.tribute.phase === 'done' ? '贡还完成，请开始本局' : '等待下一步贡还')
    } catch (error) { this.setData({ hint: error.message }) }
  },

  finishTribute() {
    if (this.phase !== 'tribute' || !this.tribute || (!this.tribute.isAntiTribute && this.tribute.phase !== 'done')) return
    if (this.isMultiplayer) { this.network.send('finishTribute', { roomId: this.online.roomId }); this.setData({ hint: '等待服务器开始本局' }); return }
    this.game = { ...this.game, currentTurn: tributeLeader(this.tribute, this.lastRoundRank, this.lastRoundRank[0] || 'p1'), lastValidPlay: null }
    this.phase = 'playing'
    this.tribute = null
    this.takeAiTurns()
  },
})
