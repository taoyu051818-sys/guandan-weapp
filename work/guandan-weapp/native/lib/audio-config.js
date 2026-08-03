// 发布前替换成已配置为微信 downloadFile 合法域名的 HTTPS 目录，例如：https://static.example.com/guandan
// 目录内应包含 bgm.mp3 与 voices/<音频名>.mp3。留空时不加载音频，保证真机包体可安装。
module.exports = { AUDIO_BASE_URL: '' }
