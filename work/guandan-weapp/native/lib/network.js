/** 微信原生 Socket 适配层；生产环境请写入已备案并配置为合法域名的 wss 地址。 */
const DEFAULT_URL = ''

class WeappNetwork {
  constructor(url = DEFAULT_URL) { this.url = url; this.socket = null; this.listeners = new Map(); this.sequence = 0 }
  on(type, listener) { const list = this.listeners.get(type) || []; list.push(listener); this.listeners.set(type, list); return () => this.off(type, listener) }
  off(type, listener) { this.listeners.set(type, (this.listeners.get(type) || []).filter(item => item !== listener)) }
  emit(type, payload) { (this.listeners.get(type) || []).forEach(listener => listener(payload)) }
  connect(url = this.url) {
    if (!url) return Promise.reject(new Error('尚未配置联机 WSS 地址'))
    this.url = url
    return new Promise((resolve, reject) => {
      this.socket = wx.connectSocket({ url })
      this.socket.onOpen(() => resolve())
      this.socket.onError(error => reject(error))
      this.socket.onMessage(({ data }) => { try { const message = JSON.parse(data); this.emit(message.type, message) } catch (_) { this.emit('error', { message: '服务端返回了无效数据' }) } })
      this.socket.onClose(() => this.emit('close'))
    })
  }
  send(type, payload = {}) { if (!this.socket) throw new Error('联机尚未连接'); this.socket.send({ data: JSON.stringify({ type, requestId: ++this.sequence, payload }) }) }
  close() { if (this.socket) this.socket.close(); this.socket = null }
}

module.exports = { WeappNetwork }
