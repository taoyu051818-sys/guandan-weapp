const { WeappNetwork } = require('../../lib/network')
const storage = require('../../lib/storage')

Page({
  data: { url: '', roomId: '', joinId: '', connected: false, message: '填写联机地址后连接', rooms: [], members: [], mine: '', inRoom: false },
  onUnload() { if (this.network) this.network.close() },
  input(e) { this.setData({ [e.currentTarget.dataset.key]: e.detail.value }) },
  async connect() {
    try {
      const url = this.data.url.trim()
      this.network = new WeappNetwork(url)
      this.network.on('roomList', ({ rooms }) => this.setData({ rooms }))
      this.network.on('roomMembers', ({ memberPlayerIds }) => this.setData({ members: memberPlayerIds, memberText: memberPlayerIds.join('、') }))
      this.network.on('error', ({ message }) => this.setData({ message }))
      this.network.on('gameState', ({ state }) => this.enterGame(state))
      await this.network.connect()
      this.setData({ connected: true, message: '已连接，正在获取房间列表' })
      this.network.send('listRooms')
    } catch (_) { this.setData({ message: '连接失败：请检查 wss 地址和微信合法域名配置' }) }
  },
  create() {
    if (!this.network || !this.data.roomId.match(/^\d{6}$/)) return this.setData({ message: '请输入 6 位房间号' })
    this.network.on('roomCreated', message => this.enterRoom(message))
    this.network.send('createRoom', { roomId: this.data.roomId, hostName: '玩家' })
  },
  join(e) {
    const roomId = e.currentTarget.dataset.id || this.data.joinId
    if (!this.network || !String(roomId).match(/^\d{6}$/)) return this.setData({ message: '请输入有效房间号' })
    this.network.on('roomJoined', message => this.enterRoom(message))
    this.network.send('joinRoom', { roomId: String(roomId) })
  },
  enterRoom(message) { this.setData({ inRoom: true, roomId: message.roomId, mine: message.myPlayerId, memberText: message.myPlayerId, message: `已入座 ${message.myPlayerId}，等待其他玩家` }) },
  start() { if (this.network) this.network.send('startGame', { roomId: this.data.roomId }) },
  enterGame(state) {
    storage.saveOnline({ url: this.data.url.trim(), roomId: this.data.roomId, myPlayerId: this.data.mine, state })
    wx.redirectTo({ url: '/pages/index/index' })
  },
})
